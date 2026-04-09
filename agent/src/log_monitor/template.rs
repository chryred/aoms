use regex::Regex;
use std::sync::OnceLock;

static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn get_patterns() -> &'static Vec<(Regex, &'static str)> {
    PATTERNS.get_or_init(|| {
        vec![
            // IPv4 주소
            (
                Regex::new(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b").unwrap(),
                "<IP>",
            ),
            // UUID
            (
                Regex::new(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b").unwrap(),
                "<UUID>",
            ),
            // 이메일
            (
                Regex::new(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b").unwrap(),
                "<EMAIL>",
            ),
            // 주민번호 패턴
            (
                Regex::new(r"\b\d{6}-[1-4]\d{6}\b").unwrap(),
                "<JUMINNO>",
            ),
            // 카드번호 (4자리 그룹 3-4개)
            (
                Regex::new(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b").unwrap(),
                "<CARD>",
            ),
            // 전화번호
            (
                Regex::new(r"\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b").unwrap(),
                "<PHONE>",
            ),
            // 숫자 ID / 트랜잭션 번호 (5자리 이상 순수 숫자)
            (
                Regex::new(r"\b\d{5,}\b").unwrap(),
                "<NUM>",
            ),
        ]
    })
}

/// Mask PII from a log line and return a normalized template string.
/// The template is truncated to 200 chars to limit cardinality.
pub fn extract_template(line: &str) -> String {
    let mut result = line.to_string();
    for (re, replacement) in get_patterns() {
        result = re.replace_all(&result, *replacement).to_string();
    }
    // Truncate to avoid high cardinality in Prometheus labels
    if result.chars().count() > 200 {
        result.chars().take(200).collect::<String>() + "…"
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_ip() {
        let t = extract_template("Connection from 192.168.1.100:8080 failed");
        assert!(t.contains("<IP>"));
        assert!(!t.contains("192.168"));
    }

    #[test]
    fn test_mask_email() {
        let t = extract_template("User john@example.com login failed");
        assert!(t.contains("<EMAIL>"));
    }

    #[test]
    fn test_mask_num() {
        let t = extract_template("Transaction ID 1234567890 failed");
        assert!(t.contains("<NUM>"));
    }

    #[test]
    fn test_no_false_positive() {
        // Short words should not be replaced
        let t = extract_template("ERROR: disk full at /var/log");
        assert!(t.contains("disk full"));
    }

    #[test]
    fn test_truncation() {
        let long = "ERROR ".repeat(50);
        let t = extract_template(&long);
        assert!(t.chars().count() <= 201); // 200 + "…"
    }

    // T-N-02: UUID 마스킹
    #[test]
    fn test_mask_uuid() {
        let t = extract_template("id=550e8400-e29b-41d4-a716-446655440000 failed");
        assert!(t.contains("<UUID>"));
        assert!(!t.contains("550e8400"));
    }

    // T-N-04: 주민번호 마스킹
    #[test]
    fn test_mask_jumin() {
        let t = extract_template("주민번호: 900101-1234567");
        assert!(t.contains("<JUMINNO>"), "got: {}", t);
    }

    // T-N-05: 카드번호 마스킹
    #[test]
    fn test_mask_card() {
        let t = extract_template("card: 1234-5678-9012-3456");
        assert!(t.contains("<CARD>"), "got: {}", t);
    }

    // T-N-06: 전화번호 마스킹
    #[test]
    fn test_mask_phone() {
        let t = extract_template("tel: 010-1234-5678");
        assert!(t.contains("<PHONE>"), "got: {}", t);
    }

    // T-N-08: 4자리 이하 숫자 — 변경 없음
    #[test]
    fn test_short_number_preserved() {
        let t = extract_template("retry=1234");
        assert!(t.contains("1234"), "4-digit number should not be masked");
    }

    // T-E-01: 여러 PII 중첩
    #[test]
    fn test_multiple_pii() {
        let t = extract_template("user john@mail.com ip=1.2.3.4 done");
        assert!(t.contains("<EMAIL>"));
        assert!(t.contains("<IP>"));
    }

    // T-E-05: 200자 이하 — 원본 길이 유지
    #[test]
    fn test_short_line_preserved() {
        let line = "ERROR disk full";
        let t = extract_template(line);
        // 200자 이하이므로 … 없음
        assert!(!t.ends_with('…'));
    }

    // T-E-06: 200자 초과 — … 접미사
    #[test]
    fn test_long_line_truncated_with_ellipsis() {
        let long = "X".repeat(300);
        let t = extract_template(&long);
        assert!(t.ends_with('…'), "truncated string must end with …");
        assert_eq!(t.chars().count(), 201); // 200 chars + …
    }

    // T-E-08: 한글 포함 — 한글 유지, 주민번호 마스킹
    #[test]
    fn test_korean_preserved_jumin_masked() {
        let t = extract_template("오류: 사용자 900101-1234567 접근");
        assert!(t.contains("오류"));
        assert!(t.contains("<JUMINNO>"), "got: {}", t);
    }

    // T-F-01: 빈 문자열
    #[test]
    fn test_empty_string() {
        let t = extract_template("");
        assert_eq!(t, "");
    }

    // T-F-02: 공백만
    #[test]
    fn test_whitespace_only() {
        let t = extract_template("   ");
        assert_eq!(t, "   ");
    }

    // T-F-03: 특수문자만
    #[test]
    fn test_special_chars_only() {
        let t = extract_template("!@#$%^&*()");
        assert_eq!(t, "!@#$%^&*()");
    }

    // T-F-05: 매우 긴 단일 토큰 — 크래시 없음
    #[test]
    fn test_very_long_token() {
        let long_num = "1".repeat(10_000);
        let t = extract_template(&long_num);
        // 크래시 없이 처리되고 트런케이션 적용
        assert!(t.chars().count() <= 201);
    }

    // LD-06: PII 마스킹 처리량 — 10,000 줄 < 1초
    #[test]
    fn test_load_pii_masking_throughput() {
        let lines: Vec<String> = (0..10_000)
            .map(|_| "ERROR user john@example.com ip=192.168.1.100 id=1234567".to_string())
            .collect();
        let start = std::time::Instant::now();
        for line in &lines {
            let _ = extract_template(line);
        }
        let elapsed = start.elapsed();
        assert!(elapsed.as_secs() < 1, "10k PII masking took {:?} > 1s", elapsed);
    }
}
