use crate::config::ServiceConfig;
use crate::log_monitor::{matcher::KeywordMatcher, template::extract_template, LogCounter};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// Start tailing a log file. Runs in a blocking loop on a dedicated OS thread.
///
/// `path`에 glob 메타문자(`*`, `?`, `[`)가 포함된 경우 glob 타일러를 실행한다.
/// Tomcat처럼 활성 로그 파일 자체가 날짜 파일명(`catalina.20260722.log`)으로
/// 매일 새로 생성되는 경우에 사용.
///
/// `stop`: set to `true` to signal this tailer to exit on the next poll cycle.
pub fn start_tailer(
    path: String,
    log_type: String,
    multiline: bool,
    matcher: KeywordMatcher,
    services: Vec<ServiceConfig>,
    counter: LogCounter,
    stop: Arc<AtomicBool>,
) {
    let has_glob = path.contains('*') || path.contains('?') || path.contains('[');
    if has_glob {
        start_glob_tailer(path, log_type, multiline, matcher, services, counter, stop);
    } else {
        start_fixed_tailer(path, log_type, multiline, matcher, services, counter, stop);
    }
}

/// 고정 경로용 타일러 — 기존 로직 그대로.
///
/// Log rotation handling (e.g. JeusServer.log → JeusServer_20260409.log):
///   - Watches the **parent directory** instead of the file directly.
///   - On `Create` event for the target filename, the file is re-opened from the
///     beginning (the old file was rotated away; a fresh file appeared at the same path).
///   - On `Modify` events for the target filename, new lines are read as usual.
///
/// `multiline`: when true, consecutive Java stack trace lines (`\t` / `Caused by:`)
///   following an ERROR line are merged into a single event.
fn start_fixed_tailer(
    path: String,
    log_type: String,
    multiline: bool,
    matcher: KeywordMatcher,
    services: Vec<ServiceConfig>,
    counter: LogCounter,
    stop: Arc<AtomicBool>,
) {
    let path_buf = PathBuf::from(&path);

    // Watch the parent directory so we catch file-recreate events after rotation.
    let parent = match path_buf.parent() {
        Some(p) if p != std::path::Path::new("") => p.to_path_buf(),
        _ => std::path::PathBuf::from("."),
    };

    if !parent.exists() {
        warn!("Log parent directory not found, skipping: {}", parent.display());
        return;
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(tx, notify::Config::default()) {
        Ok(w) => w,
        Err(e) => {
            warn!("Failed to create watcher for {}: {}", path, e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&parent, RecursiveMode::NonRecursive) {
        warn!("Failed to watch directory {:?}: {}", parent, e);
        return;
    }

    // Open the file if it already exists; seek to end to avoid re-reading history.
    let mut file: Option<BufReader<File>> = if path_buf.exists() {
        match File::open(&path_buf) {
            Ok(f) => {
                let mut br = BufReader::new(f);
                let _ = br.seek(SeekFrom::End(0));
                debug!("Tailing log file: {}", path);
                Some(br)
            }
            Err(e) => {
                warn!("Failed to open {}: {}", path, e);
                None
            }
        }
    } else {
        // File doesn't exist yet (will be created by the application)
        debug!("Log file not yet present, waiting: {}", path);
        None
    };

    info!("Log tailer started: {}", path);

    // Multiline pending buffer — persists across Modify events
    let mut pending: Vec<String> = Vec::new();
    let mut pending_level: String = String::new();
    // Tracks when the first line of the current pending was added.
    // Used to flush stale pending when no new lines arrive (e.g. zombie process).
    let mut pending_since: Option<Instant> = None;

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Log tailer stopping: {}", path);
            return;
        }

        let event = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(ev) => ev,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Flush stale pending if no new lines have arrived for 5 s.
                // Covers the zombie-process case: service dies mid-stack-trace,
                // no more Modify events arrive, pending would never be flushed otherwise.
                if pending_since.map(|t| t.elapsed() >= Duration::from_secs(5)).unwrap_or(false) {
                    flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                    pending.clear();
                    pending_level.clear();
                    pending_since = None;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Watcher channel disconnected for {}", path);
                return;
            }
        };

        let event = match event {
            Ok(e) => e,
            Err(e) => {
                warn!("Watch error for {}: {}", path, e);
                continue;
            }
        };

        // Only react to events that affect our target file
        let affects_target = event.paths.iter().any(|p| p == &path_buf);
        if !affects_target {
            continue;
        }

        match event.kind {
            // ── New data written to the active log file ─────────────────────
            EventKind::Modify(_) => {
                if let Some(ref mut f) = file {
                    read_new_lines(
                        f, &path, &log_type, &matcher, &services, &counter,
                        multiline, &mut pending, &mut pending_level, &mut pending_since,
                    );
                }
            }

            // ── File created (or re-created after rotation) ──────────────────
            // JEUS pattern: JeusServer.log renamed to JeusServer_20260409.log,
            // then a new JeusServer.log is created → we re-open from position 0.
            EventKind::Create(_) => {
                // Flush pending before switching to new file
                flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                pending.clear();
                pending_level.clear();
                pending_since = None;
                match File::open(&path_buf) {
                    Ok(f) => {
                        let mut br = BufReader::new(f);
                        // Read from the beginning of the new file
                        let _ = br.seek(SeekFrom::Start(0));
                        info!("Log rotation detected, re-opened: {}", path);
                        read_new_lines(
                            &mut br, &path, &log_type, &matcher, &services, &counter,
                            multiline, &mut pending, &mut pending_level, &mut pending_since,
                        );
                        file = Some(br);
                    }
                    Err(e) => warn!("Failed to re-open after rotation {}: {}", path, e),
                }
            }

            // ── File removed (rotation rename-away without immediate recreate) ─
            EventKind::Remove(_) => {
                // Flush pending before file disappears
                flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                pending.clear();
                pending_level.clear();
                pending_since = None;
                info!("Log file removed (rotation?): {} — waiting for recreate", path);
                file = None;
            }

            _ => {}
        }
    }
}

