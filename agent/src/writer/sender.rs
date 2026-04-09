use crate::config::RemoteWriteConfig;
use std::time::Duration;
use tracing::{debug, warn};

pub struct RemoteWriteSender {
    client: reqwest::Client,
    endpoint: String,
}

impl RemoteWriteSender {
    pub fn new(cfg: &RemoteWriteConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(cfg.timeout_secs))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            client,
            endpoint: cfg.endpoint.clone(),
        }
    }

    /// Send snappy-compressed protobuf payload to Prometheus Remote Write endpoint.
    /// Retries up to 3 times with exponential backoff on failure.
    pub async fn send(&self, compressed: Vec<u8>) -> Result<(), String> {
        let mut last_err = String::new();

        for attempt in 0..3u32 {
            if attempt > 0 {
                let wait = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                tokio::time::sleep(wait).await;
            }

            match self
                .client
                .post(&self.endpoint)
                .header("Content-Type", "application/x-protobuf")
                .header("Content-Encoding", "snappy")
                .header("X-Prometheus-Remote-Write-Version", "0.1.0")
                .body(compressed.clone())
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    debug!("Remote write OK ({} bytes)", compressed.len());
                    return Ok(());
                }
                Ok(resp) => {
                    last_err = format!("HTTP {}", resp.status());
                    warn!("Remote write attempt {} failed: {}", attempt + 1, last_err);
                }
                Err(e) => {
                    last_err = e.to_string();
                    warn!("Remote write attempt {} error: {}", attempt + 1, last_err);
                }
            }
        }

        Err(last_err)
    }
}
