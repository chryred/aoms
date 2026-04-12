use super::{base_labels, MetricSample};
use crate::config::AgentConfig;

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    use procfs::Current;
    let Ok(meminfo) = procfs::Meminfo::current() else {
        return vec![];
    };

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    let mut samples = Vec::new();

    let types = [
        ("used", (meminfo.mem_total - meminfo.mem_available.unwrap_or(meminfo.mem_free)) as f64 * 1024.0),
        ("cached", meminfo.cached as f64 * 1024.0),
        ("free", meminfo.mem_free as f64 * 1024.0),
        ("swap_used", (meminfo.swap_total - meminfo.swap_free) as f64 * 1024.0),
    ];

    for (t, val) in types {
        let mut lbs = base.clone();
        lbs.push(("type".to_string(), t.to_string()));
        samples.push(MetricSample::new("memory_used_bytes", lbs, val));
    }

    // total for reference
    let mut lbs_total = base.clone();
    lbs_total.push(("type".to_string(), "total".to_string()));
    samples.push(MetricSample::new(
        "memory_used_bytes",
        lbs_total,
        meminfo.mem_total as f64 * 1024.0,
    ));

    samples
}

#[cfg(not(target_os = "linux"))]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );
    let mut lbs = base;
    lbs.push(("type".to_string(), "used".to_string()));
    vec![MetricSample::new("memory_used_bytes", lbs, 0.0)]
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
    fn test_collect() {
        let samples = collect(&test_cfg());
        assert!(!samples.is_empty());
        assert!(samples.iter().all(|s| s.name == "memory_used_bytes"));
    }
}
