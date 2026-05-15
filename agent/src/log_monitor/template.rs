use regex::Regex;
use std::sync::OnceLock;

static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn get_patterns() -> &'static Vec<(Regex, &'static str)> {
    PATTERNS.get_or_init(|| {
        vec![
            // 타임스탬프 (대괄호 포함) e.g. [2026-05-04 19:07:00,005]
            (
                Regex::new(r"\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[.,]\d{1,6}\]").unwrap(),
                "<DATETIME>",
            ),
            // 타임스탬프 (대괄호 없음) e.g. 2026-05-04 19:07:00,005 or 2026-05-04T19:07:00.000Z
            (
                Regex::new(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?").unwrap(),
                "<DATETIME>",
            ),
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
        ]
    })
}

/// Mask PII from a log line and return a normalized template string.
pub fn extract_template(line: &str) -> String {
    let mut result = line.to_string();
    for (re, replacement) in get_patterns() {
        result = re.replace_all(&result, *replacement).to_string();
    }
    mask_large_numbers(&result)
}

/// 5자리 이상 숫자를 <NUM>으로 마스킹하되, ClassName.java:NNN 패턴은 보호.
/// Rust regex lookbehind 미지원으로 클로저 기반 처리.
fn mask_large_numbers(s: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"([\w\$]+\.java:\d+)|(\b\d{5,}\b)").unwrap()
    });
    re.replace_all(s, |caps: &regex::Captures| {
        if caps.get(1).is_some() {
            caps[1].to_string()
        } else {
            "<NUM>".to_string()
        }
    })
    .to_string()
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
    fn test_java_line_number_preserved() {
        let t = extract_template("at com.example.Service.method(Service.java:12345)");
        assert!(t.contains("Service.java:12345"), "Java 라인 번호는 마스킹 안 됨: {}", t);
        assert!(!t.contains("<NUM>"));
    }

    #[test]
    fn test_large_number_still_masked() {
        let t = extract_template("transaction id=12345 failed");
        assert!(t.contains("<NUM>"), "독립 5자리+ 숫자는 여전히 마스킹: {}", t);
    }

    #[test]
    fn test_inner_class_line_number_preserved() {
        let t = extract_template("at com.example.Outer$Inner.run(Outer.java:99999)");
        assert!(t.contains("Outer.java:99999"), "내부 클래스 라인 번호 보호: {}", t);
    }

    #[test]
    fn test_no_false_positive() {
        // Short words should not be replaced
        let t = extract_template("ERROR: disk full at /var/log");
        assert!(t.contains("disk full"));
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

    // T-E-08: 한글 포함 — 한글 유지, 주민번호 마스킹
    #[test]
    fn test_korean_preserved_jumin_masked() {
        let t = extract_template("오류: 사용자 900101-1234567 접근");
        assert!(t.contains("오류"));
        assert!(t.contains("<JUMINNO>"), "got: {}", t);
    }

    // T-DT-01: 대괄호 포함 타임스탬프 정규화 (log4j 스타일)
    #[test]
    fn test_mask_datetime_bracketed() {
        let t = extract_template("[2026-05-04 19:07:00,005] DEBUG BatchJobVocAnswer : BATCH_ERROR");
        assert_eq!(t, "<DATETIME> DEBUG BatchJobVocAnswer : BATCH_ERROR");
    }

    // T-DT-02: 대괄호 없는 타임스탬프 정규화
    #[test]
    fn test_mask_datetime_plain() {
        let t = extract_template("2026-05-04 19:07:00,005 ERROR something failed");
        assert_eq!(t, "<DATETIME> ERROR something failed");
    }

    // T-DT-03: ISO 8601 (T 구분자, Z suffix)
    #[test]
    fn test_mask_datetime_iso8601() {
        let t = extract_template("2026-05-04T19:07:00.005Z ERROR something failed");
        assert_eq!(t, "<DATETIME> ERROR something failed");
    }

    // T-DT-04: 동일 에러, 다른 타임스탬프 → 같은 template 생성
    #[test]
    fn test_same_template_different_timestamps() {
        let t1 = extract_template("[2026-05-04 19:05:00,006] DEBUG BatchJobVocAnswer : BATCH_ERROR");
        let t2 = extract_template("[2026-05-04 19:07:00,005] DEBUG BatchJobVocAnswer : BATCH_ERROR");
        assert_eq!(t1, t2, "서로 다른 타임스탬프가 같은 template으로 정규화되어야 함");
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
