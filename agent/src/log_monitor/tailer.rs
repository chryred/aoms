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
use std::time::Duration;
use tracing::{debug, info, warn};

/// Start tailing a log file. Runs in a blocking loop on a dedicated OS thread.
///
/// Log rotation handling (e.g. JeusServer.log → JeusServer_20260409.log):
///   - Watches the **parent directory** instead of the file directly.
///   - On `Create` event for the target filename, the file is re-opened from the
///     beginning (the old file was rotated away; a fresh file appeared at the same path).
///   - On `Modify` events for the target filename, new lines are read as usual.
///
/// `multiline`: when true, consecutive Java stack trace lines (`\t` / `Caused by:`)
///   following an ERROR line are merged into a single event.
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

    loop {
        if stop.load(Ordering::Relaxed) {
            info!("Log tailer stopping: {}", path);
            return;
        }

        let event = match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(ev) => ev,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
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
                        multiline, &mut pending, &mut pending_level,
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
                match File::open(&path_buf) {
                    Ok(f) => {
                        let mut br = BufReader::new(f);
                        // Read from the beginning of the new file
                        let _ = br.seek(SeekFrom::Start(0));
                        info!("Log rotation detected, re-opened: {}", path);
                        read_new_lines(
                            &mut br, &path, &log_type, &matcher, &services, &counter,
                            multiline, &mut pending, &mut pending_level,
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
                info!("Log file removed (rotation?): {} — waiting for recreate", path);
                file = None;
            }

            _ => {}
        }
    }
}

/// Read all available new lines from `file` and count keyword matches.
/// In multiline mode, pending/pending_level persist across calls (across Modify events).
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
                        if let Some(level) = matcher.find_level(trimmed) {
                            pending.push(trimmed.to_string());
                            *pending_level = level.to_string();
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
