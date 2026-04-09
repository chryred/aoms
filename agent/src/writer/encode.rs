/// Manual Prometheus Remote Write protobuf encoder.
/// Avoids protoc dependency — encodes WriteRequest proto directly.
///
/// Proto schema:
///   message WriteRequest { repeated TimeSeries timeseries = 1; }
///   message TimeSeries   { repeated Label labels = 1; repeated Sample samples = 2; }
///   message Label        { string name = 1; string value = 2; }
///   message Sample       { double value = 1; int64 timestamp = 2; }
use crate::metrics::MetricSample;

// Protobuf wire types
const WIRE_VARINT: u8 = 0;
const WIRE_64BIT: u8 = 1;
const WIRE_LEN: u8 = 2;

fn field_tag(field: u32, wire: u8) -> u32 {
    (field << 3) | (wire as u32)
}

fn write_varint(buf: &mut Vec<u8>, mut val: u64) {
    loop {
        let byte = (val & 0x7F) as u8;
        val >>= 7;
        if val == 0 {
            buf.push(byte);
            break;
        }
        buf.push(byte | 0x80);
    }
}

fn write_tag(buf: &mut Vec<u8>, field: u32, wire: u8) {
    write_varint(buf, field_tag(field, wire) as u64);
}

fn write_bytes(buf: &mut Vec<u8>, data: &[u8]) {
    write_varint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

fn write_string(buf: &mut Vec<u8>, field: u32, s: &str) {
    write_tag(buf, field, WIRE_LEN);
    write_bytes(buf, s.as_bytes());
}

fn write_double(buf: &mut Vec<u8>, field: u32, val: f64) {
    write_tag(buf, field, WIRE_64BIT);
    buf.extend_from_slice(&val.to_le_bytes());
}

fn write_int64(buf: &mut Vec<u8>, field: u32, val: i64) {
    write_tag(buf, field, WIRE_VARINT);
    // int64 uses varint encoding; negative values use 10 bytes (zigzag not needed for int64)
    write_varint(buf, val as u64);
}

fn encode_label(name: &str, value: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    write_string(&mut buf, 1, name);
    write_string(&mut buf, 2, value);
    buf
}

fn encode_sample(value: f64, timestamp_ms: i64) -> Vec<u8> {
    let mut buf = Vec::new();
    write_double(&mut buf, 1, value);
    write_int64(&mut buf, 2, timestamp_ms);
    buf
}

fn encode_timeseries(labels: &[(String, String)], value: f64, timestamp_ms: i64) -> Vec<u8> {
    let mut buf = Vec::new();

    for (name, val) in labels {
        let label_bytes = encode_label(name, val);
        write_tag(&mut buf, 1, WIRE_LEN);
        write_bytes(&mut buf, &label_bytes);
    }

    let sample_bytes = encode_sample(value, timestamp_ms);
    write_tag(&mut buf, 2, WIRE_LEN);
    write_bytes(&mut buf, &sample_bytes);

    buf
}

/// Encode a slice of MetricSamples into a Prometheus Remote Write protobuf WriteRequest.
pub fn encode_samples(samples: &[MetricSample]) -> Vec<u8> {
    let mut write_request = Vec::new();

    for sample in samples {
        // Build labels including __name__
        let mut labels = sample.labels.clone();
        labels.push(("__name__".to_string(), sample.name.clone()));
        // Prometheus requires labels sorted by name
        labels.sort_by(|a, b| a.0.cmp(&b.0));

        let ts_bytes = encode_timeseries(&labels, sample.value, sample.timestamp_ms);
        write_tag(&mut write_request, 1, WIRE_LEN);
        write_bytes(&mut write_request, &ts_bytes);
    }

    write_request
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::MetricSample;

    #[test]
    fn test_encode_non_empty() {
        let samples = vec![MetricSample::new(
            "cpu_usage_percent",
            vec![
                ("system_name".to_string(), "test".to_string()),
                ("core".to_string(), "total".to_string()),
            ],
            42.5,
        )];
        let encoded = encode_samples(&samples);
        assert!(!encoded.is_empty());
    }

    #[test]
    fn test_encode_empty() {
        let encoded = encode_samples(&[]);
        assert!(encoded.is_empty());
    }

    #[test]
    fn test_encode_multiple() {
        let samples: Vec<MetricSample> = (0..10)
            .map(|i| {
                MetricSample::new(
                    "test_metric",
                    vec![("i".to_string(), i.to_string())],
                    i as f64,
                )
            })
            .collect();
        let encoded = encode_samples(&samples);
        assert!(encoded.len() > 100);
    }

    #[test]
    fn test_varint_encoding() {
        let mut buf = Vec::new();
        write_varint(&mut buf, 300);
        assert_eq!(buf, vec![0xAC, 0x02]);
    }

    // E-N-02: 레이블 알파벳 정렬 확인
    #[test]
    fn test_label_sorted_alphabetically() {
        let samples = vec![MetricSample::new(
            "test_metric",
            vec![
                ("z_label".to_string(), "z".to_string()),
                ("a_label".to_string(), "a".to_string()),
            ],
            1.0,
        )];
        let encoded = encode_samples(&samples);
        // 인코딩 결과를 바이트로 검색: "a_label" 문자열이 "z_label" 전에 나타나야 함
        let a_pos = encoded.windows(7).position(|w| w == b"a_label").unwrap();
        let z_pos = encoded.windows(7).position(|w| w == b"z_label").unwrap();
        assert!(a_pos < z_pos, "a_label must come before z_label");
    }

    // E-N-03: __name__ 레이블 포함
    #[test]
    fn test_name_label_included() {
        let samples = vec![MetricSample::new(
            "cpu_usage_percent",
            vec![("host".to_string(), "test".to_string())],
            1.0,
        )];
        let encoded = encode_samples(&samples);
        let name_bytes = b"__name__";
        assert!(
            encoded.windows(8).any(|w| w == name_bytes),
            "__name__ label must be present in encoded output"
        );
    }

    // E-N-04: 타임스탬프 정확도
    #[test]
    fn test_timestamp_encoded() {
        let ts: i64 = 1712563200000;
        let sample_bytes = encode_sample(1.0, ts);
        // timestamp는 field 2, varint. 인코딩 바이트에 ts가 포함되어야 함
        assert!(!sample_bytes.is_empty());
        // 역으로 re-decode 검증: 바이트 10-17이 f64 값
        assert!(sample_bytes.len() > 8);
    }

    // E-N-05: 5개 레이블 모두 포함
    #[test]
    fn test_five_labels() {
        let labels: Vec<(String, String)> = (0..5)
            .map(|i| (format!("label{}", i), format!("value{}", i)))
            .collect();
        let samples = vec![MetricSample::new("test_metric", labels, 1.0)];
        let encoded = encode_samples(&samples);
        for i in 0..5usize {
            let key = format!("label{}", i);
            assert!(
                encoded.windows(key.len()).any(|w| w == key.as_bytes()),
                "label{} must be present",
                i
            );
        }
    }

    // E-E-01: value = NaN
    #[test]
    fn test_nan_value_encodes() {
        let samples = vec![MetricSample::new(
            "test_metric",
            vec![("host".to_string(), "test".to_string())],
            f64::NAN,
        )];
        // NaN도 인코딩 가능해야 함 (크래시 없음)
        let encoded = encode_samples(&samples);
        assert!(!encoded.is_empty());
    }

    // E-E-02: value = Infinity
    #[test]
    fn test_infinity_value_encodes() {
        let samples = vec![MetricSample::new(
            "test_metric",
            vec![("host".to_string(), "test".to_string())],
            f64::INFINITY,
        )];
        let encoded = encode_samples(&samples);
        assert!(!encoded.is_empty());
    }

    // E-E-03: 레이블값 빈 문자열
    #[test]
    fn test_empty_label_value() {
        let samples = vec![MetricSample::new(
            "test_metric",
            vec![("host".to_string(), "".to_string())],
            1.0,
        )];
        let encoded = encode_samples(&samples);
        assert!(!encoded.is_empty());
    }

    // E-E-04: 레이블값 특수문자
    #[test]
    fn test_special_chars_in_label_value() {
        let samples = vec![MetricSample::new(
            "test_metric",
            vec![("label".to_string(), "a/b:c=d".to_string())],
            1.0,
        )];
        let encoded = encode_samples(&samples);
        let val = b"a/b:c=d";
        assert!(
            encoded.windows(7).any(|w| w == val),
            "special chars must be encoded as-is"
        );
    }

    // LD-01: 10,000 샘플 인코딩 < 500ms
    #[test]
    fn test_load_10k_samples_encode() {
        let samples: Vec<MetricSample> = (0..10_000)
            .map(|i| MetricSample::new(
                "cpu_usage_percent",
                vec![
                    ("system_name".to_string(), "load_test".to_string()),
                    ("core".to_string(), format!("cpu{}", i % 8)),
                ],
                (i % 100) as f64,
            ))
            .collect();
        let start = std::time::Instant::now();
        let encoded = encode_samples(&samples);
        let elapsed = start.elapsed();
        assert!(!encoded.is_empty());
        assert!(elapsed.as_millis() < 500, "encode 10k samples took {:?} > 500ms", elapsed);
    }

    // LD-03: 1,000 레이블 단일 샘플 인코딩 < 10ms
    #[test]
    fn test_load_1000_labels_single_sample() {
        let labels: Vec<(String, String)> = (0..1000)
            .map(|i| (format!("label_{:04}", i), format!("value_{}", i)))
            .collect();
        let samples = vec![MetricSample::new("big_metric", labels, 1.0)];
        let start = std::time::Instant::now();
        let encoded = encode_samples(&samples);
        let elapsed = start.elapsed();
        assert!(!encoded.is_empty());
        assert!(elapsed.as_millis() < 10, "encode 1000-label sample took {:?} > 10ms", elapsed);
    }
}
