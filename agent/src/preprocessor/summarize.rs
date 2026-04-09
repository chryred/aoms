use crate::metrics::MetricSample;
use std::collections::HashMap;
use chrono::Utc;

/// Ring-buffer based time-series summarizer.
/// Accumulates samples per metric name+labels and produces avg/p95 over windows.
pub struct Summarizer {
    /// metric_key → Vec<(timestamp_ms, value)>
    buffers: HashMap<String, Vec<(i64, f64)>>,
    window_secs: Vec<u64>,
}

impl Summarizer {
    pub fn new(window_secs: Vec<u64>) -> Self {
        Self {
            buffers: HashMap::new(),
            window_secs,
        }
    }

    /// Feed raw samples into the summarizer
    pub fn feed(&mut self, samples: &[MetricSample]) {
        let now = Utc::now().timestamp_millis();
        // Keep max 1 hour of data
        let cutoff = now - 3_600_000;

        for s in samples {
            let key = format!(
                "{}|{}",
                s.name,
                s.labels
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect::<Vec<_>>()
                    .join(",")
            );
            let buf = self.buffers.entry(key).or_default();
            buf.retain(|(ts, _)| *ts > cutoff);
            buf.push((s.timestamp_ms, s.value));
        }
    }

    /// Produce summary metrics for each window
    pub fn summarize(&self) -> Vec<MetricSample> {
        let now = Utc::now().timestamp_millis();
        let mut result = Vec::new();

        for (key, buf) in &self.buffers {
            let parts: Vec<&str> = key.splitn(2, '|').collect();
            if parts.len() < 2 {
                continue;
            }
            let metric_name = parts[0];
            let labels: Vec<(String, String)> = parts[1]
                .split(',')
                .filter_map(|kv| {
                    let mut it = kv.splitn(2, '=');
                    Some((it.next()?.to_string(), it.next()?.to_string()))
                })
                .collect();

            for &window_secs in &self.window_secs {
                let cutoff = now - (window_secs as i64 * 1000);
                let window_vals: Vec<f64> = buf
                    .iter()
                    .filter(|(ts, _)| *ts >= cutoff)
                    .map(|(_, v)| *v)
                    .collect();

                if window_vals.is_empty() {
                    continue;
                }

                let avg = window_vals.iter().sum::<f64>() / window_vals.len() as f64;
                let p95 = percentile(&window_vals, 95.0);

                let window_label = format!("{}s", window_secs);

                let mut lbs_avg = labels.clone();
                lbs_avg.push(("window".to_string(), window_label.clone()));
                result.push(MetricSample {
                    name: format!("{}_avg", metric_name),
                    labels: lbs_avg,
                    value: avg,
                    timestamp_ms: now,
                });

                let mut lbs_p95 = labels.clone();
                lbs_p95.push(("window".to_string(), window_label));
                result.push(MetricSample {
                    name: format!("{}_p95", metric_name),
                    labels: lbs_p95,
                    value: p95,
                    timestamp_ms: now,
                });
            }
        }

        result
    }
}

fn percentile(vals: &[f64], p: f64) -> f64 {
    if vals.is_empty() {
        return 0.0;
    }
    let mut sorted = vals.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let idx = ((p / 100.0) * (sorted.len() - 1) as f64) as usize;
    sorted[idx.min(sorted.len() - 1)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percentile() {
        let vals = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        assert!((percentile(&vals, 50.0) - 5.0).abs() < 1.0);
        assert!((percentile(&vals, 95.0) - 9.0).abs() < 1.0);
    }

    #[test]
    fn test_feed_and_summarize() {
        let mut s = Summarizer::new(vec![60, 300]);
        let samples = vec![MetricSample::new(
            "cpu_usage_percent",
            vec![("system_name".to_string(), "test".to_string())],
            50.0,
        )];
        s.feed(&samples);
        let result = s.summarize();
        assert!(!result.is_empty());
        assert!(result.iter().any(|m| m.name.contains("avg")));
    }
}