/// Start tailing a glob pattern (e.g. `/logs/catalina.*.log`).
/// Tracks the latest matching file (mtime) and automatically switches when a
/// new matching file is created (daily dated filenames: catalina.20260722.log).
/// Runs in a blocking loop on a dedicated OS thread.
pub fn start_glob_tailer(
    pattern: String,
    log_type: String,
    multiline: bool,
    matcher: KeywordMatcher,
    services: Vec<ServiceConfig>,
    counter: LogCounter,
    stop: Arc<AtomicBool>,
) {
    let parent = glob_parent(&pattern);

    if !parent.exists() {
        warn!("Log parent directory not found, skipping: {}", parent.display());
        return;
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(tx, notify::Config::default()) {
        Ok(w) => w,
        Err(e) => {
            warn!("Failed to create watcher for {}: {}", pattern, e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&parent, RecursiveMode::NonRecursive) {
        warn!("Failed to watch directory {:?}: {}", parent, e);
        return;
    }

    let glob_pat = match glob::Pattern::new(&pattern) {
        Ok(p) => p,
        Err(e) => {
            warn!("Invalid glob pattern '{}': {}", pattern, e);
            return;
        }
    };

    // 시작 시 현재 가장 최신 매칭 파일을 tail (과거 라인은 무시)
    let mut active_path: Option<PathBuf> = find_latest_matching(&pattern);
    let mut file: Option<BufReader<File>> = active_path.as_ref().and_then(|p| {
        match File::open(p) {
            Ok(f) => {
                let mut br = BufReader::new(f);
                let _ = br.seek(SeekFrom::End(0));
                info!("Glob log tailer started: {} → {}", pattern, p.display());
                Some(br)
            }
            Err(e) => {
                warn!("Failed to open {}: {}", p.display(), e);
                None
            }
        }
    });

    if active_path.is_none() {
        info!("No matching log file yet, waiting: {}", pattern);
    }

    // Multiline pending buffer — persists across Modify events
    let mut pending: Vec<String> = Vec::new();
    let mut pending_level: String = String::new();
    let mut pending_since: Option<Instant> = None;

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Glob log tailer stopping: {}", pattern);
            return;
        }

        let event = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(ev) => ev,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if pending_since.map(|t| t.elapsed() >= Duration::from_secs(5)).unwrap_or(false) {
                    flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                    pending.clear();
                    pending_level.clear();
                    pending_since = None;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Watcher channel disconnected for {}", pattern);
                return;
            }
        };

        let event = match event {
            Ok(e) => e,
            Err(e) => {
                warn!("Watch error for {}: {}", pattern, e);
                continue;
            }
        };

        for event_path in &event.paths {
            if !glob_pat.matches_path(event_path) {
                continue;
            }

            match event.kind {
                // ── 새 매칭 파일 생성 (자정 날짜 롤링 또는 활성 파일 재생성) ──
                EventKind::Create(_) => {
                    flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                    pending.clear();
                    pending_level.clear();
                    pending_since = None;
                    match File::open(event_path) {
                        Ok(f) => {
                            let mut br = BufReader::new(f);
                            let _ = br.seek(SeekFrom::Start(0));
                            info!(
                                "New dated log detected for '{}', switched to: {}",
                                pattern,
                                event_path.display()
                            );
                            read_new_lines(
                                &mut br, &pattern, &log_type, &matcher, &services, &counter,
                                multiline, &mut pending, &mut pending_level, &mut pending_since,
                            );
                            active_path = Some(event_path.clone());
                            file = Some(br);
                        }
                        Err(e) => warn!(
                            "Failed to open new log '{}': {}",
                            event_path.display(),
                            e
                        ),
                    }
                }

                // ── 현재 활성 파일의 Modify만 처리 ──
                EventKind::Modify(_) => {
                    if active_path.as_deref() == Some(event_path.as_path()) {
                        if let Some(ref mut f) = file {
                            read_new_lines(
                                f, &pattern, &log_type, &matcher, &services, &counter,
                                multiline, &mut pending, &mut pending_level, &mut pending_since,
                            );
                        }
                    }
                }

                // ── 활성 파일 삭제 — 다음 매칭 파일 생성 대기 ──
                EventKind::Remove(_) => {
                    if active_path.as_deref() == Some(event_path.as_path()) {
                        flush_pending(&pending, &pending_level, &log_type, &services, &counter);
                        pending.clear();
                        pending_level.clear();
                        pending_since = None;
                        info!(
                            "Active log file removed: {} — waiting for new matching file",
                            event_path.display()
                        );
                        file = None;
                        active_path = None;
                    }
                }

                _ => {}
            }
        }
    }
}

