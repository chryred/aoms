use aho_corasick::AhoCorasick;

/// Extracts the error level from a matching line.
/// Returns (level, matched_keyword) or None if no keyword matches.
pub struct KeywordMatcher {
    ac: AhoCorasick,
    patterns: Vec<String>,
}

impl KeywordMatcher {
    pub fn new(keywords: &[String]) -> Self {
        let ac = AhoCorasick::builder()
            .ascii_case_insensitive(false)
            .build(keywords)
            .expect("Failed to build AhoCorasick matcher");
        Self {
            ac,
            patterns: keywords.to_vec(),
        }
    }

    /// Returns the matched keyword if any pattern is found in `line`.
    pub fn find_level<'a>(&self, line: &'a str) -> Option<&str> {
        self.ac
            .find(line)
            .map(|m| self.patterns[m.pattern().as_usize()].as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_matcher() -> KeywordMatcher {
        KeywordMatcher::new(&[
            "ERROR".to_string(),
            "CRITICAL".to_string(),
            "Fatal".to_string(),
        ])
    }

    #[test]
    fn test_finds_error() {
        let m = make_matcher();
        assert_eq!(m.find_level("2024-01-01 ERROR something failed"), Some("ERROR"));
    }

    #[test]
    fn test_finds_critical() {
        let m = make_matcher();
        assert_eq!(m.find_level("[CRITICAL] disk full"), Some("CRITICAL"));
    }

    #[test]
    fn test_no_match() {
        let m = make_matcher();
        assert!(m.find_level("INFO: everything is fine").is_none());
    }

    #[test]
    fn test_case_sensitive() {
        let m = make_matcher();
        // "error" (lowercase) should NOT match "ERROR" pattern
        assert!(m.find_level("error: something").is_none());
    }

    // K-N-04: Fatal 매칭
    #[test]
    fn test_finds_fatal() {
        let m = make_matcher();
        assert_eq!(m.find_level("Fatal error occurred"), Some("Fatal"));
    }

    // K-N-06: 커스텀 키워드 매칭
    #[test]
    fn test_custom_keywords() {
        let m = KeywordMatcher::new(&["SEVERE".to_string(), "ALERT".to_string()]);
        assert_eq!(m.find_level("SEVERE: disk 90%"), Some("SEVERE"));
        assert_eq!(m.find_level("ALERT triggered"), Some("ALERT"));
    }

    // K-E-02: 부분 일치 — "ERRORHANDLER"도 매칭 (AhoCorasick substring 기본 동작)
    #[test]
    fn test_partial_match_in_word() {
        let m = make_matcher();
        // AhoCorasick은 기본적으로 substring 매칭 → ERRORHANDLER에서 ERROR가 매칭됨
        assert!(m.find_level("ERRORHANDLER called").is_some());
    }

    // K-E-03: 동일 줄에 여러 키워드 — 첫 번째 매칭 반환
    #[test]
    fn test_multiple_keywords_same_line() {
        let m = make_matcher();
        let result = m.find_level("ERROR CRITICAL PANIC on line 42");
        assert!(result.is_some());
        // 첫 번째 매칭인 ERROR가 반환되어야 함
        assert_eq!(result, Some("ERROR"));
    }

    // K-E-04: 빈 줄
    #[test]
    fn test_empty_line() {
        let m = make_matcher();
        assert!(m.find_level("").is_none());
    }

    // K-E-05: 공백만
    #[test]
    fn test_whitespace_only() {
        let m = make_matcher();
        assert!(m.find_level("   ").is_none());
    }

    // K-E-06: 키워드가 줄 중간에 위치
    #[test]
    fn test_keyword_in_middle() {
        let m = make_matcher();
        assert_eq!(m.find_level("process ERROR terminated"), Some("ERROR"));
    }

    // K-E-07: 유니코드 포함 줄
    #[test]
    fn test_unicode_line() {
        let m = make_matcher();
        assert_eq!(m.find_level("오류ERROR발생"), Some("ERROR"));
    }

    // K-F-01: 빈 keywords 배열 — 모든 줄 None
    #[test]
    fn test_empty_keywords() {
        let m = KeywordMatcher::new(&[]);
        assert!(m.find_level("ERROR CRITICAL PANIC").is_none());
    }

    // K-F-02: 매칭 없는 줄
    #[test]
    fn test_no_match_info_line() {
        let m = make_matcher();
        assert!(m.find_level("INFO server started successfully").is_none());
    }

    // K-F-03: 매우 긴 줄 (100KB)
    #[test]
    fn test_very_long_line() {
        let m = make_matcher();
        let long = "x".repeat(100_000) + "ERROR at end";
        let result = m.find_level(&long);
        assert_eq!(result, Some("ERROR"));
    }

    // K-F-04: 키워드 자체가 줄 내용
    #[test]
    fn test_keyword_is_entire_line() {
        let m = make_matcher();
        assert_eq!(m.find_level("ERROR"), Some("ERROR"));
    }

    // LD-04: 초당 100,000 줄 매칭 처리량 검증
    #[test]
    fn test_load_100k_lines_matching() {
        let m = KeywordMatcher::new(&["ERROR".to_string(), "CRITICAL".to_string()]);
        let lines: Vec<String> = (0..100_000)
            .map(|i| if i % 10 == 0 { "ERROR: something failed".to_string() } else { "INFO: all good".to_string() })
            .collect();
        let start = std::time::Instant::now();
        let matched: usize = lines.iter().filter(|l| m.find_level(l).is_some()).count();
        let elapsed = start.elapsed();
        assert_eq!(matched, 10_000); // 10%가 ERROR 포함
        // 100k 줄 매칭이 1초 이내 완료되어야 함
        assert!(elapsed.as_secs() < 1, "100k line matching took {:?} > 1s", elapsed);
    }

    // LD-05: 10KB 줄 매칭 — 크래시 없음
    #[test]
    fn test_load_large_line() {
        let m = make_matcher();
        let long_line = "x".repeat(10_240) + " ERROR at end";
        let result = m.find_level(&long_line);
        assert_eq!(result, Some("ERROR"));
    }
}
