/// Write-Ahead Log for buffering Remote Write payloads during network outages.
/// Format: each entry = [8-byte timestamp_ms BE][4-byte len BE][len bytes of compressed data]
///
/// Drain semantics:
///   1. `drain_pending()` — read all WAL segments, return payloads + their paths
///   2. On successful send, call `confirm_sent(paths)` to delete the segment files
///   3. If send fails, the segment files remain → retried next cycle or restart
///   4. `has_pending()` — quick check used for runtime retry decision
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

pub struct Wal {
    dir: PathBuf,
    retention: Duration,
}

impl Wal {
    pub fn new(dir: &str, retention_hours: u64) -> std::io::Result<Self> {
        let path = PathBuf::from(dir);
        fs::create_dir_all(&path)?;
        Ok(Self {
            dir: path,
            retention: Duration::from_secs(retention_hours * 3600),
        })
    }

    fn active_segment_path(&self) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let hour_ts = ts / 3600 * 3600;
        self.dir.join(format!("wal-{}.bin", hour_ts))
    }

    /// Append a compressed payload to the current WAL segment (on send failure).
    pub fn append(&self, data: &[u8]) -> std::io::Result<()> {
        let path = self.active_segment_path();
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        file.write_all(&ts.to_be_bytes())?;
        file.write_all(&(data.len() as u32).to_be_bytes())?;
        file.write_all(data)?;
        debug!("WAL append: {} bytes to {:?}", data.len(), path);
        Ok(())
    }

    /// Return true if any WAL segment files exist (for runtime retry decision).
    pub fn has_pending(&self) -> bool {
        fs::read_dir(&self.dir)
            .ok()
            .map(|mut rd| rd.any(|e| {
                e.ok()
                    .and_then(|e| e.file_name().into_string().ok())
                    .map(|n| n.ends_with(".bin"))
                    .unwrap_or(false)
            }))
            .unwrap_or(false)
    }

    /// Read all WAL segment files and return (payloads, segment_paths).
    /// Does NOT delete — call `confirm_sent(paths)` after successful send.
    pub fn drain_pending(&self) -> std::io::Result<(Vec<Vec<u8>>, Vec<PathBuf>)> {
        let mut payloads = Vec::new();
        let mut segment_paths = Vec::new();

        let mut entries: Vec<PathBuf> = fs::read_dir(&self.dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("bin"))
            .collect();

        // Process oldest segments first
        entries.sort();

        for path in entries {
            let mut file = match File::open(&path) {
                Ok(f) => f,
                Err(e) => {
                    warn!("WAL open failed {:?}: {}", path, e);
                    continue;
                }
            };
            let mut buf = Vec::new();
            if let Err(e) = file.read_to_end(&mut buf) {
                warn!("WAL read failed {:?}: {}", path, e);
                continue;
            }

            let mut pos = 0;
            let mut count = 0;
            while pos + 12 <= buf.len() {
                let _ts = u64::from_be_bytes(buf[pos..pos + 8].try_into().unwrap());
                let len = u32::from_be_bytes(buf[pos + 8..pos + 12].try_into().unwrap()) as usize;
                pos += 12;
                if pos + len > buf.len() {
                    warn!("WAL truncated record in {:?}", path);
                    break;
                }
                payloads.push(buf[pos..pos + len].to_vec());
                pos += len;
                count += 1;
            }
            if count > 0 {
                segment_paths.push(path);
            }
        }

        info!("WAL drain: {} payloads from {} segment(s)", payloads.len(), segment_paths.len());
        Ok((payloads, segment_paths))
    }

    /// Delete segment files after all their payloads have been successfully sent.
    pub fn confirm_sent(&self, paths: &[PathBuf]) -> std::io::Result<()> {
        for path in paths {
            if let Err(e) = fs::remove_file(path) {
                warn!("WAL confirm_sent: failed to remove {:?}: {}", path, e);
            } else {
                debug!("WAL confirmed sent, removed {:?}", path);
            }
        }
        Ok(())
    }

    /// Remove WAL segments older than retention period (run periodically).
    #[cfg(test)]
    pub fn active_segment_path_for_ts(&self, hour_ts: u64) -> PathBuf {
        self.dir.join(format!("wal-{}.bin", hour_ts))
    }

    pub fn gc(&self) -> std::io::Result<()> {
        let cutoff = SystemTime::now()
            .checked_sub(self.retention)
            .unwrap_or(UNIX_EPOCH);
        let cutoff_ts = cutoff
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if let Some(ts_str) = fname.strip_prefix("wal-").and_then(|s| s.strip_suffix(".bin")) {
                if let Ok(ts) = ts_str.parse::<u64>() {
                    if ts < cutoff_ts {
                        let _ = fs::remove_file(&path);
                        info!("WAL GC: removed {:?}", path);
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_wal(retention_hours: u64) -> (Wal, TempDir) {
        let dir = TempDir::new().unwrap();
        let wal = Wal::new(dir.path().to_str().unwrap(), retention_hours).unwrap();
        (wal, dir)
    }

    // W-N-01: append 정상 — wal-{hour}.bin 파일 생성
    #[test]
    fn test_append_creates_file() {
        let (wal, _dir) = make_wal(2);
        wal.append(b"test payload").unwrap();
        let seg = wal.active_segment_path();
        assert!(seg.exists());
    }

    // W-N-02: drain_pending 정상 — payload 반환
    #[test]
    fn test_drain_pending_returns_payload() {
        let (wal, _dir) = make_wal(2);
        let payload = b"hello wal";
        wal.append(payload).unwrap();
        let (payloads, paths) = wal.drain_pending().unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0], payload);
        assert_eq!(paths.len(), 1);
    }

    // W-N-03: confirm_sent — 파일 삭제
    #[test]
    fn test_confirm_sent_deletes_file() {
        let (wal, _dir) = make_wal(2);
        wal.append(b"data").unwrap();
        let (_, paths) = wal.drain_pending().unwrap();
        assert!(!paths.is_empty());
        wal.confirm_sent(&paths).unwrap();
        for p in &paths {
            assert!(!p.exists());
        }
    }

    // W-N-04: has_pending true
    #[test]
    fn test_has_pending_true() {
        let (wal, _dir) = make_wal(2);
        wal.append(b"data").unwrap();
        assert!(wal.has_pending());
    }

    // W-N-05: has_pending false
    #[test]
    fn test_has_pending_false() {
        let (wal, _dir) = make_wal(2);
        assert!(!wal.has_pending());
    }

    // W-N-06: gc — retention 초과 세그먼트 삭제
    #[test]
    fn test_gc_removes_old_segment() {
        let (wal, _dir) = make_wal(0); // retention = 0 hours → all old
        // 과거 타임스탬프로 파일 직접 생성
        let old_ts = 1000u64; // epoch 1000s — 확실히 과거
        let old_path = wal.dir.join(format!("wal-{}.bin", old_ts));
        fs::write(&old_path, b"old data").unwrap();
        assert!(old_path.exists());
        wal.gc().unwrap();
        assert!(!old_path.exists(), "gc should remove old segment");
    }

    // W-N-07: gc — 최신 세그먼트 보존
    #[test]
    fn test_gc_keeps_recent_segment() {
        let (wal, _dir) = make_wal(2); // retention = 2 hours
        wal.append(b"recent data").unwrap();
        let seg = wal.active_segment_path();
        wal.gc().unwrap();
        assert!(seg.exists(), "gc should keep recent segment");
    }

    // W-E-01: 여러 세그먼트 drain — 오래된 순서부터
    #[test]
    fn test_drain_multiple_segments_ordered() {
        let (wal, _dir) = make_wal(2);
        // 가상의 타임스탬프로 세그먼트 직접 생성
        let ts1 = 1000u64;
        let ts2 = 2000u64;
        let path1 = wal.dir.join(format!("wal-{}.bin", ts1));
        let path2 = wal.dir.join(format!("wal-{}.bin", ts2));

        // 수동으로 WAL 형식으로 기록
        fn write_wal_entry(path: &std::path::Path, data: &[u8]) {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
            let ts: u64 = 999;
            f.write_all(&ts.to_be_bytes()).unwrap();
            f.write_all(&(data.len() as u32).to_be_bytes()).unwrap();
            f.write_all(data).unwrap();
        }

        write_wal_entry(&path1, b"first");
        write_wal_entry(&path2, b"second");

        let (payloads, _) = wal.drain_pending().unwrap();
        assert_eq!(payloads.len(), 2);
        assert_eq!(payloads[0], b"first"); // 오래된 순
        assert_eq!(payloads[1], b"second");
    }

    // W-E-02: drain 후 confirm 없이 재drain — 멱등성
    #[test]
    fn test_drain_idempotent_without_confirm() {
        let (wal, _dir) = make_wal(2);
        wal.append(b"persistent").unwrap();
        let (p1, _) = wal.drain_pending().unwrap();
        let (p2, _) = wal.drain_pending().unwrap();
        assert_eq!(p1, p2);
    }

    // W-E-03: wal_dir 없을 시 자동 생성
    #[test]
    fn test_wal_dir_auto_create() {
        let parent = TempDir::new().unwrap();
        let new_dir = parent.path().join("nested/wal");
        let result = Wal::new(new_dir.to_str().unwrap(), 2);
        assert!(result.is_ok());
        assert!(new_dir.exists());
    }

    // W-F-01: 손상된 .bin 파일 — truncated header
    #[test]
    fn test_drain_corrupted_file() {
        let (wal, _dir) = make_wal(2);
        let path = wal.dir.join("wal-1000.bin");
        // 헤더 4바이트만 기록 (정상은 12바이트 헤더 + 데이터)
        fs::write(&path, b"\x00\x00\x00\x01").unwrap();
        let (payloads, _) = wal.drain_pending().unwrap();
        // 손상된 레코드는 건너뜀 (0 payloads from this file)
        assert!(payloads.is_empty());
    }

    // W-F-02: 빈 .bin 파일
    #[test]
    fn test_drain_empty_file() {
        let (wal, _dir) = make_wal(2);
        let path = wal.dir.join("wal-1000.bin");
        fs::write(&path, b"").unwrap();
        let (payloads, _) = wal.drain_pending().unwrap();
        assert!(payloads.is_empty());
    }

    // 여러 payload append 후 drain
    #[test]
    fn test_multiple_append_drain() {
        let (wal, _dir) = make_wal(2);
        wal.append(b"first").unwrap();
        wal.append(b"second").unwrap();
        wal.append(b"third").unwrap();
        let (payloads, _) = wal.drain_pending().unwrap();
        assert_eq!(payloads.len(), 3);
        assert_eq!(payloads[0], b"first");
        assert_eq!(payloads[1], b"second");
        assert_eq!(payloads[2], b"third");
    }
}
