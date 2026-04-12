use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub agent: AgentConfig,
    pub remote_write: RemoteWriteConfig,
    #[serde(default)]
    pub collectors: CollectorsConfig,
    #[serde(default)]
    pub log_monitor: Vec<LogMonitorConfig>,
    #[serde(default)]
    pub services: Vec<ServiceConfig>,
    #[serde(default)]
    pub web_servers: Vec<WebServerConfig>,
    #[serde(default)]
    pub preprocessor: PreprocessorConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AgentConfig {
    pub system_name: String,
    pub display_name: String,
    #[serde(default = "default_instance_role")]
    pub instance_role: String,
    pub host: String,
    #[serde(default = "default_collect_interval")]
    pub collect_interval_secs: u64,
    #[serde(default = "default_top_process_count")]
    pub top_process_count: usize,
    #[serde(default = "default_log_dir")]
    pub log_dir: String,
    #[serde(default = "default_log_retention_days")]
    pub log_retention_days: u64,
}

fn default_instance_role() -> String {
    "default".to_string()
}
fn default_collect_interval() -> u64 {
    15
}
fn default_top_process_count() -> usize {
    20
}
fn default_log_dir() -> String {
    "./logs".to_string()
}
fn default_log_retention_days() -> u64 {
    7
}

#[derive(Debug, Deserialize, Clone)]
pub struct RemoteWriteConfig {
    pub endpoint: String,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_wal_dir")]
    pub wal_dir: String,
    #[serde(default = "default_wal_retention")]
    pub wal_retention_hours: u64,
}

fn default_batch_size() -> usize {
    500
}
fn default_timeout() -> u64 {
    10
}
fn default_wal_dir() -> String {
    "/var/lib/aoms-agent/wal".to_string()
}
fn default_wal_retention() -> u64 {
    2
}

#[derive(Debug, Deserialize, Clone)]
pub struct CollectorsConfig {
    #[serde(default = "default_true")]
    pub cpu: bool,
    #[serde(default = "default_true")]
    pub memory: bool,
    #[serde(default = "default_true")]
    pub disk: bool,
    #[serde(default = "default_true")]
    pub network: bool,
    #[serde(default = "default_true")]
    pub process: bool,
    #[serde(default = "default_true")]
    pub tcp_connections: bool,
    #[serde(default = "default_true")]
    pub log_monitor: bool,
    #[serde(default = "default_true")]
    pub web_servers: bool,
    #[serde(default = "default_false")]
    pub preprocessor: bool,
    #[serde(default = "default_true")]
    pub heartbeat: bool,
}

