pub mod cpu;
pub mod disk;
pub mod memory;
pub mod network;
pub mod process;

use chrono::Utc;

/// 단일 메트릭 샘플 (name + labels + value + timestamp)
#[derive(Debug, Clone)]
pub struct MetricSample {
    pub name: String,
    pub labels: Vec<(String, String)>,
    pub value: f64,
    pub timestamp_ms: i64,
}

impl MetricSample {
    pub fn new(name: &str, labels: Vec<(String, String)>, value: f64) -> Self {
        Self {
            name: name.to_string(),
            labels,
            value,
            timestamp_ms: Utc::now().timestamp_millis(),
        }
    }
}

/// 공통 base labels 생성 헬퍼
pub fn base_labels(
    system_name: &str,
    display_name: &str,
    instance_role: &str,
    host: &str,
) -> Vec<(String, String)> {
    vec![
        ("system_name".to_string(), system_name.to_string()),
        ("display_name".to_string(), display_name.to_string()),
        ("instance_role".to_string(), instance_role.to_string()),
        ("host".to_string(), host.to_string()),
    ]
}
