mod config;
mod log_monitor;
mod metrics;
mod preprocessor;
mod web_monitor;
mod writer;

use config::Config;
use log_monitor::{matcher::KeywordMatcher, tailer::start_tailer, LogCounter};
use metrics::MetricSample;
use preprocessor::{Correlator, Summarizer};
use std::collections::{HashMap, HashSet};
use std::env;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;
use tokio::time::interval;
use tracing::{error, info, warn};
use tracing_appender::rolling;
use web_monitor::{access_log::start_access_log_tailer, HttpCounter};
use writer::{compress::compress, encode::encode_samples, sender::RemoteWriteSender, wal::Wal};

const VERSION: &str = env!("CARGO_PKG_VERSION");

// How many collect cycles before attempting a WAL retry (15s × 4 = ~60s)
const WAL_RETRY_CYCLES: u64 = 4;

#[tokio::main]
async fn main() {
    let config_path = env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());

    // Load config first so we know log_dir before initializing tracing
    let initial_cfg = match Config::load(&config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to load config: {}", e);
            std::process::exit(1);
        }
    };

    // Ensure log directory exists
    if let Err(e) = std::fs::create_dir_all(&initial_cfg.agent.log_dir) {
        eprintln!("Failed to create log dir '{}': {}", initial_cfg.agent.log_dir, e);
        std::process::exit(1);
    }

    // Daily rolling file appender (agent.log.YYYY-MM-DD)
    let file_appender = rolling::daily(&initial_cfg.agent.log_dir, "agent.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(non_blocking)
        .init();

    let mut cfg = Arc::new(initial_cfg);

    info!(
        "AOMS Agent v{} starting — system_name={} host={}",
        VERSION, cfg.agent.system_name, cfg.agent.host
    );

    let wal = match Wal::new(&cfg.remote_write.wal_dir, cfg.remote_write.wal_retention_hours) {
        Ok(w) => Arc::new(w),
        Err(e) => {
            error!("Failed to init WAL: {}", e);
            std::process::exit(1);
        }
    };

    let sender = Arc::new(RemoteWriteSender::new(&cfg.remote_write));

    // ── Config hot-reload channel ────────────────────────────────────────────
    // An OS thread watches the config file; it sends new Config values here.
    let (reload_tx, reload_rx) = mpsc::channel::<Config>();
    {
        let config_path_clone = config_path.clone();
        let reload_tx_clone = reload_tx.clone();
        std::thread::spawn(move || {
            watch_config_file(&config_path_clone, reload_tx_clone);
        });
    }

    // ── Log tailer lifecycle tracking ───────────────────────────────────────
    // path → stop flag. When we want to stop a tailer, set its flag to true.
    let mut log_tailer_stops: HashMap<String, Arc<AtomicBool>> = HashMap::new();
    let mut web_tailer_stops: HashMap<String, Arc<AtomicBool>> = HashMap::new();

    // Shared counters
    let log_counter = LogCounter::new();
    let mut web_counters: HashMap<String, (HttpCounter, Arc<config::WebServerConfig>)> =
        HashMap::new();

    // Start initial tailers
    start_log_tailers(&cfg, &log_counter, &mut log_tailer_stops);
    start_web_tailers(&cfg, &mut web_counters, &mut web_tailer_stops);

    // ── Preprocessors ───────────────────────────────────────────────────────
    let mut summarizer = if cfg.collectors.preprocessor {
        Some(Summarizer::new(cfg.preprocessor.summary_intervals_secs.clone()))
    } else {
        None
    };
    let mut correlator = if cfg.collectors.preprocessor {
        Some(Correlator::new(
            cfg.preprocessor.corr_window_secs,
            cfg.preprocessor.cpu_threshold,
            cfg.preprocessor.memory_threshold,
            cfg.preprocessor.log_error_min,
        ))
    } else {
        None
    };

    // ── Startup WAL replay ───────────────────────────────────────────────────
    replay_wal(&wal, &sender).await;

    let mut ticker = interval(Duration::from_secs(cfg.agent.collect_interval_secs));
    let gc_interval = 3600 / cfg.agent.collect_interval_secs.max(1);
    let mut gc_counter: u64 = 0;
    let mut wal_retry_counter: u64 = 0;

    loop {
        ticker.tick().await;

        // ── Check for config reload ──────────────────────────────────────────
        if let Ok(new_cfg) = reload_rx.try_recv() {
            info!("Applying reloaded config");
            let old_cfg = cfg.clone();
            cfg = Arc::new(new_cfg);

            // Reconcile log tailers: stop removed paths, start new paths
            reconcile_log_tailers(
                &old_cfg,
                &cfg,
                &log_counter,
                &mut log_tailer_stops,
            );
            // Reconcile web tailers: stop removed, start new
            reconcile_web_tailers(
                &old_cfg,
                &cfg,
                &mut web_counters,
                &mut web_tailer_stops,
            );

            // Reinitialize preprocessor if toggled
            if cfg.collectors.preprocessor && summarizer.is_none() {
                summarizer = Some(Summarizer::new(cfg.preprocessor.summary_intervals_secs.clone()));
                correlator = Some(Correlator::new(
                    cfg.preprocessor.corr_window_secs,
                    cfg.preprocessor.cpu_threshold,
                    cfg.preprocessor.memory_threshold,
                    cfg.preprocessor.log_error_min,
                ));
                info!("Preprocessor enabled via config reload");
            } else if !cfg.collectors.preprocessor && summarizer.is_some() {
                summarizer = None;
                correlator = None;
                info!("Preprocessor disabled via config reload");
            }
        }

        let mut all_samples: Vec<MetricSample> = Vec::new();

        // ── Metric collectors (on/off controlled by config) ──────────────────
        if cfg.collectors.cpu {
            all_samples.extend(metrics::cpu::collect(&cfg.agent));
        }
        if cfg.collectors.memory {
            all_samples.extend(metrics::memory::collect(&cfg.agent));
        }
        if cfg.collectors.disk {
            all_samples.extend(metrics::disk::collect(&cfg.agent));
        }
        if cfg.collectors.network {
            all_samples.extend(metrics::network::collect(&cfg.agent));
        }
        if cfg.collectors.tcp_connections {
            all_samples.extend(metrics::network::collect_tcp(&cfg.agent));
        }
        if cfg.collectors.process {
            all_samples.extend(metrics::process::collect(&cfg.agent, &cfg.services));
        }

        // Log error metrics (from background tailers)
        if cfg.collectors.log_monitor {
            all_samples.extend(log_counter.drain_as_samples(&cfg.agent));
        }

        // HTTP metrics (from background tailers)
        if cfg.collectors.web_servers {
            for (counter, ws_cfg) in web_counters.values() {
                all_samples.extend(counter.drain_as_samples(&cfg.agent, ws_cfg));
            }
        }

        // Heartbeat
        if cfg.collectors.heartbeat {
            let mut base = metrics::base_labels(
                &cfg.agent.system_name,
                &cfg.agent.display_name,
                &cfg.agent.instance_role,
                &cfg.agent.host,
            );
            base.push(("version".to_string(), VERSION.to_string()));
            all_samples.push(MetricSample::new("agent_up", base.clone(), 1.0));
            for collector in ["cpu", "memory", "disk", "network", "process", "log", "web"] {
                let mut lbs = base.clone();
                lbs.push(("collector".to_string(), collector.to_string()));
                all_samples.push(MetricSample::new("agent_heartbeat", lbs, 1.0));
            }
        }

        // Preprocessor summaries + correlation
        if let Some(ref mut sum) = summarizer {
            sum.feed(&all_samples);
            all_samples.extend(sum.summarize());
        }
        if let Some(ref mut corr) = correlator {
            corr.observe(&all_samples);
            all_samples.extend(corr.correlate(&cfg.agent));
        }

        if !all_samples.is_empty() {
            let encoded = encode_samples(&all_samples);
            let compressed = compress(&encoded);

            match sender.send(compressed.clone()).await {
                Ok(()) => {
                    info!("Sent {} samples ({} bytes)", all_samples.len(), compressed.len());
                }
                Err(e) => {
                    warn!("Remote write failed, buffering to WAL: {}", e);
                    if let Err(we) = wal.append(&compressed) {
                        error!("WAL append failed: {}", we);
                    }
                }
            }
        }

        // ── Runtime WAL retry ────────────────────────────────────────────────
        wal_retry_counter += 1;
        if wal_retry_counter >= WAL_RETRY_CYCLES {
            wal_retry_counter = 0;
            if wal.has_pending() {
                info!("WAL has pending entries, attempting retry...");
                replay_wal(&wal, &sender).await;
            }
        }

        // ── Periodic GC ──────────────────────────────────────────────────────
        gc_counter += 1;
        if gc_counter >= gc_interval {
            gc_counter = 0;
            let _ = wal.gc();
            gc_old_logs(&cfg.agent.log_dir, cfg.agent.log_retention_days);
        }
    }
}