impl Default for CollectorsConfig {
    fn default() -> Self {
        Self {
            cpu: true,
            memory: true,
            disk: true,
            network: true,
            process: true,
            tcp_connections: true,
            log_monitor: true,
            web_servers: true,
            preprocessor: false,
            heartbeat: true,
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

#[derive(Debug, Deserialize, Clone)]
pub struct LogMonitorConfig {
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default = "default_keywords")]
    pub keywords: Vec<String>,
    #[serde(default = "default_log_type")]
    pub log_type: String,
}

fn default_keywords() -> Vec<String> {
    vec![
        "ERROR".to_string(),
        "CRITICAL".to_string(),
        "PANIC".to_string(),
        "Fatal".to_string(),
        "Exception".to_string(),
    ]
}
fn default_log_type() -> String {
    "app".to_string()
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServiceConfig {
    pub name: String,
    pub display_name: String,
    pub process_match: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct WebServerConfig {
    pub name: String,
    pub display_name: String,
    #[serde(rename = "type")]
    pub server_type: String,
    pub log_path: String,
    pub log_format: String,
    #[serde(default)]
    pub was_services: Vec<String>,
    #[serde(default = "default_slow_threshold")]
    pub slow_threshold_ms: u64,
    #[serde(default)]
    pub url_patterns: Vec<UrlPattern>,
}

fn default_slow_threshold() -> u64 {
    2000
}

#[derive(Debug, Deserialize, Clone)]
pub struct UrlPattern {
    pub pattern: String,
    pub display: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PreprocessorConfig {
    #[serde(default = "default_summary_intervals")]
    pub summary_intervals_secs: Vec<u64>,
    /// Correlation window: how far back to look for paired metric+log events (seconds)
    #[serde(default = "default_corr_window")]
    pub corr_window_secs: u64,
    /// CPU usage percent threshold to count as an anomaly (0–100)
    #[serde(default = "default_cpu_threshold")]
    pub cpu_threshold: f64,
    /// Memory usage percent threshold to count as an anomaly (0–100)
    #[serde(default = "default_memory_threshold")]
    pub memory_threshold: f64,
    /// Minimum log errors per cycle to count as a spike
    #[serde(default = "default_log_error_min")]
    pub log_error_min: f64,
}

impl Default for PreprocessorConfig {
    fn default() -> Self {
        Self {
            summary_intervals_secs: default_summary_intervals(),
            corr_window_secs: default_corr_window(),
            cpu_threshold: default_cpu_threshold(),
            memory_threshold: default_memory_threshold(),
            log_error_min: default_log_error_min(),
        }
    }
}

fn default_summary_intervals() -> Vec<u64> {
    vec![60, 300]
}
fn default_corr_window() -> u64 {
    300
}
fn default_cpu_threshold() -> f64 {
    80.0
}
fn default_memory_threshold() -> f64 {
    85.0
}
fn default_log_error_min() -> f64 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_toml(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "{}", content).unwrap();
        f
    }

    const MINIMAL_TOML: &str = r#"
[agent]
system_name = "test"
display_name = "테스트"
host = "127.0.0.1"

[remote_write]
endpoint = "http://localhost:9090/api/v1/write"
"#;

    // C-N-01: 전체 필드 정상 로드
    #[test]
    fn test_load_example_toml() {
        let cfg = Config::load("config.example.toml").unwrap();
        assert_eq!(cfg.agent.system_name, "crm");
        assert_eq!(cfg.agent.collect_interval_secs, 15);
    }

    // C-N-02: 다중 services 로드
    #[test]
    fn test_multiple_services() {
        let cfg = Config::load("config.example.toml").unwrap();
        assert!(cfg.services.len() >= 2);
    }

    // C-N-07: 다중 [[log_monitor]] 로드
    #[test]
    fn test_multiple_log_monitors() {
        let cfg = Config::load("config.example.toml").unwrap();
        assert!(cfg.log_monitor.len() >= 2, "config.example.toml should have at least 2 [[log_monitor]] sections");
        // 각 log_type이 다름
        let types: Vec<&str> = cfg.log_monitor.iter().map(|lm| lm.log_type.as_str()).collect();
        assert!(types.contains(&"jeus"), "expected log_type 'jeus'");
        assert!(types.contains(&"app"), "expected log_type 'app'");
    }

    // C-N-08: [[log_monitor]] 빈 배열 (MINIMAL_TOML)
    #[test]
    fn test_empty_log_monitors() {
        let f = write_toml(MINIMAL_TOML);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert!(cfg.log_monitor.is_empty());
    }

    // C-N-03: 다중 web_servers 로드
    #[test]
    fn test_multiple_web_servers() {
        let cfg = Config::load("config.example.toml").unwrap();
        assert_eq!(cfg.web_servers.len(), 2);
    }

    // C-N-04: collect_interval_secs 기본값
    #[test]
    fn test_collect_interval_default() {
        let f = write_toml(MINIMAL_TOML);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert_eq!(cfg.agent.collect_interval_secs, 15);
    }

    // C-N-05: 모든 collectors 활성화
    #[test]
    fn test_all_collectors_enabled() {
        let cfg = Config::load("config.example.toml").unwrap();
        assert!(cfg.collectors.cpu);
        assert!(cfg.collectors.memory);
        assert!(cfg.collectors.disk);
        assert!(cfg.collectors.network);
        assert!(cfg.collectors.process);
        assert!(cfg.collectors.log_monitor);
        assert!(cfg.collectors.web_servers);
        assert!(cfg.collectors.heartbeat);
    }

    // C-N-06: preprocessor = false 기본값
    #[test]
    fn test_preprocessor_default_false() {
        let f = write_toml(MINIMAL_TOML);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert!(!cfg.collectors.preprocessor);
    }

    // C-E-01: services 빈 배열
    #[test]
    fn test_empty_services() {
        let f = write_toml(MINIMAL_TOML);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert!(cfg.services.is_empty());
    }

    // C-E-02: web_servers 빈 배열
    #[test]
    fn test_empty_web_servers() {
        let f = write_toml(MINIMAL_TOML);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert!(cfg.web_servers.is_empty());
    }

    // C-E-03: collect_interval_secs = 1 최소값
    #[test]
    fn test_collect_interval_minimum() {
        let toml = format!("{}\ncollect_interval_secs = 1", &MINIMAL_TOML[..MINIMAL_TOML.find("[remote_write]").unwrap()]);
        let full = format!("[agent]\nsystem_name=\"t\"\ndisplay_name=\"t\"\nhost=\"127.0.0.1\"\ncollect_interval_secs=1\n\n[remote_write]\nendpoint=\"http://localhost:9090/api/v1/write\"\n");
        let f = write_toml(&full);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert_eq!(cfg.agent.collect_interval_secs, 1);
    }

    // C-E-05: wal_retention_hours = 0
    #[test]
    fn test_wal_retention_zero() {
        let toml = "[agent]\nsystem_name=\"t\"\ndisplay_name=\"t\"\nhost=\"127.0.0.1\"\n\n[remote_write]\nendpoint=\"http://localhost:9090/api/v1/write\"\nwal_retention_hours=0\n";
        let f = write_toml(toml);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert_eq!(cfg.remote_write.wal_retention_hours, 0);
    }

    // C-E-07: display_name 선택 필드 누락 → 기본값 빈 문자열 or 오류
    // display_name은 필수 필드이므로 누락 시 오류
    #[test]
    fn test_display_name_required() {
        let toml = "[agent]\nsystem_name=\"t\"\nhost=\"127.0.0.1\"\n\n[remote_write]\nendpoint=\"http://localhost:9090/api/v1/write\"\n";
        let f = write_toml(toml);
        // display_name이 없으면 파싱 실패
        let result = Config::load(f.path().to_str().unwrap());
        assert!(result.is_err(), "display_name 누락 시 파싱 오류 예상");
    }

    // C-E-08: url_patterns = [] 빈 배열
    #[test]
    fn test_empty_url_patterns() {
        let toml = r#"
[agent]
system_name = "t"
display_name = "t"
host = "127.0.0.1"

[remote_write]
endpoint = "http://localhost:9090/api/v1/write"

[[web_servers]]
name = "nginx"
display_name = "nginx"
type = "nginx"
log_path = "/var/log/nginx/access.log"
log_format = "nginx_json"
url_patterns = []
"#;
        let f = write_toml(toml);
        let cfg = Config::load(f.path().to_str().unwrap()).unwrap();
        assert!(cfg.web_servers[0].url_patterns.is_empty());
    }

    // C-F-01: 파일 없음
    #[test]
    fn test_file_not_found() {
        let result = Config::load("/nonexistent/path/config.toml");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Failed to read config file"));
    }

    // C-F-02: 잘못된 TOML 문법
    #[test]
    fn test_invalid_toml_syntax() {
        let f = write_toml("[agent]\nsystem_name = [");
        let result = Config::load(f.path().to_str().unwrap());
        assert!(result.is_err());
    }

    // C-F-03: 타입 불일치
    #[test]
    fn test_type_mismatch() {
        let toml = "[agent]\nsystem_name=\"t\"\ndisplay_name=\"t\"\nhost=\"127.0.0.1\"\ncollect_interval_secs=\"fifteen\"\n\n[remote_write]\nendpoint=\"http://localhost:9090/api/v1/write\"\n";
        let f = write_toml(toml);
        let result = Config::load(f.path().to_str().unwrap());
        assert!(result.is_err());
    }

    // C-F-04: 필수 섹션 누락 ([agent] 없음)
    #[test]
    fn test_missing_agent_section() {
        let toml = "[remote_write]\nendpoint=\"http://localhost:9090/api/v1/write\"\n";
        let f = write_toml(toml);
        let result = Config::load(f.path().to_str().unwrap());
        assert!(result.is_err());
    }
}

impl Config {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("Failed to read config file '{}': {}", path, e))?;
        let config: Config = toml::from_str(&content)
            .map_err(|e| anyhow::anyhow!("Failed to parse config file '{}': {}", path, e))?;
        Ok(config)
    }

    pub fn load_or_default(path: &str) -> anyhow::Result<Self> {
        if Path::new(path).exists() {
            Self::load(path)
        } else {
            Err(anyhow::anyhow!(
                "Config file not found: {}. Create one from config.example.toml",
                path
            ))
        }
    }
}
