use super::{base_labels, MetricSample};
use crate::config::AgentConfig;

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    use procfs::{Current, CurrentSI, KernelStats};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::Instant;

    static PREV: std::sync::OnceLock<Mutex<(HashMap<String, [u64; 4]>, Instant)>> =
        std::sync::OnceLock::new();

    let Ok(stats) = KernelStats::current() else {
        return vec![];
    };

    let now = Instant::now();
    let mut samples = Vec::new();

    // load averages
    if let Ok(loadavg) = procfs::LoadAverage::current() {
        let base = base_labels(
            &cfg.system_name,
            &cfg.display_name,
            &cfg.instance_role,
            &cfg.host,
        );
        for (interval, val) in [("1m", loadavg.one), ("5m", loadavg.five), ("15m", loadavg.fifteen)] {
            let mut lbs = base.clone();
            lbs.push(("interval".to_string(), interval.to_string()));
            samples.push(MetricSample::new("cpu_load_avg", lbs, val as f64));
        }
    }

    // per-core CPU usage via delta
    let mut current_map: HashMap<String, [u64; 4]> = HashMap::new();

    // total cpu
    {
        let c = &stats.total;
        let key = "total".to_string();
        let vals = [c.user + c.nice, c.system, c.idle, c.iowait.unwrap_or(0)];
        current_map.insert(key, vals);
    }
    // per-core
    for (i, c) in stats.cpu_time.iter().enumerate() {
        let key = format!("cpu{}", i);
        let vals = [c.user + c.nice, c.system, c.idle, c.iowait.unwrap_or(0)];
        current_map.insert(key, vals);
    }

    let mutex = PREV.get_or_init(|| Mutex::new((current_map.clone(), now)));
    let mut prev_guard = mutex.lock().unwrap();
    let (ref prev_map, _) = *prev_guard;

    for (core, curr) in &current_map {
        let base = {
            let mut lbs = base_labels(
                &cfg.system_name,
                &cfg.display_name,
                &cfg.instance_role,
                &cfg.host,
            );
            lbs.push(("core".to_string(), core.clone()));
            lbs
        };
        if let Some(prev) = prev_map.get(core) {
            let curr_total = curr.iter().sum::<u64>() as f64;
            let prev_total = prev.iter().sum::<u64>() as f64;
            let delta_total = curr_total - prev_total;
            if delta_total > 0.0 {
                let delta_idle = (curr[2] as f64) - (prev[2] as f64);
                let usage = ((delta_total - delta_idle) / delta_total * 100.0).clamp(0.0, 100.0);
                samples.push(MetricSample::new("cpu_usage_percent", base, usage));
            }
        }
    }

    *prev_guard = (current_map, now);
    samples
}

#[cfg(not(target_os = "linux"))]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    // macOS stub for development builds
    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );
    let mut lbs = base.clone();
    lbs.push(("core".to_string(), "total".to_string()));
    vec![MetricSample::new("cpu_usage_percent", lbs, 0.0)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AgentConfig;

    fn test_cfg() -> AgentConfig {
        AgentConfig {
            system_name: "test".to_string(),
            display_name: "Test".to_string(),
            instance_role: "web".to_string(),
            host: "127.0.0.1".to_string(),
            collect_interval_secs: 15,
            top_process_count: 5,
            log_dir: "./logs".to_string(),
            log_retention_days: 7,
        }
    }

    #[test]
    fn test_collect_returns_samples() {
        let samples = collect(&test_cfg());
        // On non-linux this returns stub, on linux returns real data
        assert!(!samples.is_empty() || cfg!(not(target_os = "linux")));
    }
}