/// glob 패턴에서 감시할 부모 디렉토리를 추출한다.
/// `/logs/catalina.*.log` → `/logs`
fn glob_parent(pattern: &str) -> PathBuf {
    std::path::Path::new(pattern)
        .parent()
        .filter(|p| *p != std::path::Path::new(""))
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// glob 패턴에 매칭되는 파일 중 mtime이 가장 최신인 것을 반환한다.
fn find_latest_matching(pattern: &str) -> Option<PathBuf> {
    glob::glob(pattern)
        .ok()?
        .filter_map(|r| r.ok())
        .filter(|p| p.is_file())
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

/// Read all available new lines from `file` and count keyword matches.
/// In multiline mode, pending/pending_level/pending_since persist across calls (across Modify events).
fn read_new_lines(
    file: &mut BufReader<File>,
    path: &str,
    log_type: &str,
    matcher: &KeywordMatcher,
    services: &[ServiceConfig],
    counter: &LogCounter,
    multiline: bool,
    pending: &mut Vec<String>,
    pending_level: &mut String,
    pending_since: &mut Option<Instant>,
) {
    let mut line = String::new();
    loop {
        line.clear();
        match file.read_line(&mut line) {
            Ok(0) => break, // EOF: pending 유지 (다음 Modify 이벤트에서 계속)
            Ok(_) => {
                let trimmed = line.trim_end();
                if multiline {
                    if is_stack_continuation(trimmed) {
                        if !pending.is_empty() {
                            pending.push(trimmed.to_string());
                        }
                        // pending 없으면 orphan 스택 줄 무시
                    } else {
                        flush_pending(pending, pending_level, log_type, services, counter);
                        pending.clear();
                        pending_level.clear();
                        *pending_since = None;
                        if let Some(level) = matcher.find_level(trimmed) {
                            pending.push(trimmed.to_string());
                            *pending_level = level.to_string();
                            *pending_since = Some(Instant::now());
                        }
                    }
                } else {
                    if let Some(level) = matcher.find_level(trimmed) {
                        let template = extract_template(trimmed);
                        let svc_name = find_service(trimmed, services);
                        counter.increment(log_type, level, &template, &svc_name);
                        debug!("Log hit: level={} svc={}", level, svc_name);
                    }
                }
            }
            Err(e) => {
                warn!("Read error on {}: {}", path, e);
                break;
            }
        }
    }
}

fn flush_pending(
    pending: &[String],
    pending_level: &str,
    log_type: &str,
    services: &[ServiceConfig],
    counter: &LogCounter,
) {
    if pending.is_empty() || pending_level.is_empty() {
        return;
    }
    let full = pending.join("\n");
    let template = extract_template(&full);
    let svc_name = find_service(&pending[0], services);
    counter.increment(log_type, pending_level, &template, &svc_name);
    debug!("Log hit (multiline): level={} lines={}", pending_level, pending.len());
}

fn is_stack_continuation(line: &str) -> bool {
    line.starts_with('\t') || line.starts_with("Caused by:")
}

fn find_service(line: &str, services: &[ServiceConfig]) -> String {
    for svc in services {
        if line.contains(&svc.process_match) {
            return svc.name.clone();
        }
    }
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AgentConfig;
    use std::io::Write;
    use tempfile::TempDir;

    fn test_agent_cfg() -> AgentConfig {
        AgentConfig {
            system_name: "test".to_string(),
            display_name: "test".to_string(),
            instance_role: "default".to_string(),
            host: "testhost".to_string(),
            collect_interval_secs: 15,
            top_process_count: 10,
            log_dir: "./logs".to_string(),
            log_retention_days: 7,
        }
    }

    fn spawn_glob_tailer(pattern: &str, counter: &LogCounter) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        let matcher = KeywordMatcher::new(&["ERROR".to_string()]);
        let pattern = pattern.to_string();
        let counter = counter.clone();
        let stop_clone = stop.clone();
        std::thread::spawn(move || {
            start_glob_tailer(
                pattern,
                "app".to_string(),
                false,
                matcher,
                Vec::new(),
                counter,
                stop_clone,
            );
        });
        stop
    }

    /// Drain the counter repeatedly for up to 8s until `expected` total hits accumulate.
    fn wait_for_count(counter: &LogCounter, expected: u64) -> u64 {
        let cfg = test_agent_cfg();
        let mut total: u64 = 0;
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            for s in counter.drain_as_samples(&cfg) {
                total += s.value as u64;
            }
            if total >= expected {
                return total;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        total
    }

    fn append_line(path: &std::path::Path, line: &str) {
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(path)
            .unwrap();
        writeln!(f, "{}", line).unwrap();
        f.flush().unwrap();
    }

    #[test]
    fn test_glob_tailer_tails_latest_matching_file() {
        let dir = TempDir::new().unwrap();
        let old_file = dir.path().join("app.20260721.log");
        std::fs::write(&old_file, "INFO old day\n").unwrap();
        let latest_file = dir.path().join("app.20260722.log");
        std::fs::write(&latest_file, "INFO boot\n").unwrap();

        let pattern = dir.path().join("app.*.log");
        let counter = LogCounter::new();
        let stop = spawn_glob_tailer(pattern.to_str().unwrap(), &counter);

        // Give the watcher time to attach
        std::thread::sleep(Duration::from_millis(1000));

        append_line(&latest_file, "2026-07-22 ERROR something broke");

        let total = wait_for_count(&counter, 1);
        stop.store(true, Ordering::Relaxed);
        assert_eq!(total, 1, "appended ERROR line on latest file should be counted");
    }

    #[test]
    fn test_glob_tailer_switches_to_new_dated_file() {
        let dir = TempDir::new().unwrap();
        let day1 = dir.path().join("app.20260722.log");
        std::fs::write(&day1, "INFO boot\n").unwrap();

        let pattern = dir.path().join("app.*.log");
        let counter = LogCounter::new();
        let stop = spawn_glob_tailer(pattern.to_str().unwrap(), &counter);

        std::thread::sleep(Duration::from_millis(1000));

        // Midnight roll: a brand-new dated file appears and receives lines
        let day2 = dir.path().join("app.20260723.log");
        append_line(&day2, "2026-07-23 ERROR new day failure");

        let total = wait_for_count(&counter, 1);

        // Lines appended to the new active file afterwards must also be tracked
        append_line(&day2, "2026-07-23 ERROR second failure");
        let total2 = wait_for_count(&counter, 1);

        stop.store(true, Ordering::Relaxed);
        assert_eq!(total, 1, "ERROR in newly created dated file should be counted");
        assert_eq!(total2, 1, "ERROR appended to the new active file should be counted");
    }
}
