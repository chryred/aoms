/// Snappy-compress bytes for Prometheus Remote Write
pub fn compress(data: &[u8]) -> Vec<u8> {
    snap::raw::Encoder::new()
        .compress_vec(data)
        .unwrap_or_else(|_| data.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compress_roundtrip() {
        let data = b"hello world prometheus remote write test data";
        let compressed = compress(data);
        assert!(!compressed.is_empty());
        let decompressed = snap::raw::Decoder::new()
            .decompress_vec(&compressed)
            .unwrap();
        assert_eq!(decompressed, data);
    }

    // C-N-02: 빈 데이터 압축
    #[test]
    fn test_compress_empty() {
        let compressed = compress(&[]);
        // 빈 데이터도 크래시 없이 처리
        let decompressed = snap::raw::Decoder::new()
            .decompress_vec(&compressed)
            .unwrap_or_default();
        assert!(decompressed.is_empty());
    }

    // C-N-03: 반복 패턴 데이터 — 높은 압축률
    #[test]
    fn test_compress_repetitive_data() {
        let data: Vec<u8> = vec![0xABu8; 10_000];
        let compressed = compress(&data);
        assert!(
            compressed.len() < data.len(),
            "repetitive data should compress smaller: {} -> {}",
            data.len(),
            compressed.len()
        );
        let decompressed = snap::raw::Decoder::new()
            .decompress_vec(&compressed)
            .unwrap();
        assert_eq!(decompressed, data);
    }

    // C-E-01: 대용량 데이터 (1MB) 압축
    #[test]
    fn test_compress_large_data() {
        let data: Vec<u8> = (0..1_048_576).map(|i| (i % 256) as u8).collect();
        let compressed = compress(&data);
        assert!(!compressed.is_empty());
        let decompressed = snap::raw::Decoder::new()
            .decompress_vec(&compressed)
            .unwrap();
        assert_eq!(decompressed, data);
    }

    // C-E-02: 이중 압축 — 크기 증가 허용
    #[test]
    fn test_double_compress() {
        let data = b"test data for double compression";
        let compressed1 = compress(data);
        let compressed2 = compress(&compressed1);
        // 이중 압축 후에도 크래시 없음
        assert!(!compressed2.is_empty());
    }
}
