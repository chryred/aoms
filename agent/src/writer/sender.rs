use crate::config::RemoteWriteConfig;
use std::time::Duration;
use tracing::{debug, warn};

/// Remote Write 전송 실패. `retryable=false`면 재시도/버퍼링해도 영영 실패(예: HTTP 400
/// out-of-order) → 호출부가 폐기해야 한다.
#[derive(Debug, Clone)]
pub struct SendError {
    pub retryable: bool,
    pub detail: String,
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.detail)
    }
}

/// 재시도 가치가 있는 HTTP 상태인지. 5xx(서버 일시 오류)와 429(rate limit)만 재시도.
/// 그 외 4xx(400 out-of-order/bad request 등)는 재시도해도 성공하지 않으므로 폐기 대상.
pub fn is_retryable_status(status: u16) -> bool {
    status >= 500 || status == 429
}

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
    /// 5xx/429는 최대 3회 지수 백오프 재시도. 그 외 4xx(400 out-of-order 등)는 재시도 없이
    /// 즉시 non-retryable 에러 반환(호출부가 폐기). 실패 시 응답 본문을 로그에 남긴다.
    pub async fn send(&self, compressed: Vec<u8>) -> Result<(), SendError> {
        let mut last = SendError { retryable: true, detail: "no attempt".into() };

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
                    let status = resp.status().as_u16();
                    let retryable = is_retryable_status(status);
                    // 응답 본문(거부 사유: out of order / out of bounds 등)을 진단용으로 로깅
                    let body = resp.text().await.unwrap_or_default();
                    let snippet: String = body.trim().chars().take(300).collect();
                    let detail = if snippet.is_empty() {
                        format!("HTTP {}", status)
                    } else {
                        format!("HTTP {} — {}", status, snippet)
                    };
                    warn!("Remote write attempt {} failed: {}", attempt + 1, detail);
                    last = SendError { retryable, detail };
                    if !retryable {
                        return Err(last); // 400 등 — 재시도 무의미, 즉시 폐기
                    }
                }
                Err(e) => {
                    let detail = e.to_string();
                    warn!("Remote write attempt {} error: {}", attempt + 1, detail);
                    last = SendError { retryable: true, detail };
                }
            }
        }

        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::is_retryable_status;

    #[test]
    fn test_400_out_of_order_not_retryable() {
        // Prometheus out-of-order/bad-request → 재시도해도 영영 실패, 폐기 대상
        assert!(!is_retryable_status(400));
    }

    #[test]
    fn test_other_4xx_not_retryable() {
        assert!(!is_retryable_status(404));
        assert!(!is_retryable_status(413));
    }

    #[test]
    fn test_429_rate_limit_retryable() {
        assert!(is_retryable_status(429));
    }

    #[test]
    fn test_5xx_server_error_retryable() {
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(503));
    }
}
