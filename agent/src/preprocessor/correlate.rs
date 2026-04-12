use crate::config::AgentConfig;
use crate::metrics::MetricSample;
use chrono::Utc;
use std::collections::VecDeque;

/// A single anomaly event recorded in the sliding window.
#[derive(Debug)]
struct AnomalyEvent {
    timestamp_ms: i64,
    metric_name: String,
    value: f64,
}

/// A single log error spike event.
#[derive(Debug)]
struct LogEvent {
    timestamp_ms: i64,
    /// Total error count observed in this cycle
    count: f64,
}

/// Correlates metric anomalies (CPU/memory spikes) with log error bursts.
///
/// When both a metric anomaly and a log error spike are observed within
/// `corr_window_ms`, an `anomaly_correlation_total` metric is emitted.
/// This gives the LLM analyzer pre-correlated signals without needing
/// full time-series joins on the server side.
pub struct Correlator {
    metric_events: VecDeque<AnomalyEvent>,
    log_events: VecDeque<LogEvent>,
    corr_window_ms: i64,
    cpu_threshold: f64,
    memory_threshold: f64,
    /// Minimum log errors per cycle to count as a spike
    log_error_min: f64,
}

impl Correlator {
    pub fn new(corr_window_secs: u64, cpu_threshold: f64, memory_threshold: f64, log_error_min: f64) -> Self {
        Self {
            metric_events: VecDeque::new(),
            log_events: VecDeque::new(),
            corr_window_ms: corr_window_secs as i64 * 1000,
            cpu_threshold,
            memory_threshold,
            log_error_min,
        }
    }

    /// Feed a batch of raw samples from one collect cycle.
    /// Records anomaly events and log spikes in the sliding window.
    pub fn observe(&mut self, samples: &[MetricSample]) {
        let now = Utc::now().timestamp_millis();
        self.evict(now);

        let mut log_errors_this_cycle: f64 = 0.0;

        for s in samples {
            match s.name.as_str() {
                "cpu_usage_percent" if s.value > self.cpu_threshold => {
                    self.metric_events.push_back(AnomalyEvent {
                        timestamp_ms: now,
                        metric_name: "cpu_usage_percent".to_string(),
                        value: s.value,
                    });
                }
                "memory_used_bytes" => {
                    // Detect memory saturation: memory_used_bytes{type="used"} high relative signal
                    // We check for a sentinel value: if value is tagged with type=used and >threshold,
                    // but since we don't have total here, we look for explicit flag set by collector.
                    // Instead, check for memory_usage_percent if available.
                }
                "memory_usage_percent" if s.value > self.memory_threshold => {
                    self.metric_events.push_back(AnomalyEvent {
                        timestamp_ms: now,
                        metric_name: "memory_usage_percent".to_string(),
                        value: s.value,
                    });
                }
                "log_error_total" => {
                    log_errors_this_cycle += s.value;
                }
                _ => {}
            }
        }

        if log_errors_this_cycle >= self.log_error_min {
            self.log_events.push_back(LogEvent {
                timestamp_ms: now,
                count: log_errors_this_cycle,
            });
        }
    }

    /// Check sliding window for metric anomaly ↔ log spike overlaps.
    /// Returns correlation metrics to be added to the next Remote Write batch.
    pub fn correlate(&self, agent: &AgentConfig) -> Vec<MetricSample> {
        let now = Utc::now().timestamp_millis();
        let cutoff = now - self.corr_window_ms;

        let recent_metrics: Vec<&AnomalyEvent> = self
            .metric_events
            .iter()
            .filter(|e| e.timestamp_ms >= cutoff)
            .collect();

        let recent_logs: Vec<&LogEvent> = self
            .log_events
            .iter()
            .filter(|e| e.timestamp_ms >= cutoff)
            .collect();

        if recent_metrics.is_empty() || recent_logs.is_empty() {
            return vec![];
        }

        // Count total log errors in window for context label
        let total_log_errors: f64 = recent_logs.iter().map(|e| e.count).sum();

        // One correlation metric per distinct anomalous metric name
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut result = Vec::new();

        for event in &recent_metrics {
            if !seen.insert(event.metric_name.clone()) {
                continue;
            }

            let mut labels = crate::metrics::base_labels(
                &agent.system_name,
                &agent.display_name,
                &agent.instance_role,
                &agent.host,
            );
            labels.push(("metric_name".to_string(), event.metric_name.clone()));
            labels.push(("log_errors_in_window".to_string(), format!("{:.0}", total_log_errors)));
            labels.push(("corr_type".to_string(), "metric_log".to_string()));

            result.push(MetricSample::new("anomaly_correlation_total", labels, 1.0));
        }

        result
    }