// ── Log file GC helper ───────────────────────────────────────────────────────

fn gc_old_logs(log_dir: &str, retention_days: u64) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(retention_days * 86400))
        .unwrap_or(std::time::UNIX_EPOCH);

    let entries = match std::fs::read_dir(log_dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let fname = entry.file_name();
        let name = fname.to_string_lossy();
        // tracing-appender daily format: agent.log.YYYY-MM-DD
        if !name.starts_with("agent.log.") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            if modified < cutoff {
                if let Err(e) = std::fs::remove_file(entry.path()) {
                    warn!("Log GC: failed to remove {:?}: {}", entry.path(), e);
                } else {
                    info!("Log GC: removed {:?}", entry.path());
                }
            }
        }
    }
}

// ── WAL replay helper ────────────────────────────────────────────────────────

async fn replay_wal(wal: &Arc<Wal>, sender: &Arc<RemoteWriteSender>) {
    match wal.drain_pending() {
        Ok((payloads, paths)) if !payloads.is_empty() => {
            info!("Replaying {} WAL entries...", payloads.len());
            let mut all_sent = true;
            for payload in &payloads {
                if let Err(e) = sender.send(payload.clone()).await {
                    warn!("WAL replay send failed: {}", e);
                    all_sent = false;
                    break;
                }
            }
            if all_sent {
                let _ = wal.confirm_sent(&paths);
                info!("WAL replay complete, {} segment(s) cleared", paths.len());
            } else {
                warn!("WAL replay incomplete — will retry next cycle");
            }
        }
        Ok(_) => {} // no pending entries
        Err(e) => warn!("WAL drain error: {}", e),
    }
}

