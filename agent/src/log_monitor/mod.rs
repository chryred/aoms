pub mod matcher;
pub mod tailer;
pub mod template;

use crate::config::AgentConfig;
use crate::metrics::{base_labels, MetricSample};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Thread-safe log error counter
#[derive(Clone)]
pub struct LogCounter {
    /// key: (log_type, level, template, service_name) → count
    counts: Arc<Mutex<HashMap<(String, String, String, String), u64>>>,
}

impl LogCounter {
    pub fn new() -> Self {
        Self {
            counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn increment(&self, log_type: &str, level: &str, template: &str, service_name: &str) {
        let mut m = self.counts.lock().unwrap();
        *m.entry((
            log_type.to_string(),
            level.to_string(),
            template.to_string(),
            service_name.to_string(),
        ))
        .or_insert(0) += 1;
    }

    /// Drain current counts and return as MetricSamples
    pub fn drain_as_samples(&self, cfg: &AgentConfig) -> Vec<MetricSample> {
        let mut m = self.counts.lock().unwrap();
        let base = base_labels(
            &cfg.system_name,
            &cfg.display_name,
            &cfg.instance_role,
            &cfg.host,
        );

        let mut samples = Vec::new();
        for ((log_type, level, tmpl, svc_name), count) in m.drain() {
            let mut lbs = base.clone();
            lbs.push(("log_type".to_string(), log_type));
            lbs.push(("level".to_string(), level));
            lbs.push(("service_name".to_string(), svc_name));
            lbs.push(("template".to_string(), tmpl));
            samples.push(MetricSample {
                name: "log_error_total".to_string(),
                labels: lbs,
                value: count as f64,
                timestamp_ms: Utc::now().timestamp_millis(),
            });
        }
        samples
    }
}

impl Default for LogCounter {
    fn default() -> Self {
        Self::new()
    }
}
