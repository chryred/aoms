pub mod access_log;
pub mod parser;
pub mod url_normalizer;

use crate::config::{AgentConfig, WebServerConfig};
use crate::metrics::{base_labels, MetricSample};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Parsed HTTP request entry from access log
#[derive(Debug, Clone)]
pub struct HttpEntry {
    pub method: String,
    pub uri: String,
    pub status_code: u16,
    pub duration_ms: Option<f64>,
}

/// Thread-safe HTTP request counter
#[derive(Clone)]
pub struct HttpCounter {
    /// key: (url_pattern, url_pattern_display, method, status_code, was_service) → (count, slow_count, total_duration_ms)
    counts: Arc<Mutex<HashMap<(String, String, String, String, String), (u64, u64, f64)>>>,
}

impl HttpCounter {
    pub fn new() -> Self {
        Self {
            counts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn record(
        &self,
        url_pattern: &str,
        url_pattern_display: &str,
        method: &str,
        status_code: u16,
        was_service: &str,
        duration_ms: Option<f64>,
        slow_threshold_ms: u64,
    ) {
        let mut m = self.counts.lock().unwrap();
        let key = (
            url_pattern.to_string(),
            url_pattern_display.to_string(),
            method.to_string(),
            status_code.to_string(),
            was_service.to_string(),
        );
        let entry = m.entry(key).or_insert((0, 0, 0.0));
        entry.0 += 1;
        if let Some(d) = duration_ms {
            entry.2 += d;
            if d > slow_threshold_ms as f64 {
                entry.1 += 1;
            }
        }
    }

    pub fn drain_as_samples(
        &self,
        cfg: &AgentConfig,
        ws_cfg: &WebServerConfig,
    ) -> Vec<MetricSample> {
        let mut m = self.counts.lock().unwrap();
        let base = base_labels(
            &cfg.system_name,
            &cfg.display_name,
            &cfg.instance_role,
            &cfg.host,
        );

        let mut samples = Vec::new();
        let now = Utc::now().timestamp_millis();

        for ((url_pattern, url_pattern_display, method, status_code, was_service), (count, slow_count, total_dur)) in m.drain() {
            let mut lbs_total = base.clone();
            lbs_total.push(("web_server".to_string(), ws_cfg.name.clone()));
            lbs_total.push(("web_server_display".to_string(), ws_cfg.display_name.clone()));
            lbs_total.push(("url_pattern".to_string(), url_pattern.clone()));
            lbs_total.push(("url_pattern_display".to_string(), url_pattern_display.clone()));
            lbs_total.push(("was_service".to_string(), was_service.clone()));
            lbs_total.push(("method".to_string(), method.clone()));
            lbs_total.push(("status_code".to_string(), status_code.clone()));

            // request total count
            let mut s = MetricSample::new("http_request_total", lbs_total.clone(), count as f64);
            s.timestamp_ms = now;
            samples.push(s);

            // avg duration
            if count > 0 && total_dur > 0.0 {
                let avg = total_dur / count as f64;
                let mut s = MetricSample::new("http_request_duration_ms", lbs_total.clone(), avg);
                s.timestamp_ms = now;
                samples.push(s);
            }

            // slow count
            if slow_count > 0 {
                let mut lbs_slow = base.clone();
                lbs_slow.push(("web_server".to_string(), ws_cfg.name.clone()));
                lbs_slow.push(("web_server_display".to_string(), ws_cfg.display_name.clone()));
                lbs_slow.push(("url_pattern".to_string(), url_pattern.clone()));
                lbs_slow.push(("url_pattern_display".to_string(), url_pattern_display.clone()));
                let mut s = MetricSample::new("http_request_slow_total", lbs_slow, slow_count as f64);
                s.timestamp_ms = now;
                samples.push(s);
            }
        }
        samples
    }
}

impl Default for HttpCounter {
    fn default() -> Self {
        Self::new()
    }
}
