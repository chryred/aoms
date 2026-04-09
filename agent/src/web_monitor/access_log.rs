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
/// Log rotation is handled the same way as `log_monitor::tailer`:
///   - Parent directory is watched so `Create` events on the target path are detected.
///   - On rotation (Remove then Create), the file is re-opened from position 0.
///
/// `stop`: set to `true` to signal this tailer to exit on the next poll cycle.
pub fn start_access_log_tailer(
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
