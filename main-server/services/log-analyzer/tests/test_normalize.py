"""normalize_log_for_embedding 정규화 규칙 테스트 (Phase A — 종류 폭증 완화).

고카디널리티 원인인 URL 쿼리스트링/라인번호/할당값 변형을 묶어 같은 논리 에러가
여러 template으로 갈리는 것을 방지한다. 단, 서로 다른 에러코드는 병합하지 않는다(과병합 금지).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vector_client import normalize_log_for_embedding as norm  # noqa: E402


# ── 신규 규칙: URL 변형 흡수 ───────────────────────────────────────────────────

def test_url_query_and_path_variants_collapse():
    """referer URL의 쿼리스트링/경로/스킴 차이는 하나로 수렴 (cxm SSO 147변형 → 1)."""
    a = "ERROR [SSOUtil.checkSSOActivate] referer = https://crm.example.com/x.html?w2xPath=/a/b.xml&_currentTime=633"
    b = "ERROR [SSOUtil.checkSSOActivate] referer = http://crm.example.com/x.html?w2xPath=/c/d.xml&_currentTime=96"
    assert norm(a) == norm(b)


# ── 신규 규칙: 소스 라인번호 흡수 ──────────────────────────────────────────────

def test_source_line_ref_collapses():
    """[Class.method:248] 과 [Class.method:234] 는 같은 패턴."""
    assert norm("ERROR [SSOUtil.checkSSOActivate:248] msg") == norm("ERROR [SSOUtil.checkSSOActivate:234] msg")


# ── 신규 규칙: 할당값(=숫자) 흡수 ──────────────────────────────────────────────

def test_assignment_number_collapses():
    """{loungeId=2} 와 {loungeId=5} 는 같은 패턴 (가변 ID)."""
    assert norm("request body {loungeId=2, storeCd=10}") == norm("request body {loungeId=5, storeCd=99}")


# ── 과병합 금지: 서로 다른 에러코드는 분리 유지 ───────────────────────────────

def test_distinct_error_codes_not_merged():
    """공백으로 분리된 상태코드/에러코드는 서로 다른 패턴으로 유지되어야 한다."""
    assert norm("connection failed code 404") != norm("connection failed code 500")


# ── 하위 호환: 기존 규칙 유지 ─────────────────────────────────────────────────

def test_existing_timestamp_and_ip_still_normalized():
    out = norm("2026-03-15T10:00:00 ORA-00060 from 10.0.1.5")
    assert "<TS>" in out and "<IP>" in out
    # 같은 형태의 다른 타임스탬프/IP는 동일 패턴
    assert norm("2026-03-15T10:00:00 X from 10.0.1.5") == norm("2026-04-01T23:59:59 X from 192.168.0.1")
