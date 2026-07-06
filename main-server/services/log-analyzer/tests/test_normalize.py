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


# ── 신규 규칙: 값-마스킹 (숫자 포함 영숫자 값 → <VAL>) ────────────────────────

def test_alnum_id_values_collapse():
    """KEY=C121212 와 KEY=C11211111 은 같은 패턴 (cxm ordInfo 고객ID 419변형 → 수 개)."""
    a = "ERROR [ServiceSupportICS.error:79] ordInfo: {SSG_PT_CUST_ID=C121212, MOBILE_ORD_YN=Y}"
    b = "ERROR [ServiceSupportICS.error:79] ordInfo: {SSG_PT_CUST_ID=C11211111, MOBILE_ORD_YN=Y}"
    assert norm(a) == norm(b)
    assert "=<VAL>" in norm(a)


def test_json_string_values_with_digits_collapse():
    """JSON 문자열 값 중 숫자 포함 값만 마스킹 (AppPush response body 변형 흡수)."""
    a = '#[DS-APP-PUSH] response body : {"successOrNot":"Y","serial":"a1b2c3"}'
    b = '#[DS-APP-PUSH] response body : {"successOrNot":"Y","serial":"z9y8x7"}'
    assert norm(a) == norm(b)


def test_pure_letter_status_values_preserved():
    """Y/N/SUCCESS 같은 순수 문자 상태값은 보존 — 성공/실패 응답은 서로 다른 패턴 유지."""
    ok = 'response body : {"successOrNot":"Y","statusCode":"SUCCESS"}'
    fail = 'response body : {"successOrNot":"N","statusCode":"FAIL"}'
    assert norm(ok) != norm(fail)
    assert '"Y"' in norm(ok) and '"N"' in norm(fail)


def test_flag_values_preserved_korean_values_masked():
    """Y/N 플래그는 보존(상태 구분), 한글·? 데이터값(고객명·매장명)은 마스킹 (무한 카디널리티 제거)."""
    a = "ordInfo: {MOBILE_ORD_YN=Y, CUST_NM=홍길동, STORE_NM=강남점}"
    b = "ordInfo: {MOBILE_ORD_YN=N, CUST_NM=김철수, STORE_NM=강남점}"
    assert norm(a) != norm(b)                      # Y vs N — 플래그 구분 유지
    assert "CUST_NM=<VAL>" in norm(a)              # 한글 고객명 마스킹
    # 고객명만 다른 두 로그는 같은 패턴 (agent가 비ASCII를 ?로 치환한 형태 포함)
    c = "ordInfo: {MOBILE_ORD_YN=Y, CUST_NM=???, STORE_NM=??}"
    d = "ordInfo: {MOBILE_ORD_YN=Y, CUST_NM=?? ??? (??), STORE_NM=??}"
    assert norm(c) == norm(d)


def test_empty_and_numeric_values_unified():
    """KEY=(빈값)/KEY=123/KEY=C1X2 는 같은 패턴 — 주문 상태별 채움 여부 조합 폭증 방지."""
    a = "dcCustInfo>>{BENE_GRP_SEQ=, ORD_SEQ=12345, SESSION_USER_ID=hnlounge4}"
    b = "dcCustInfo>>{BENE_GRP_SEQ=99, ORD_SEQ=, SESSION_USER_ID=hnlounge7}"
    assert norm(a) == norm(b)
    # 순수 문자 상태값은 빈값·마스킹값과 구분 유지
    assert norm("status=FAILED") != norm("status=")


def test_json_numeric_and_empty_string_values_unified():
    """JSON 숫자 값("loungeId":122)과 빈 문자열("customerId":"")도 마스킹 (AppPush request body)."""
    a = 'request body : {"customerId":"","loungeId":122}'
    b = 'request body : {"customerId":"C99X1","loungeId":123}'
    assert norm(a) == norm(b)


def test_list_dump_repeat_blocks_and_tail_collapse():
    """리스트형 덤프: 품목 수(반복 {…} 블록)·절단 꼬리 차이는 길이 상한(400)으로 병합.

    실데이터(dcOrderDtlList)는 블록 1개가 이미 400자를 넘으므로, 품목 2개 주문과
    5개 주문은 상한 절단 후 같은 패턴이 된다 (실측 50변형 → 수 개).
    """
    keys = ", ".join(f"K{i:02d}_FIELD_NAME=V{i}X9" for i in range(30))   # 블록 1개 ≈ 700자
    item = "{" + keys + "}"
    a = f"ERROR [ServiceSupportICS.error:79] dcOrderDtlList : [{item}, {item}]"
    b = f"ERROR [ServiceSupportICS.error:79] dcOrderDtlList : [{item}, {item}, {item}, {item}, {item}]"
    assert norm(a) == norm(b)          # 품목 2개 주문과 5개 주문은 같은 패턴
    assert len(norm(b)) <= 400


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
