use super::{base_labels, MetricSample};
use crate::config::AgentConfig;

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig) -> Vec<MetricSample> {
    use std::collections::HashMap;
    use std::sync::Mutex;

    static PREV: std::sync::OnceLock<Mutex<HashMap<String, [u64; 4]>>> =
        std::sync::OnceLock::new();

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    let mut current_map: HashMap<String, [u64; 4]> = HashMap::new();
    let mut samples = Vec::new();

    // Parse /proc/net/dev
    let Ok(content) = std::fs::read_to_string("/proc/net/dev") else {
        return vec![];
    };

    for line in content.lines().skip(2) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 17 {
            continue;
        }
        let iface = parts[0].trim_end_matches(':');
        if iface == "lo" {
            continue;
        }
        let rx_bytes: u64 = parts[1].parse().unwrap_or(0);
        let rx_errors: u64 = parts[3].parse().unwrap_or(0);
        let tx_bytes: u64 = parts[9].parse().unwrap_or(0);
        let tx_errors: u64 = parts[11].parse().unwrap_or(0);

        current_map.insert(iface.to_string(), [rx_bytes, rx_errors, tx_bytes, tx_errors]);
    }

    let mutex = PREV.get_or_init(|| Mutex::new(current_map.clone()));
    let mut prev_guard = mutex.lock().unwrap();

    for (iface, curr) in &current_map {
        let prev = prev_guard.get(iface).copied().unwrap_or([0; 4]);

        let deltas = [
            ("rx".to_string(), "bytes".to_string(), curr[0].saturating_sub(prev[0]) as f64),
            ("rx".to_string(), "errors".to_string(), curr[1].saturating_sub(prev[1]) as f64),
            ("tx".to_string(), "bytes".to_string(), curr[2].saturating_sub(prev[2]) as f64),
            ("tx".to_string(), "errors".to_string(), curr[3].saturating_sub(prev[3]) as f64),
        ];

        for (direction, metric_type, val) in deltas {
            let mut lbs = base.clone();
            lbs.push(("interface".to_string(), iface.clone()));
            lbs.push(("direction".to_string(), direction));
            let name = if metric_type == "bytes" {
                "network_bytes_total"
            } else {
                "network_errors_total"
            };
            samples.push(MetricSample::new(name, lbs, val));
        }
    }

    *prev_guard = current_map;
    samples
}

/// TCP 연결 상태 수집 (/proc/net/tcp)
#[cfg(target_os = "linux")]
pub fn collect_tcp(cfg: &AgentConfig) -> Vec<MetricSample> {
    use std::collections::HashMap;

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    // TCP state codes
    let state_names = [
        (1u8, "ESTABLISHED"),
        (2, "SYN_SENT"),
        (3, "SYN_RECV"),
        (4, "FIN_WAIT1"),
        (5, "FIN_WAIT2"),
        (6, "TIME_WAIT"),
        (7, "CLOSE"),
        (8, "CLOSE_WAIT"),
        (9, "LAST_ACK"),
        (10, "LISTEN"),
        (11, "CLOSING"),
    ];

    let mut port_state_counts: HashMap<(u16, &str), u64> = HashMap::new();

    for path in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            // local address: hex ip:port
            let local = parts[1];
            let state_hex = parts[3];
            let port = u16::from_str_radix(local.split(':').last().unwrap_or("0"), 16).unwrap_or(0);
            let state_code = u8::from_str_radix(state_hex, 16).unwrap_or(0);
            if let Some((_, state_name)) = state_names.iter().find(|(c, _)| *c == state_code) {
                *port_state_counts.entry((port, state_name)).or_insert(0) += 1;
            }
        }
    }

    let mut samples = Vec::new();
    for ((port, state), count) in port_state_counts {
        let mut lbs = base.clone();
        lbs.push(("port".to_string(), port.to_string()));
        lbs.push(("state".to_string(), state.to_string()));
        samples.push(MetricSample::new("tcp_connections", lbs, count as f64));
    }
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
    lbs.push(("interface".to_string(), "eth0".to_string()));
    lbs.push(("direction".to_string(), "rx".to_string()));
    vec![MetricSample::new("network_bytes_total", lbs, 0.0)]
}

#[cfg(not(target_os = "linux"))]
pub fn collect_tcp(_cfg: &AgentConfig) -> Vec<MetricSample> {
    vec![]
}
