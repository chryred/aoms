use super::{base_labels, MetricSample};
use crate::config::AgentConfig;

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    use std::collections::HashMap;
    use std::sync::Mutex;

    static PREV: std::sync::OnceLock<Mutex<HashMap<String, [u64; 3]>>> =
        std::sync::OnceLock::new();

    let Ok(diskstats) = procfs::diskstats() else {
        return vec![];
    };

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    let mut current_map: HashMap<String, [u64; 3]> = HashMap::new();
    let mut samples = Vec::new();

    for disk in &diskstats {
        // skip partitions (e.g. sda1), keep whole disks (sda, nvme0n1, vda)
        let name = &disk.name;
        let is_whole = !name.chars().last().map(|c| c.is_ascii_digit()).unwrap_or(false)
            || name.starts_with("nvme");
        if !is_whole {
            continue;
        }

        // [sectors_read, sectors_written, io_time_ms]
        let vals = [
            disk.sectors_read,
            disk.sectors_written,
            disk.time_in_progress,
        ];
        current_map.insert(name.clone(), vals);
    }

    let mutex = PREV.get_or_init(|| Mutex::new(current_map.clone()));
    let mut prev_guard = mutex.lock().unwrap();

    for (device, curr) in &current_map {
        let mut lbs_read = base.clone();
        lbs_read.push(("device".to_string(), device.clone()));
        lbs_read.push(("direction".to_string(), "read".to_string()));

        let mut lbs_write = base.clone();
        lbs_write.push(("device".to_string(), device.clone()));
        lbs_write.push(("direction".to_string(), "write".to_string()));

        let mut lbs_iotime = base.clone();
        lbs_iotime.push(("device".to_string(), device.clone()));

        if let Some(prev) = prev_guard.get(device) {
            // sector = 512 bytes
            let read_bytes = (curr[0].saturating_sub(prev[0])) as f64 * 512.0;
            let write_bytes = (curr[1].saturating_sub(prev[1])) as f64 * 512.0;
            let io_time_ms = curr[2].saturating_sub(prev[2]) as f64;

            samples.push(MetricSample::new("disk_bytes_total", lbs_read, read_bytes));
            samples.push(MetricSample::new("disk_bytes_total", lbs_write, write_bytes));
            samples.push(MetricSample::new("disk_io_time_ms", lbs_iotime, io_time_ms));
        } else {
            // First collection — emit zeros
            samples.push(MetricSample::new("disk_bytes_total", lbs_read, 0.0));
            samples.push(MetricSample::new("disk_bytes_total", lbs_write, 0.0));
            samples.push(MetricSample::new("disk_io_time_ms", lbs_iotime, 0.0));
        }
    }

    *prev_guard = current_map;
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
    lbs.push(("device".to_string(), "sda".to_string()));
    lbs.push(("direction".to_string(), "read".to_string()));
    vec![MetricSample::new("disk_bytes_total", lbs, 0.0)]
}