    /// Remove events older than the correlation window.
    fn evict(&mut self, now: i64) {
        let cutoff = now - self.corr_window_ms;
        while self
            .metric_events
            .front()
            .map(|e| e.timestamp_ms < cutoff)
            .unwrap_or(false)
        {
            self.metric_events.pop_front();
        }
        while self
            .log_events
            .front()
            .map(|e| e.timestamp_ms < cutoff)
            .unwrap_or(false)
        {
            self.log_events.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_agent() -> AgentConfig {
        AgentConfig {
            system_name: "test".to_string(),
            display_name: "테스트".to_string(),
            instance_role: "web".to_string(),
            host: "127.0.0.1".to_string(),
            collect_interval_secs: 15,
            top_process_count: 10,
            log_dir: "./logs".to_string(),
            log_retention_days: 7,
        }
    }

    #[test]
    fn test_no_correlation_without_log_errors() {
        let mut c = Correlator::new(300, 80.0, 85.0, 1.0);
        let samples = vec![MetricSample::new(
            "cpu_usage_percent",
            vec![("system_name".to_string(), "test".to_string())],
            90.0,
        )];
        c.observe(&samples);
        let result = c.correlate(&make_agent());
        assert!(result.is_empty(), "should not correlate without log errors");
    }

    #[test]
    fn test_no_correlation_without_metric_anomaly() {
        let mut c = Correlator::new(300, 80.0, 85.0, 1.0);
        let samples = vec![MetricSample::new(
            "log_error_total",
            vec![("system_name".to_string(), "test".to_string())],
            5.0,
        )];
        c.observe(&samples);
        let result = c.correlate(&make_agent());
        assert!(result.is_empty(), "should not correlate without metric anomaly");
    }

    #[test]
    fn test_correlation_emitted_when_both_present() {
        let mut c = Correlator::new(300, 80.0, 85.0, 1.0);
        let samples = vec![
            MetricSample::new(
                "cpu_usage_percent",
                vec![("system_name".to_string(), "test".to_string())],
                95.0,
            ),
            MetricSample::new(
                "log_error_total",
                vec![("system_name".to_string(), "test".to_string())],
                3.0,
            ),
        ];
        c.observe(&samples);
        let result = c.correlate(&make_agent());
        assert!(!result.is_empty(), "should emit correlation metric");
        assert_eq!(result[0].name, "anomaly_correlation_total");
        assert!(result[0]
            .labels
            .iter()
            .any(|(k, v)| k == "metric_name" && v == "cpu_usage_percent"));
    }

    #[test]
    fn test_cpu_below_threshold_not_correlated() {
        let mut c = Correlator::new(300, 80.0, 85.0, 1.0);
        let samples = vec![
            MetricSample::new(
                "cpu_usage_percent",
                vec![("system_name".to_string(), "test".to_string())],
                50.0, // below 80%
            ),
            MetricSample::new(
                "log_error_total",
                vec![("system_name".to_string(), "test".to_string())],
                10.0,
            ),
        ];
        c.observe(&samples);
        let result = c.correlate(&make_agent());
        assert!(result.is_empty(), "CPU below threshold should not correlate");
    }

    #[test]
    fn test_deduplication_same_metric() {
        let mut c = Correlator::new(300, 80.0, 85.0, 1.0);
        // Two CPU spikes + log errors in same cycle
        let samples = vec![
            MetricSample::new(
                "cpu_usage_percent",
                vec![("core".to_string(), "0".to_string())],
                90.0,
            ),
            MetricSample::new(
                "cpu_usage_percent",
                vec![("core".to_string(), "1".to_string())],
                92.0,
            ),
            MetricSample::new(
                "log_error_total",
                vec![],
                5.0,
            ),
        ];
        c.observe(&samples);
        let result = c.correlate(&make_agent());
        // Should emit only one correlation metric for cpu_usage_percent
        let cpu_corr: Vec<_> = result
            .iter()
            .filter(|m| {
                m.labels
                    .iter()
                    .any(|(k, v)| k == "metric_name" && v == "cpu_usage_percent")
            })
            .collect();
        assert_eq!(cpu_corr.len(), 1);
    }
}