// ── Config file watcher (runs on a dedicated OS thread) ─────────────────────

fn watch_config_file(config_path: &str, tx: mpsc::Sender<Config>) {
    use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
    use std::path::Path;

    let (wtx, wrx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = match RecommendedWatcher::new(wtx, notify::Config::default()) {
        Ok(w) => w,
        Err(e) => {
            warn!("Config watcher init failed: {}", e);
            return;
        }
    };
    if let Err(e) = watcher.watch(Path::new(config_path), RecursiveMode::NonRecursive) {
        warn!("Config watcher watch failed: {}", e);
        return;
    }

    info!("Config hot-reload watching: {}", config_path);

    for event in wrx {
        match event {
            Ok(Event {
                kind: EventKind::Modify(_),
                ..
            }) => {
                // Brief delay to let the writer finish flushing the file
                std::thread::sleep(Duration::from_millis(200));
                match Config::load(config_path) {
                    Ok(new_cfg) => {
                        info!("Config file changed, reloading...");
                        if tx.send(new_cfg).is_err() {
                            // Main loop exited
                            return;
                        }
                    }
                    Err(e) => warn!("Config reload parse error: {}", e),
                }
            }
            _ => {}
        }
    }
}

// ── Tailer lifecycle helpers ─────────────────────────────────────────────────

/// Expand glob patterns and spawn a tailer for each matched path.
fn start_log_tailers(
    cfg: &Config,
    counter: &LogCounter,
    stops: &mut HashMap<String, Arc<AtomicBool>>,
) {
    if !cfg.collectors.log_monitor {
        return;
    }
    for lm_cfg in &cfg.log_monitor {
        for raw_path in &lm_cfg.paths {
            for path in expand_glob(raw_path) {
                if stops.contains_key(&path) {
                    continue; // already running
                }
                let stop = Arc::new(AtomicBool::new(false));
                let matcher = KeywordMatcher::new(&lm_cfg.keywords);
                let log_type = lm_cfg.log_type.clone();
                let services = cfg.services.clone();
                let counter_clone = counter.clone();
                let stop_clone = stop.clone();
                let path_clone = path.clone();
                std::thread::spawn(move || {
                    start_tailer(path_clone, log_type, matcher, services, counter_clone, stop_clone);
                });
                info!("Log tailer spawned: {} (log_type={})", path, lm_cfg.log_type);
                stops.insert(path, stop);
            }
        }
    }
}

fn start_web_tailers(
    cfg: &Config,
    counters: &mut HashMap<String, (HttpCounter, Arc<config::WebServerConfig>)>,
    stops: &mut HashMap<String, Arc<AtomicBool>>,
) {
    if !cfg.collectors.web_servers {
        return;
    }
    for ws in &cfg.web_servers {
        let key = ws.log_path.clone();
        if stops.contains_key(&key) {
            continue;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let counter = HttpCounter::new();
        let counter_clone = counter.clone();
        let ws_arc = Arc::new(ws.clone());
        let ws_clone = ws.clone();
        let stop_clone = stop.clone();
        std::thread::spawn(move || {
            start_access_log_tailer(ws_clone, counter_clone, stop_clone);
        });
        info!("Web tailer spawned: {} ({})", ws.name, ws.log_path);
        counters.insert(key.clone(), (counter, ws_arc));
        stops.insert(key, stop);
    }
}

/// Compare old vs new config and stop/start log tailers as needed.
fn reconcile_log_tailers(
    old_cfg: &Config,
    new_cfg: &Config,
    counter: &LogCounter,
    stops: &mut HashMap<String, Arc<AtomicBool>>,
) {
    let old_paths: HashSet<String> = old_cfg
        .log_monitor
        .iter()
        .flat_map(|lm| lm.paths.iter())
        .flat_map(|p| expand_glob(p))
        .collect();

    // Stop tailers for removed paths
    let new_all_paths: HashSet<String> = new_cfg
        .log_monitor
        .iter()
        .flat_map(|lm| lm.paths.iter())
        .flat_map(|p| expand_glob(p))
        .collect();
    for removed in old_paths.difference(&new_all_paths) {
        if let Some(stop) = stops.remove(removed) {
            stop.store(true, Ordering::Relaxed);
            info!("Log tailer stop requested: {}", removed);
        }
    }

    // Start tailers for new paths (if log_monitor is enabled)
    if new_cfg.collectors.log_monitor {
        for lm_cfg in &new_cfg.log_monitor {
            for raw_path in &lm_cfg.paths {
                for added in expand_glob(raw_path) {
                    if stops.contains_key(&added) || old_paths.contains(&added) {
                        continue;
                    }
                    let stop = Arc::new(AtomicBool::new(false));
                    let matcher = KeywordMatcher::new(&lm_cfg.keywords);
                    let log_type = lm_cfg.log_type.clone();
                    let services = new_cfg.services.clone();
                    let counter_clone = counter.clone();
                    let stop_clone = stop.clone();
                    let path_clone = added.clone();
                    std::thread::spawn(move || {
                        start_tailer(path_clone, log_type, matcher, services, counter_clone, stop_clone);
                    });
                    info!("Log tailer spawned (hot-reload): {} (log_type={})", added, lm_cfg.log_type);
                    stops.insert(added, stop);
                }
            }
        }
    }

    // If log_monitor was just disabled, stop all tailers
    if !new_cfg.collectors.log_monitor && old_cfg.collectors.log_monitor {
        for (path, stop) in stops.drain() {
            stop.store(true, Ordering::Relaxed);
            info!("Log tailer stop requested (collector disabled): {}", path);
        }
    }
}

fn reconcile_web_tailers(
    old_cfg: &Config,
    new_cfg: &Config,
    counters: &mut HashMap<String, (HttpCounter, Arc<config::WebServerConfig>)>,
    stops: &mut HashMap<String, Arc<AtomicBool>>,
) {
    let old_keys: HashSet<String> = old_cfg.web_servers.iter().map(|w| w.log_path.clone()).collect();
    let new_keys: HashSet<String> = new_cfg.web_servers.iter().map(|w| w.log_path.clone()).collect();

    // Stop removed
    for removed in old_keys.difference(&new_keys) {
        if let Some(stop) = stops.remove(removed) {
            stop.store(true, Ordering::Relaxed);
            info!("Web tailer stop requested: {}", removed);
        }
        counters.remove(removed);
    }

    // Start added
    if new_cfg.collectors.web_servers {
        for ws in &new_cfg.web_servers {
            let key = ws.log_path.clone();
            if stops.contains_key(&key) {
                continue;
            }
            let stop = Arc::new(AtomicBool::new(false));
            let counter = HttpCounter::new();
            let counter_clone = counter.clone();
            let ws_arc = Arc::new(ws.clone());
            let ws_clone = ws.clone();
            let stop_clone = stop.clone();
            std::thread::spawn(move || {
                start_access_log_tailer(ws_clone, counter_clone, stop_clone);
            });
            info!("Web tailer spawned (hot-reload): {} ({})", ws.name, ws.log_path);
            counters.insert(key.clone(), (counter, ws_arc));
            stops.insert(key, stop);
        }
    }

    // If web_servers was just disabled, stop all
    if !new_cfg.collectors.web_servers && old_cfg.collectors.web_servers {
        for (path, stop) in stops.drain() {
            stop.store(true, Ordering::Relaxed);
            info!("Web tailer stop requested (collector disabled): {}", path);
        }
        counters.clear();
    }
}

// ── Glob expansion ───────────────────────────────────────────────────────────

/// Expand a path that may contain glob wildcards (e.g. `/opt/app/logs/*.log`).
/// Returns all currently matching file paths. Non-glob paths are returned as-is.
fn expand_glob(pattern: &str) -> Vec<String> {
    if !pattern.contains('*') && !pattern.contains('?') && !pattern.contains('[') {
        return vec![pattern.to_string()];
    }
    match glob::glob(pattern) {
        Ok(paths) => paths
            .filter_map(|p| p.ok())
            .filter(|p| p.is_file())
            .filter_map(|p| p.to_str().map(|s| s.to_string()))
            .collect(),
        Err(e) => {
            warn!("Glob pattern error '{}': {}", pattern, e);
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_gc_old_logs_removes_old_files() {
        let dir = TempDir::new().unwrap();
        let dir_path = dir.path().to_str().unwrap();

        // Create an "old" log file and backdate its mtime
        let old_file = dir.path().join("agent.log.2020-01-01");
        std::fs::write(&old_file, "old log").unwrap();
        // Set mtime to 30 days ago
        let old_time = filetime::FileTime::from_unix_time(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
                - 30 * 86400,
            0,
        );
        filetime::set_file_mtime(&old_file, old_time).unwrap();

        // Create a recent log file
        let recent_file = dir.path().join("agent.log.2099-01-01");
        std::fs::write(&recent_file, "recent log").unwrap();

        // Create a non-log file (should be ignored)
        let other_file = dir.path().join("other.txt");
        std::fs::write(&other_file, "not a log").unwrap();

        gc_old_logs(dir_path, 7);

        assert!(!old_file.exists(), "old log file should be removed");
        assert!(recent_file.exists(), "recent log file should be kept");
        assert!(other_file.exists(), "non-log file should be ignored");
    }

    #[test]
    fn test_gc_old_logs_keeps_all_within_retention() {
        let dir = TempDir::new().unwrap();
        let dir_path = dir.path().to_str().unwrap();

        let file = dir.path().join("agent.log.2099-12-31");
        std::fs::write(&file, "recent").unwrap();

        gc_old_logs(dir_path, 7);

        assert!(file.exists(), "recent file should be kept");
    }

    #[test]
    fn test_gc_old_logs_nonexistent_dir() {
        // Should not panic
        gc_old_logs("/nonexistent/path/that/does/not/exist", 7);
    }
}
