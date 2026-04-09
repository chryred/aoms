pub mod clf;
pub mod combined;
pub mod nginx_json;

use super::HttpEntry;

pub trait LogParser: Send + Sync {
    fn parse_line(&self, line: &str) -> Option<HttpEntry>;
}

/// Create a parser based on log_format string
pub fn create_parser(format: &str) -> Box<dyn LogParser> {
    match format {
        "nginx_json" => Box::new(nginx_json::NginxJsonParser),
        "combined" | "apache" | "webtob" => Box::new(combined::CombinedParser),
        "clf" => Box::new(clf::ClfParser),
        _ => {
            tracing::warn!("Unknown log format '{}', defaulting to combined", format);
            Box::new(combined::CombinedParser)
        }
    }
}
