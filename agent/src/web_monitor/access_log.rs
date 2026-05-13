use crate::config::WebServerConfig;
use crate::web_monitor::{
    parser::create_parser,
    url_normalizer::{match_pattern, normalize},
    HttpCounter,
};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;
use tracing::{debug, info, warn};

/// Start tailing a web server access log. Runs in a blocking loop on a dedicated OS thread.
///
/// `log_path`에 glob 메타문자(`*`, `?`, `[`)가 포함된 경우 glob 타일러를 실행한다.
/// WebtoB처럼 매일 새 파일명(`access_20260513.log`)을 생성하는 경우에 사용.
///
/// `stop`: set to `true` to signal this tailer to exit on the next poll cycle.
pub fn start_access_log_tailer(
    ws_cfg: WebServerConfig,
    counter: HttpCounter,
    stop: Arc<AtomicBool>,
) {
    let has_glob = ws_cfg.log_path.contains('*')
        || ws_cfg.log_path.contains('?')
        || ws_cfg.log_path.contains('[');
    if has_glob {
        start_glob_access_log_tailer(ws_cfg, counter, stop);
    } else {
        start_fixed_access_log_tailer(ws_cfg, counter, stop);
    }
}

/// glob 패턴 경로용 타일러 — 매칭 파일 중 가장 최근 파일을 추적하고,
/// 새 매칭 파일이 생성되면(자정 날짜 롤링) 자동으로 전환한다.
fn start_glob_access_log_tailer(
    ws_cfg: WebServerConfig,
    counter: HttpCounter,
    stop: Arc<AtomicBool>,
) {
    let pattern = ws_cfg.log_path.clone();
    let parent = glob_parent(&pattern);

    if !parent.exists() {
        warn!(
            "Access log parent directory not found for '{}': {}",
            ws_cfg.name,
            parent.display()
        );
        return;
    }

    let url_patterns: Vec<(String, String)> = ws_cfg
        .url_patterns
        .iter()
        .map(|p| (p.pattern.clone(), p.display.clone()))
        .collect();
    let was_service = if ws_cfg.was_services.is_empty() {
        "unknown".to_string()
    } else {
        ws_cfg.was_services.join(",")
    };

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(tx, notify::Config::default()) {
        Ok(w) => w,
        Err(e) => {
            warn!("Watcher error for '{}': {}", ws_cfg.name, e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&parent, RecursiveMode::NonRecursive) {
        warn!(
            "Watch failed for '{}' directory {:?}: {}",
            ws_cfg.name, parent, e
        );
        return;
    }

    let glob_pat = match glob::Pattern::new(&pattern) {
        Ok(p) => p,
        Err(e) => {
            warn!("Invalid glob pattern '{}' for '{}': {}", pattern, ws_cfg.name, e);
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
                info!(
                    "Glob access log tailer started: {} → {}",
                    ws_cfg.name,
                    p.display()
                );
                Some(br)
            }
            Err(e) => {
                warn!("Open failed for '{}' ({}): {}", ws_cfg.name, p.display(), e);
                None
            }
        }
    });

    if active_path.is_none() {
        info!(
            "No matching access log yet for '{}', waiting: {}",
            ws_cfg.name, pattern
        );
    }

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Glob access log tailer stopping: {}", ws_cfg.name);
            return;
        }

        let event = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(ev) => ev,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Watcher channel disconnected for '{}'", ws_cfg.name);
                return;
            }
        };

        let event = match event {
            Ok(e) => e,
            Err(e) => {
                warn!("Watch error for '{}': {}", ws_cfg.name, e);
                continue;
            }
        };

        for event_path in &event.paths {
            if !glob_pat.matches_path(event_path) {
                continue;
            }

            match event.kind {
                EventKind::Create(_) => {
                    // 새 날짜 파일 생성 — 자동 전환
                    match File::open(event_path) {
                        Ok(f) => {
                            let mut br = BufReader::new(f);
                            let _ = br.seek(SeekFrom::Start(0));
                            info!(
                                "New dated log detected for '{}', switched to: {}",
                                ws_cfg.name,
                                event_path.display()
                            );
                            read_new_lines(&mut br, &ws_cfg, &url_patterns, &was_service, &counter);
                            active_path = Some(event_path.clone());
                            file = Some(br);
                        }
                        Err(e) => warn!(
                            "Failed to open new log '{}' ({}): {}",
                            ws_cfg.name,
                            event_path.display(),
                            e
                        ),
                    }
                }
                EventKind::Modify(_) => {
                    // 현재 활성 파일의 Modify만 처리
                    if active_path.as_deref() == Some(event_path.as_path()) {
                        if let Some(ref mut f) = file {
                            read_new_lines(f, &ws_cfg, &url_patterns, &was_service, &counter);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// 고정 경로용 타일러 — 기존 로직 그대로.
///
/// Log rotation is handled by watching the parent directory:
///   - On `Create` for the target path (rotate-in), file is re-opened from position 0.
///   - On `Remove`, file pointer is released and recreate is awaited.
fn start_fixed_access_log_tailer(
    ws_cfg: WebServerConfig,
    counter: HttpCounter,
    stop: Arc<AtomicBool>,
) {
    let path_buf = PathBuf::from(&ws_cfg.log_path);
    let parent = match path_buf.parent() {
        Some(p) if p != std::path::Path::new("") => p.to_path_buf(),
        _ => std::path::PathBuf::from("."),
    };

    if !parent.exists() {
        warn!(
            "Access log parent directory not found for '{}': {}",
            ws_cfg.name,
            parent.display()
        );
        return;
    }

    let url_patterns: Vec<(String, String)> = ws_cfg
        .url_patterns
        .iter()
        .map(|p| (p.pattern.clone(), p.display.clone()))
        .collect();
    let was_service = if ws_cfg.was_services.is_empty() {
        "unknown".to_string()
    } else {
        ws_cfg.was_services.join(",")
    };

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(tx, notify::Config::default()) {
        Ok(w) => w,
        Err(e) => {
            warn!("Watcher error for '{}': {}", ws_cfg.name, e);
            return;
        }
    };

    if let Err(e) = watcher.watch(&parent, RecursiveMode::NonRecursive) {
        warn!(
            "Watch failed for '{}' directory {:?}: {}",
            ws_cfg.name, parent, e
        );
        return;
    }

    let mut file: Option<BufReader<File>> = if path_buf.exists() {
        match File::open(&path_buf) {
            Ok(f) => {
                let mut br = BufReader::new(f);
                let _ = br.seek(SeekFrom::End(0));
                debug!("Tailing access log: {} ({})", ws_cfg.log_path, ws_cfg.log_format);
                Some(br)
            }
            Err(e) => {
                warn!("Open failed for '{}': {}", ws_cfg.name, e);
                None
            }
        }
    } else {
        debug!(
            "Access log not yet present for '{}', waiting: {}",
            ws_cfg.name, ws_cfg.log_path
        );
        None
    };

    info!("Access log tailer started: {} ({})", ws_cfg.name, ws_cfg.log_path);

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Access log tailer stopping: {}", ws_cfg.name);
            return;
        }

        let event = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(ev) => ev,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                warn!("Watcher channel disconnected for '{}'", ws_cfg.name);
                return;
            }
        };

        let event = match event {
            Ok(e) => e,
            Err(e) => {
                warn!("Watch error for '{}': {}", ws_cfg.name, e);
                continue;
            }
        };

        let affects_target = event.paths.iter().any(|p| p == &path_buf);
        if !affects_target {
            continue;
        }

        match event.kind {
            EventKind::Modify(_) => {
                if let Some(ref mut f) = file {
                    read_new_lines(f, &ws_cfg, &url_patterns, &was_service, &counter);
                }
            }
            EventKind::Create(_) => {
                match File::open(&path_buf) {
                    Ok(f) => {
                        let mut br = BufReader::new(f);
                        let _ = br.seek(SeekFrom::Start(0));
                        info!(
                            "Access log rotation detected, re-opened: {}",
                            ws_cfg.log_path
                        );
                        read_new_lines(&mut br, &ws_cfg, &url_patterns, &was_service, &counter);
                        file = Some(br);
                    }
                    Err(e) => warn!(
                        "Failed to re-open access log after rotation '{}': {}",
                        ws_cfg.name, e
                    ),
                }
            }
            EventKind::Remove(_) => {
                info!(
                    "Access log removed (rotation?): {} — waiting for recreate",
                    ws_cfg.log_path
                );
                file = None;
            }
            _ => {}
        }
    }
}

/// glob 패턴에서 감시할 부모 디렉토리를 추출한다.
/// `/apps/webtob/log/sic/access_*.log` → `/apps/webtob/log/sic`
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

fn read_new_lines(
    file: &mut BufReader<File>,
    ws_cfg: &WebServerConfig,
    url_patterns: &[(String, String)],
    was_service: &str,
    counter: &HttpCounter,
) {
    let parser = create_parser(&ws_cfg.log_format);
    let mut line = String::new();
    loop {
        line.clear();
        match file.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if let Some(entry) = parser.parse_line(trimmed) {
                    let normalized = normalize(&entry.uri);
                    let (pattern, pattern_display) = match_pattern(&normalized, url_patterns);
                    counter.record(
                        pattern,
                        pattern_display,
                        &entry.method,
                        entry.status_code,
                        was_service,
                        entry.duration_ms,
                        ws_cfg.slow_threshold_ms,
                    );
                }
            }
            Err(e) => {
                warn!("Read error on {}: {}", ws_cfg.log_path, e);
                break;
            }
        }
    }
}
