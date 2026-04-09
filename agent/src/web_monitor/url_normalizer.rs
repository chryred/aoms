use regex::Regex;
use std::sync::OnceLock;

static NUM_ONLY: OnceLock<Regex> = OnceLock::new();
static UUID_ONLY: OnceLock<Regex> = OnceLock::new();

fn num_re() -> &'static Regex {
    NUM_ONLY.get_or_init(|| Regex::new(r"^\d+$").unwrap())
}

fn uuid_re() -> &'static Regex {
    UUID_ONLY.get_or_init(|| {
        Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").unwrap()
    })
}

/// Normalize a URI path: replace numeric/UUID segments with {id}.
/// Strip query string. Limit to 5 path segments.
pub fn normalize(uri: &str) -> String {
    let path = uri.split('?').next().unwrap_or(uri);

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    let normalized: Vec<&str> = segments
        .iter()
        .take(5)
        .map(|seg| {
            if num_re().is_match(seg) || uuid_re().is_match(seg) {
                "{id}"
            } else {
                seg
            }
        })
        .collect();

    if normalized.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", normalized.join("/"))
    }
}

/// Match a normalized URI against configured patterns, return (pattern, display).
pub fn match_pattern<'a>(
    normalized: &str,
    patterns: &'a [(String, String)],
) -> (&'a str, &'a str) {
    for (pattern, display) in patterns {
        if normalized.starts_with(pattern.as_str()) {
            return (pattern.as_str(), display.as_str());
        }
    }
    ("other", "기타")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_numeric_id() {
        assert_eq!(normalize("/api/users/12345"), "/api/users/{id}");
    }

    #[test]
    fn test_uuid() {
        assert_eq!(
            normalize("/api/orders/550e8400-e29b-41d4-a716-446655440000"),
            "/api/orders/{id}"
        );
    }

    #[test]
    fn test_query_strip() {
        assert_eq!(normalize("/api/search?q=hello&page=1"), "/api/search");
    }

    #[test]
    fn test_no_id() {
        assert_eq!(normalize("/api/health"), "/api/health");
    }

    #[test]
    fn test_depth_limit() {
        assert_eq!(normalize("/a/b/c/d/e/f/g"), "/a/b/c/d/e");
    }

    #[test]
    fn test_root() {
        assert_eq!(normalize("/"), "/");
    }

    #[test]
    fn test_match_pattern() {
        let patterns = vec![
            ("/api/customers".to_string(), "고객조회".to_string()),
            ("/api/orders".to_string(), "주문처리".to_string()),
        ];
        assert_eq!(
            match_pattern("/api/customers/{id}", &patterns),
            ("/api/customers", "고객조회")
        );
        assert_eq!(match_pattern("/api/other", &patterns), ("other", "기타"));
    }

    // U-N-03: 혼합 경로 — 숫자 세그먼트 여러 개
    #[test]
    fn test_mixed_path() {
        assert_eq!(
            normalize("/api/users/123/orders/456"),
            "/api/users/{id}/orders/{id}"
        );
    }

    // U-N-05: 쿼리스트링 제거 (이미 test_query_strip에 있지만 확인)
    #[test]
    fn test_query_removed() {
        assert_eq!(normalize("/api/users?page=1&size=10"), "/api/users");
    }

    // U-E-01: 5세그먼트 초과 자르기
    #[test]
    fn test_more_than_5_segments() {
        assert_eq!(normalize("/a/b/c/d/e/f/g"), "/a/b/c/d/e");
    }

    // U-E-02: 정확히 5세그먼트
    #[test]
    fn test_exactly_5_segments() {
        assert_eq!(normalize("/a/b/c/d/e"), "/a/b/c/d/e");
    }

    // U-E-05: 문자열 세그먼트 유지 (숫자 아님)
    #[test]
    fn test_string_segment_preserved() {
        assert_eq!(normalize("/api/users/profile"), "/api/users/profile");
    }

    // U-E-07: 숫자로 시작하지만 순수 숫자 아님 — 유지
    #[test]
    fn test_alphanumeric_not_replaced() {
        assert_eq!(normalize("/api/123abc"), "/api/123abc");
    }

    // U-F-01: 빈 문자열
    #[test]
    fn test_empty_string() {
        let result = normalize("");
        // 빈 문자열은 "/" 또는 빈 결과, 크래시 없음
        assert!(result == "/" || result.is_empty());
    }

    // U-F-02: 패턴 미매칭 → "other"
    #[test]
    fn test_no_matching_pattern() {
        let patterns = vec![("/api/customers".to_string(), "고객조회".to_string())];
        let (pattern, display) = match_pattern("/api/unknown/path", &patterns);
        assert_eq!(pattern, "other");
        assert_eq!(display, "기타");
    }

    // U-F-03: url_patterns = [] → 모든 URL → "other"
    #[test]
    fn test_empty_patterns_all_other() {
        let patterns: Vec<(String, String)> = vec![];
        let (pattern, display) = match_pattern("/api/anything", &patterns);
        assert_eq!(pattern, "other");
        assert_eq!(display, "기타");
    }

    // U-N-06: 정규화 후 패턴 매칭
    #[test]
    fn test_normalize_then_match() {
        let patterns = vec![("/api/customers".to_string(), "고객조회".to_string())];
        let normalized = normalize("/api/customers/123");
        assert_eq!(normalized, "/api/customers/{id}");
        let (pattern, display) = match_pattern(&normalized, &patterns);
        assert_eq!(pattern, "/api/customers");
        assert_eq!(display, "고객조회");
    }
}
