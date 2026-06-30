"""
Synapse Log Analyzer — 핵심 분석 로직

흐름:
  1. Admin API에서 활성 시스템 목록 조회
  2. 시스템별 Prometheus에서 최근 5분 log_error_total 메트릭 조회
  3. instance_role별 그룹화
  4. 업무영역별 agent_code 조회 후 DevX OAuth API 호출
     (Phase 4b) 벡터 임베딩 → Qdrant 유사도 검색 → 강화 프롬프트 구성
  5. 분석 결과를 Admin API로 전송 (Teams 알림은 Admin API가 처리)

  로그 수집: synapse_agent → Prometheus Remote Write → log_error_total 메트릭
  (Loki 의존성 완전 제거)
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx

from vector_client import (
    build_enhanced_prompt,
    bump_occurrence,
    classify_anomaly,
    get_embedding,
    get_embedding_batch,
    get_postmortem_by_incident,
    get_sparse_vector,
    normalize_log_for_embedding,
    retrieve_point,
    retrieve_points_batch,
    search_notification_incidents,
    search_similar_incidents,
    store_incident_vector,
    template_point_id,
)

from llm_client import call_llm_structured, LLM_AGENT_CODE, LLM_TYPE
from trace_summarizer import build_trace_context
from log_normalizer import mask_sensitive_data, _sample_logs_by_type, _format_logs_by_type

logger = logging.getLogger(__name__)

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
ADMIN_API_URL  = os.getenv("ADMIN_API_URL",  "http://admin-api:8080")

# role(instance_role) 한 개가 한 사이클에 처리하는 "실에러 후보(need_llm)" distinct
# template 수 상한. 알림성(notification)은 싼 경로라 이 상한과 무관하게 전량 처리된다.
# 초과분은 드롭이 아니라 _backlog로 이월되어 다음 주기에 우선 처리된다(영구 누락 0).
_MAX_TEMPLATES_PER_ROLE = int(os.getenv("MAX_TEMPLATES_PER_ROLE", "50"))

# in-memory 백로그: "{system_name}:{instance_role}" → 이번 주기에 상한 초과로 보류된
# 실에러 template(정규화본) 리스트. 다음 주기에 우선 처리되어 단조 감소한다.
# 컨테이너 재시작 시 비워지나 다음 주기부터 재수렴(영구 누락 없음).
_backlog: dict[str, list[str]] = {}

# 모듈 레벨 공유 클라이언트 — lifespan에서 aclose() 호출
_admin_http = httpx.AsyncClient(timeout=10.0)    # admin-api 호출
_prom_http  = httpx.AsyncClient(timeout=30.0)    # Prometheus 쿼리

ANALYSIS_QUERY = """다음 서버 로그를 분석하여 반드시 아래 JSON 형식으로만 응답하세요. 추가 설명 없이 JSON만 출력하세요.

시스템명: {system_name}
서버 역할: {instance_role} ({host})
분석 대상 로그 ({count}건):

{log_content}

작성 규칙(가독성):
- root_cause: 한국어. 핵심 원인 한 줄 요약 + 근거 1~2줄. 각 문장은 줄바꿈(\\n)으로 구분. 마크다운(**, -, #) 사용 금지.
- recommendation: 한국어. 번호 목록 형식으로 작성하되 각 항목을 반드시 줄바꿈(\\n)으로 구분. 예:
  "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ..."
  한 줄에 모든 항목을 이어 쓰지 말 것. 항목 내부는 한 문장으로 간결하게.

심각도 판단 추가 규칙 (is_notification 분류):
ERROR 레벨이더라도 아래 조건을 **모두** 만족하면 severity=info, is_notification=true로 분류한다.
1. 스택트레이스가 없다 (at com., at org., Caused by: 패턴 없음)
   ※ 예외 클래스명만 있고 스택트레이스 없는 경우 → 메시지 내용으로 판단
2. DB·API·메시지큐 등 외부 시스템 연결 실패가 아니다
3. 메시지 내용이 상태 통보·비즈니스 규칙 거부·정상 종료 중 하나다
   (예: 미사용/미설정/만료/없음/차단/완료)
반드시 warning 이상: 스택트레이스 포함, 외부 연결 실패, 데이터 정합성 오류.
is_notification=true 시 root_cause: "알림성 로그 — {{판단 근거 1줄}}" 형식으로 작성.

응답 형식 (JSON만 출력):
{{
  "severity": "critical 또는 warning 또는 info",
  "is_notification": false,
  "notification_count": 0,
  "real_error_count": 0,
  "template_classifications": [
    {{"template": "로그 템플릿 텍스트", "is_notification": true, "reason": "판단 근거 1줄"}}
  ],
  "root_cause": "원인 요약\\n근거/세부 설명",
  "recommendation": "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ..."
}}

필드 설명:
- notification_count: 알림성으로 분류된 템플릿들의 [Nx] 발생횟수 합계
- real_error_count: 실에러로 분류된 템플릿들의 발생횟수 합계
- template_classifications: 각 템플릿별 분류 배열 (가능하면 포함, 없으면 빈 배열)
- is_notification (최상위): 전체 윈도우가 알림성이면 true, 하나라도 실에러이면 false"""



async def get_systems() -> list[dict]:
    """Admin API에서 활성 시스템 목록 조회"""
    resp = await _admin_http.get(f"{ADMIN_API_URL}/api/v1/systems")
    resp.raise_for_status()
    return resp.json()


_area_configs: dict[str, str] = {}
_area_configs_loaded_at: float = 0.0


async def _load_area_configs() -> dict[str, str]:
    """admin-api에서 활성 LLM agent config 목록 조회 (5분 캐시)."""
    global _area_configs, _area_configs_loaded_at
    import time
    if _area_configs and (time.monotonic() - _area_configs_loaded_at) < 300:
        return _area_configs
    try:
        resp = await _admin_http.get(
            f"{ADMIN_API_URL}/api/v1/llm-agent-configs",
            params={"is_active": "true"},
            timeout=5.0,
        )
        if resp.status_code == 200:
            _area_configs = {c["area_code"]: c["agent_code"] for c in resp.json()}
            _area_configs_loaded_at = time.monotonic()
    except Exception as e:
        logger.warning(f"LLM agent config 조회 실패: {e}")
    return _area_configs


async def get_agent_code_for_area(area_code: str) -> str:
    """업무 영역 코드로 agent_code 반환. 미등록 시 환경변수 폴백."""
    configs = await _load_area_configs()
    return configs.get(area_code, LLM_AGENT_CODE)


async def fetch_system_metrics(system_name: str) -> dict:
    """Prometheus에서 현재 시스템 메트릭 instant 조회. 실패 시 빈 dict 반환."""
    queries = {
        "cpu":     f'avg(cpu_usage_percent{{system_name="{system_name}",core="total"}})',
        "memory":  (
            f'avg(memory_used_bytes{{system_name="{system_name}",type="used"}})'
            f' / avg(memory_used_bytes{{system_name="{system_name}",type="total"}}) * 100'
        ),
        "disk_io": f'avg(disk_io_time_ms{{system_name="{system_name}"}})',
        "net_rx":  (
            f'avg(rate(network_bytes_total{{system_name="{system_name}",direction="rx"}}[5m]))'
            f' / 1048576'
        ),
    }
    result: dict = {}
    for key, promql in queries.items():
        try:
            resp = await _prom_http.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params={"query": promql},
                timeout=5.0,
            )
            data = resp.json().get("data", {}).get("result", [])
            if data:
                result[key] = float(data[0]["value"][1])
        except Exception:
            pass
    return result


async def fetch_logs_for_system(system_name: str) -> dict[str, list[dict]]:
    """
    최근 5분간 log_error_total 증분이 있는 시리즈를 Prometheus에서 조회.
    instance_role별로 그룹화하여 반환.

    synapse_agent가 수집한 log_error_total 메트릭 구조:
      log_error_total{system_name, instance_role, host, log_type, level,
                      service_name, template}

    반환: {instance_role: [{line, instance_role, host, log_type, level, count}]}
    """
    now_ts = int(datetime.now(timezone.utc).timestamp())
    query = f'sum_over_time(log_error_total{{system_name="{system_name}"}}[5m]) > 0'
    params = {"query": query, "time": str(now_ts)}

    data = None
    for attempt in range(1, 4):
        try:
            resp = await _prom_http.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params=params,
            )
            if resp.status_code == 400:
                logger.error(f"Prometheus 쿼리 오류(400) [{system_name}]: {resp.text[:300]}")
                return {}
            resp.raise_for_status()
            data = resp.json()
            break
        except httpx.TimeoutException:
            logger.warning(f"Prometheus 조회 타임아웃 [{system_name}] (시도 {attempt}/3)")
        except httpx.RequestError as e:
            logger.error(f"Prometheus 조회 실패 [{system_name}] (시도 {attempt}/3): {e}")
            if attempt == 3:
                return {}

    if not data:
        return {}

    # instance_role별 그룹화
    by_role: dict[str, list[dict]] = {}
    for series in data.get("data", {}).get("result", []):
        labels = series.get("metric", {})
        instance_role = labels.get("instance_role", "unknown")
        host          = labels.get("host", "unknown")
        log_type      = labels.get("log_type", "app")
        level         = labels.get("level", "ERROR")
        template      = labels.get("template", "")
        count         = float(series.get("value", [0, "0"])[1])

        if not template:
            continue

        # LLM에 전달할 "line": 발생 횟수와 맥락을 포함한 형태로 구성
        line = f"[{count:.0f}x][{level}][{log_type}] {template}"
        by_role.setdefault(instance_role, []).append({
            "line":          line,
            "instance_role": instance_role,
            "host":          host,
            "log_type":      log_type,
            "level":         level,
            "count":         count,
            "template":      template,   # 예외 처리 매칭용 원본 template 라벨
        })

    return by_role


# template 단위 notification 인식(fuzzy tier-2) RRF 임계값 — Qdrant k=2 스케일(상한 1.0).
# 단일 template 질의 시: 동일/근접 변형은 #1(~1.0)~#1+#2(0.833)로 고득점, 신규 패턴은 훨씬 아래.
# 보수적으로 잡아 "잘못 skip(신규 오류 은폐)"보다 "skip 놓침(LLM 1회)"을 택한다. 운영 로그로 보정.
_NOTIF_RECOGNIZE_THRESHOLD = 0.9  # cosine scale (dense 단독, RRF→dense 전환 후)


async def analyze_with_vector_context(
    system_name: str,
    instance_role: str,
    logs: list[dict],
    agent_code: str,
    trace_context: str = "",
    trace_tier: str = "5min",
    skip_vector_store: bool = False,
) -> dict:
    """
    T4.14 — 벡터 유사도 검색 + LLM 분석 통합 파이프라인

    처리 순서:
      1. 로그 정규화 및 압축
      2. FastEmbed 인프로세스 임베딩 (Dense bge-m3 + Sparse BM25, ADR-011)
      3. Qdrant Hybrid 유사 이력 검색 (RRF fusion — duplicate/recurring/related/new)
      4. 강화 프롬프트 구성 + LLM 호출 (duplicate 포함 전 케이스에서 호출)
      5. 분석 결과 Qdrant에 Dense+Sparse로 저장
    """
    # trace context 로컬 바인딩 (build_enhanced_prompt에 주입)
    _trace_context = trace_context
    _trace_tier = trace_tier

    # 1. 로그 정규화 및 압축 (log_type 비율 보장 샘플링 → 섹션 구조화)
    sampled_logs = _sample_logs_by_type(logs)
    log_text     = mask_sensitive_data(_format_logs_by_type(sampled_logs))
    normalized = normalize_log_for_embedding(log_text)

    # 2. 임베딩 생성 + 메트릭 조회 병렬 (FastEmbed ONNX — Dense bge-m3 + Sparse BM25)
    dense_vec = None
    sparse_vec = None
    metric_snapshot: dict = {}
    try:
        results = await asyncio.gather(
            get_embedding(normalized),
            get_sparse_vector(normalized),
            fetch_system_metrics(system_name),
            return_exceptions=True,
        )
        if not isinstance(results[0], Exception):
            dense_vec = results[0]
        if not isinstance(results[1], Exception):
            sparse_vec = results[1]
        if not isinstance(results[2], Exception):
            metric_snapshot = results[2]
        if isinstance(results[0], Exception) or isinstance(results[1], Exception):
            logger.warning(
                f"임베딩 생성 실패: → 벡터 검색 없이 분석 진행"
            )
    except Exception as e:
        logger.warning(
            f"임베딩/메트릭 조회 실패: {type(e).__name__}: {e!r} → 벡터 검색 없이 분석 진행"
        )

    # 3. 유사 이력 Hybrid 검색 (Dense + Sparse RRF)
    similar_all: list[dict] = []
    anomaly_info: dict = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}
    if dense_vec and sparse_vec:
        try:
            similar_all  = await search_similar_incidents(dense_vec, sparse_vec, system_name)
            anomaly_info = classify_anomaly(similar_all)
        except Exception as e:
            logger.warning(
                f"Qdrant 검색 실패: {type(e).__name__}: {e!r} → 신규 이상으로 처리"
            )

    # notification auto-skip 은 _analyze_one_role 의 template 단위 인식(recognize_templates)으로
    # 상향 이동됨. 여기서는 배치 전체 임베딩으로 skip 판정하지 않는다 (혼합 배치 over-skip 방지).

    if anomaly_info["type"] == "duplicate":
        # 중복 패턴이어도 LLM 분석은 매번 수행한다 (재분석 비용 < 빈 root_cause 로 인한
        # UX 저하·해결책 재현 실패 위험). anomaly_type 만 "duplicate"로 남겨 UI/Teams가
        # 중복 뱃지를 달고 기존 해결책을 제안할 수 있게 한다.
        logger.info(
            f"{system_name}/{instance_role}: 중복 이상 감지 "
            f"(score={anomaly_info['score']:.2f}) → LLM 재분석 진행"
        )

    # 4. Wave 1B: postmortem 병렬 조회 → 강화 프롬프트 구성 + LLM 호출
    # trace_context / trace_tier는 run_analysis()에서 주입 (OTel 미적용 시 기본값 유지)
    top_results = anomaly_info.get("top_results", [])
    incident_ids = [
        r["payload"].get("incident_id")
        for r in top_results
        if r["payload"].get("incident_id") is not None
    ]

    postmortems: list[dict] = []
    if incident_ids:
        try:
            pm_results = await asyncio.gather(
                *[get_postmortem_by_incident(iid) for iid in incident_ids],
                return_exceptions=True,
            )
            postmortems = [pm for pm in pm_results if isinstance(pm, dict) and pm]
        except Exception as e:
            logger.warning("postmortem 병렬 조회 실패: %s — 해결책 섹션 폴백", e)

    # postmortem 기반 has_solution 재산정
    has_solution = (
        any(pm.get("solution") for pm in postmortems)
        if postmortems
        else anomaly_info["has_solution"]
    )

    prompt   = build_enhanced_prompt(
        log_text, system_name, instance_role, anomaly_info,
        trace_context=_trace_context,
        trace_tier=_trace_tier,
        postmortems=postmortems if postmortems else None,
        metric_snapshot=metric_snapshot if metric_snapshot else None,
    )

    # LLM 호출 — 실패해도 벡터 저장은 진행 (패턴 누적 목적)
    analysis: dict = {}
    llm_error: str | None = None
    try:
        analysis = await call_llm_structured(prompt, agent_code=agent_code)
    except Exception as e:
        llm_error = f"{type(e).__name__}: {str(e)[:300]}"
        logger.warning(f"[{system_name}/{instance_role}] LLM 분석 실패 — 벡터 저장은 계속: {llm_error}")

    # 5. 벡터 저장 (skip_vector_store=True이면 건너뜀 — _analyze_one_role에서 그룹별 저장)
    # LLM 실패 시 is_notification=False(기본값) → notification_auto_skip에 영향 없음
    point_id = None
    qdrant_store_error: str | None = None
    if dense_vec and sparse_vec and not skip_vector_store:
        try:
            point_id = await store_incident_vector(
                dense_vec, sparse_vec, system_name, instance_role,
                analysis.get("severity", "unknown"),
                normalized[:500],
                analysis.get("error_category"),
                root_cause=analysis.get("root_cause"),
                recommendation=analysis.get("recommendation"),
                is_notification=bool(analysis.get("is_notification", False)),
            )
        except Exception as e:
            qdrant_store_error = f"qdrant_store_error: {type(e).__name__}: {e!r}"[:280]
            logger.warning(f"Qdrant 저장 실패: {type(e).__name__}: {e!r}")

    # similar_incidents: Teams 알림용 정형화된 이력 목록
    similar_incidents = [
        {
            "score":       r["score"],
            "log_pattern": r["payload"].get("log_pattern", ""),
            "resolution":  r["payload"].get("resolution"),
        }
        for r in top_results
    ]

    return {
        **analysis,
        "anomaly_type":       anomaly_info["type"],
        "similarity_score":   anomaly_info["score"],
        "qdrant_point_id":    point_id,
        "has_solution":       has_solution,
        "similar_incidents":  similar_incidents,
        "llm_error":          llm_error,          # LLM 호출 실패 사유 (벡터 저장은 완료)
        "qdrant_store_error": qdrant_store_error,  # 값 있으면 벡터 저장 실패
    }


async def submit_analysis(
    system_id: int,
    instance_role: str,
    log_content: str,
    analysis_result: dict,
    severity: str,
    root_cause: str,
    recommendation: str,
    anomaly_type: str | None = None,
    similarity_score: float | None = None,
    qdrant_point_id: str | None = None,
    has_solution: bool | None = None,
    similar_incidents: list[dict] | None = None,
    error_message: str | None = None,
    model_used: str | None = None,
    referenced_trace_ids: list[str] | None = None,
    trace_summary_text: str | None = None,
    templates: list[str] | None = None,
    template_counts: dict[str, int] | None = None,
    real_error_count: int = 0,
    notification_count: int = 0,
    template_classifications_json: str | None = None,
    suppress_teams: bool = False,
) -> dict:
    """Admin API에 LLM 분석 결과 제출 (Teams 알림은 Admin API가 처리)

    real_error_count: 실에러 로그 건수 (알림성 제외).
    notification_count: 알림성 로그 건수.
    template_classifications_json: LLM per-template 분류 JSON (디버깅용).
    suppress_teams: True면 row/point/인시던트는 생성하되 Teams 발송만 억제(Phase C, role 통합 발송용).
    """
    payload: dict = {
        "system_id":          system_id,
        "instance_role":      instance_role,
        "log_content":        log_content,
        "analysis_result":    json.dumps(analysis_result, ensure_ascii=False),
        "severity":           severity,
        "root_cause":         root_cause,
        "recommendation":     recommendation,
        "model_used":         model_used or LLM_TYPE,
        "real_error_count":   real_error_count,
        "notification_count": notification_count,
        "suppress_teams":     suppress_teams,
    }
    # Phase 4b: 벡터 필드 (값이 있을 때만 포함)
    if anomaly_type      is not None: payload["anomaly_type"]      = anomaly_type
    if similarity_score  is not None: payload["similarity_score"]  = similarity_score
    if qdrant_point_id   is not None: payload["qdrant_point_id"]   = qdrant_point_id
    if has_solution      is not None: payload["has_solution"]      = has_solution
    if similar_incidents is not None: payload["similar_incidents"] = similar_incidents
    if error_message          is not None: payload["error_message"]          = error_message
    if referenced_trace_ids   is not None: payload["referenced_trace_ids"]   = referenced_trace_ids
    if trace_summary_text     is not None: payload["trace_summary_text"]     = trace_summary_text
    if templates              is not None: payload["templates"]              = templates
    if template_counts        is not None: payload["template_counts"]        = template_counts
    if template_classifications_json is not None:
        payload["template_classifications_json"] = template_classifications_json

    resp = await _admin_http.post(f"{ADMIN_API_URL}/api/v1/analysis", json=payload)
    resp.raise_for_status()
    return resp.json()


_SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


async def notify_role_batch(
    system_id: int,
    instance_role: str,
    severity: str,
    root_cause: str,
    recommendation: str,
    templates: list[dict],
) -> None:
    """한 role의 실에러 template들을 admin-api로 보내 통합 Teams 카드 1장 발송 (Phase C).

    per-template submit_analysis(suppress_teams=True)가 row/point/인시던트를 이미 생성한 뒤
    호출된다. 실패해도 분석 흐름에 영향 없음(best-effort).
    """
    if not templates:
        return
    try:
        resp = await _admin_http.post(
            f"{ADMIN_API_URL}/api/v1/analysis/notify-role",
            json={
                "system_id": system_id,
                "instance_role": instance_role,
                "severity": severity,
                "root_cause": root_cause,
                "recommendation": recommendation,
                "templates": templates,
                "real_error_count": sum(int(t.get("count", 0)) for t in templates),
            },
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("role 통합 알림 발송 실패 (무시): %s", exc)


async def _recognize_templates(
    system_name: str,
    instance_role: str,
    templates: list[str],
) -> dict[str, dict]:
    """template 단위 notification 인식 (LLM 이전, batch 단위 over-skip 방지의 핵심).

    각 distinct template에 대해:
      - tier-1 (exact): 결정적 point_id 직접 조회 → 있으면 저장된 결정 승계 (임베딩/검색 0회).
      - tier-2 (fuzzy): 미존재 시 임베딩 후 notification 포인트 검색 → 임계값 이상이면 알림성 변형으로 인식.
      - 그 외: 미인식(신규) → LLM 분석 대상.

    반환 {template: {recognized, is_notification, severity, point_exists, occurrence,
                     norm, point_id, dense, sparse}}.
    tier-1 hit은 dense/sparse=None(임베딩 불필요), tier-1 miss는 dense/sparse 계산본 동봉(저장 재사용).
    """
    result: dict[str, dict] = {}
    for t in templates:
        norm = normalize_log_for_embedding(t)
        result[t] = {
            "recognized": False, "is_notification": False, "severity": "info",
            "point_exists": False, "occurrence": 0,
            "norm": norm, "point_id": template_point_id(system_name, instance_role, norm),
            "dense": None, "sparse": None,
        }

    # tier-1 (exact): 전체 distinct의 point를 단일 Qdrant 호출로 조회 (N회 왕복 → 1회)
    pts = await retrieve_points_batch([result[t]["point_id"] for t in templates])
    misses: list[str] = []
    for t in templates:
        pt = pts.get(result[t]["point_id"])
        if pt:
            pl = pt.get("payload", {}) or {}
            result[t]["recognized"] = True
            result[t]["point_exists"] = True
            result[t]["is_notification"] = bool(pl.get("is_notification"))
            result[t]["severity"] = pl.get("severity") or "info"
            result[t]["occurrence"] = int(pl.get("occurrence_count", 1) or 1)
        else:
            misses.append(t)

    # tier-2 fuzzy: tier-1 미스만 임베딩 후 notification 검색 (배치 임베딩으로 분할상환)
    if misses:
        norm_texts = [result[t]["norm"] for t in misses]
        try:
            dense_list = await get_embedding_batch(norm_texts)
        except Exception as e:
            logger.warning("template 인식 임베딩 실패 (fuzzy 생략): %s", e)
            dense_list = [None] * len(misses)
        for t, dvec in zip(misses, dense_list):
            if dvec is None:
                continue
            try:
                svec = await get_sparse_vector(result[t]["norm"])
            except Exception:
                continue
            result[t]["dense"] = dvec
            result[t]["sparse"] = svec
            try:
                hits = await search_notification_incidents(
                    dvec, svec, system_name, score_threshold=_NOTIF_RECOGNIZE_THRESHOLD,
                )
            except Exception as e:
                logger.warning("template notification 검색 실패 (계속): %s", e)
                hits = []
            if hits:
                # 알림성 변형으로 인식 (stored-wins). point_exists=False → 자기 포인트는 신규 저장 대상.
                result[t]["recognized"] = True
                result[t]["is_notification"] = True
                result[t]["severity"] = "info"
    return result


async def _analyze_one_role(
    sem: asyncio.Semaphore,
    system_id: int,
    system_name: str,
    instance_role: str,
    logs: list,
    agent_code: str,
    trace_ctx: str,
    trace_ref_ids: list,
) -> dict:
    """단일 system/instance_role 조합 분析. run_analysis의 gather 태스크 단위.

    혼재 윈도우(알림성 + 실에러): LLM template_classifications 기반으로 분리하여
    각 그룹별 별도 임베딩 + Qdrant 저장 + submit_analysis 호출.
    alert_history 1 row = Qdrant 1 point (1:1 대응 원칙).
    """
    label = f"{system_name}/{instance_role}"

    analysis_templates = list({log.get("template", "") for log in logs if log.get("template")})
    analysis_template_counts: dict[str, int] = {}
    for log in logs:
        tmpl = log.get("template")
        if tmpl:
            analysis_template_counts[tmpl] = analysis_template_counts.get(tmpl, 0) + int(log.get("count", 0))

    full_log = mask_sensitive_data(_format_logs_by_type(logs))

    async with sem:
        try:
            # ── 1. distinct template 단위 그룹화 (정규화 키 — URL/라인번호 변형을 1개로 합침) ──
            by_tmpl: dict[str, dict] = {}
            for lg in logs:
                raw = lg.get("template", "")
                if not raw:
                    continue
                nt = normalize_log_for_embedding(raw)
                d = by_tmpl.setdefault(nt, {
                    "count": 0, "level": lg.get("level", "ERROR"),
                    "log_type": lg.get("log_type", "app"), "logs": [],
                })
                d["count"] += int(lg.get("count", 0))
                d["logs"].append(lg)
            distinct = list(by_tmpl.keys())
            if not distinct:
                return {"status": "no_logs", "label": label}

            # ── 2. 전체 distinct 인식 (배치 tier-1) — 알림성/실에러 분리. 인식은 cap 없이 전량 ──
            recog = await _recognize_templates(system_name, instance_role, distinct)
            recognized_notif = [t for t in distinct
                                if recog[t]["recognized"] and recog[t]["is_notification"]]

            # ── 3. recognized 알림성 영속화(점유 갱신/신규 변형 저장) + 경량 1 레코드(Teams 없음) ──
            if recognized_notif:
                for t in recognized_notif:
                    rc = recog[t]
                    if rc["point_exists"]:
                        await bump_occurrence(rc["point_id"], rc["occurrence"] + 1)
                    elif rc.get("dense") and rc.get("sparse"):
                        # tier-2 fuzzy 인식 변형 → 자기 결정적 포인트 신규 저장(다음 주기 tier-1 hit)
                        try:
                            await store_incident_vector(
                                rc["dense"], rc["sparse"], system_name, instance_role,
                                "info", rc["norm"][:500],
                                is_notification=True, point_key=rc["norm"],
                            )
                        except Exception as e_v:
                            logger.warning(f"[{label}] 알림성 변형 저장 실패 ({t[:40]}): {e_v}")
                await submit_analysis(
                    system_id=system_id,
                    instance_role=instance_role,
                    log_content=mask_sensitive_data(_format_logs_by_type(
                        [lg for t in recognized_notif for lg in by_tmpl[t]["logs"]])),
                    analysis_result={},
                    severity="info",
                    root_cause="",
                    recommendation="",
                    anomaly_type="notification_auto",
                    qdrant_point_id=recog[recognized_notif[0]]["point_id"],
                    templates=recognized_notif or None,
                    notification_count=sum(by_tmpl[t]["count"] for t in recognized_notif),
                )

            # ── 4. 실에러 후보(need_llm)에만 상한 + 백로그 로테이션 (알림성은 위에서 전량 처리됨) ──
            #   - 지난 주기 보류분(여전히 윈도우에 present)을 우선 처리 → 단조 소진(영구 누락 0)
            #   - 그다음 발생횟수 상위 순. 초과분은 드롭이 아니라 백로그로 이월.
            need_llm_all = [t for t in distinct if t not in recognized_notif]
            bkey = f"{system_name}:{instance_role}"
            deferred_first = [t for t in _backlog.get(bkey, []) if t in by_tmpl and t in need_llm_all]
            _seen = set(deferred_first)
            rest = sorted(
                [t for t in need_llm_all if t not in _seen],
                key=lambda t: by_tmpl[t]["count"], reverse=True,
            )
            pending = deferred_first + rest
            if len(pending) > _MAX_TEMPLATES_PER_ROLE:
                need_llm = pending[:_MAX_TEMPLATES_PER_ROLE]
                _backlog[bkey] = pending[_MAX_TEMPLATES_PER_ROLE:]
                logger.warning(
                    f"[{label}] 실에러 후보 {len(pending)}개가 상한({_MAX_TEMPLATES_PER_ROLE}) 초과 "
                    f"→ {len(need_llm)}개 처리, {len(_backlog[bkey])}개 다음 주기 이월(백로그, 무손실)"
                )
            else:
                need_llm = pending
                _backlog.pop(bkey, None)

            # 전부 알림성 인식 → 배치 skip (LLM 호출 없음)
            if not need_llm:
                logger.info(f"[{label}] notification_auto skip (templates={len(recognized_notif)})")
                return {"status": "notification_auto", "label": label}

            # ── 4. LLM 분석 (배치 컨텍스트) — 미인식 template 분류 ─────────────
            analysis = await analyze_with_vector_context(
                system_name, instance_role, logs, agent_code,
                trace_context=trace_ctx, trace_tier="5min", skip_vector_store=True,
            )
            tc_list = analysis.get("template_classifications", []) or []
            llm_notif = {tc["template"] for tc in tc_list if tc.get("is_notification")}
            if not tc_list and analysis.get("is_notification"):
                llm_notif = set(need_llm)  # 폴백: 전체 알림성
            severity = analysis.get("severity", "info")
            root_cause = analysis.get("root_cause", "")
            recommendation = analysis.get("recommendation", "")
            tc_json = json.dumps(tc_list, ensure_ascii=False) if tc_list else None
            llm_err = analysis.get("llm_error") or analysis.get("qdrant_store_error")

            # ── 5. need_llm template 단위 처리 (stored-wins → LLM, 포인트·알림 모두 template 단위) ──
            # Phase C: 실에러는 per-template Teams를 억제(suppress_teams=True)하고 row/point만 만든 뒤,
            # 루프 종료 후 role 단위 통합 카드 1장으로 발송한다.
            n_notif_new = n_real = 0
            real_templates: list[dict] = []
            real_max_sev = "info"
            for t in need_llm:
                rc = recog[t]
                if rc["recognized"]:          # recognized 실에러(recurring) → 저장된 결정 승계
                    is_notif = rc["is_notification"]   # False (알림성은 recognized_notif에서 이미 처리)
                    tmpl_sev = rc["severity"]
                else:                          # 신규 → LLM 분류
                    is_notif = t in llm_notif
                    tmpl_sev = "info" if is_notif else severity

                t_norm = rc["norm"]
                t_text = mask_sensitive_data(_format_logs_by_type(by_tmpl[t]["logs"]))
                t_count = by_tmpl[t]["count"]

                dvec, svec = rc.get("dense"), rc.get("sparse")  # tier-2에서 계산했으면 재사용
                point_id = None
                try:
                    if dvec is None or svec is None:
                        dvec = await get_embedding(t_norm)
                        svec = await get_sparse_vector(t_norm)
                    point_id = await store_incident_vector(
                        dvec, svec, system_name, instance_role,
                        tmpl_sev, t_norm[:500],
                        root_cause=("" if is_notif else root_cause),
                        recommendation=("" if is_notif else recommendation),
                        is_notification=is_notif,
                        point_key=t_norm,
                        occurrence_count=(rc["occurrence"] + 1 if rc["point_exists"] else 1),
                    )
                except Exception as e_s:
                    logger.warning(f"[{label}] template 벡터 저장 실패 ({t[:40]}): {e_s}")

                if is_notif:
                    # 신규 알림성 최초 1회 → Teams (다음 주기부터 tier-1 인식 → notification_auto)
                    n_notif_new += 1
                    await submit_analysis(
                        system_id=system_id, instance_role=instance_role,
                        log_content=t_text,
                        analysis_result={"is_notification": True, "severity": "info"},
                        severity="info", root_cause=root_cause, recommendation="",
                        anomaly_type="notification",
                        qdrant_point_id=point_id,
                        templates=[t], template_counts={t: t_count},
                        real_error_count=0, notification_count=t_count,
                        template_classifications_json=tc_json,
                    )
                else:
                    n_real += 1
                    # Teams는 억제(suppress_teams) — row/point/인시던트는 생성, 발송은 통합 1장으로
                    await submit_analysis(
                        system_id=system_id, instance_role=instance_role,
                        log_content=t_text, analysis_result=analysis,
                        severity=tmpl_sev, root_cause=root_cause, recommendation=recommendation,
                        anomaly_type=analysis.get("anomaly_type"),
                        similarity_score=analysis.get("similarity_score"),
                        qdrant_point_id=point_id,
                        has_solution=analysis.get("has_solution"),
                        similar_incidents=analysis.get("similar_incidents"),
                        error_message=llm_err,
                        referenced_trace_ids=trace_ref_ids or None,
                        trace_summary_text=trace_ctx or None,
                        templates=[t], template_counts={t: t_count},
                        real_error_count=t_count, notification_count=0,
                        template_classifications_json=tc_json,
                        suppress_teams=True,
                    )
                    real_templates.append({"template": t, "count": t_count})
                    if _SEVERITY_RANK.get(tmpl_sev, 0) > _SEVERITY_RANK.get(real_max_sev, 0):
                        real_max_sev = tmpl_sev

            # Phase C: 실에러 있으면 role 단위 통합 Teams 카드 1장 발송 (per-template은 위에서 억제됨)
            if real_templates:
                await notify_role_batch(
                    system_id, instance_role, real_max_sev,
                    root_cause, recommendation, real_templates,
                )

            logger.info(
                f"[{label}] 분析 완료: {severity} [{analysis.get('anomaly_type', 'unknown')}] "
                f"신규실에러={n_real} 신규알림성={n_notif_new} 인식알림성={len(recognized_notif)}"
            )
            return {"status": "analyzed", "label": label}

        except Exception as e:
            logger.error(f"[{label}] 분析 실패: {e}")
            try:
                await submit_analysis(
                    system_id=system_id,
                    instance_role=instance_role,
                    log_content=full_log,
                    analysis_result={"error": str(e)[:500]},
                    severity="warning",
                    root_cause="LLM 분析 실패 — 재시도 필요",
                    recommendation="",
                    error_message=f"{type(e).__name__}: {str(e)[:300]}",
                    templates=analysis_templates or None,
                    template_counts=analysis_template_counts or None,
                )
            except Exception as submit_e:
                logger.error(f"[{label}] 분析 실패 레코드 저장도 실패: {submit_e}")
            return {"status": "error", "label": label}


async def run_analysis() -> dict:
    """전체 활성 시스템 로그 분석 실행 (n8n 트리거 또는 내부 스케줄러 호출)

    results 필드:
      analyzed:  분석 완료 건 (성공)
      skipped:   비활성 시스템 skip 건
      no_logs:   활성 시스템이지만 최근 5분 이상 로그 없음
      errors:    분석 과정 예외 발생 건 (실패 레코드는 DB에 별도 저장됨)
    """
    logger.info("로그 분석 시작")
    results: dict = {"analyzed": 0, "skipped": 0, "no_logs": 0, "notification_auto": 0, "errors": 0, "systems": []}

    # 이번 분석 주기의 활성 예외 규칙 캐시 (300초 주기 1회 조회)

    try:
        systems = await get_systems()
    except Exception as e:
        logger.error(f"시스템 목록 조회 실패: {e}")
        return results

    # OTel gating: has_otel 시스템 set (dashboard API 재사용)
    otel_system_ids: set[int] = set()
    try:
        async with httpx.AsyncClient(timeout=5.0) as hc:
            health_resp = await hc.get(
                f"{ADMIN_API_URL}/api/v1/dashboard/system-health",
                headers={"Authorization": "Bearer internal"},
            )
            if health_resp.status_code == 200:
                for s in health_resp.json().get("systems", []):
                    if s.get("has_otel"):
                        otel_system_ids.add(s["system_id"])
    except Exception as exc:
        logger.debug("OTel system set 조회 실패 (분석 계속): %s", exc)

    # ── 데이터 수집 (순차) + 분석 태스크 구성 ──────────────────────────────
    sem = asyncio.Semaphore(10)
    role_tasks = []

    for system in systems:
        if system.get("status") != "active":
            results["skipped"] += 1
            continue

        system_name = system["system_name"]
        system_id = system["id"]
        has_otel = system_id in otel_system_ids

        try:
            logs_by_role = await fetch_logs_for_system(system_name)
            if not logs_by_role:
                logger.debug(f"[{system_name}] 이상 로그 없음, 스킵")
                results["no_logs"] += 1
                continue

            agent_code = await get_agent_code_for_area("log_analysis")

            trace_ctx = ""
            trace_ref_ids: list[str] = []
            if has_otel:
                import time as _time
                now_ns = int(_time.time() * 1e9)
                start_ns = now_ns - 5 * 60 * 1_000_000_000
                try:
                    trace_ctx, trace_ref_ids = await build_trace_context(
                        system_name, start_ns, now_ns, tier="5min"
                    )
                except Exception as exc:
                    logger.debug("trace_context 조회 실패 → fallback: %s", exc)

            for instance_role, logs in logs_by_role.items():
                role_tasks.append(
                    _analyze_one_role(
                        sem, system_id, system_name, instance_role, logs,
                        agent_code, trace_ctx, list(trace_ref_ids),
                    )
                )

        except Exception as e:
            logger.error(f"[{system_name}] 데이터 수집 중 오류: {e}")
            results["errors"] += 1

    # ── LLM 분석 병렬 실행 (Semaphore(10) 동시 상한) ──────────────────────
    if role_tasks:
        task_results = await asyncio.gather(*role_tasks, return_exceptions=True)
        for r in task_results:
            if isinstance(r, Exception):
                logger.error(f"분석 태스크 예외: {r}")
                results["errors"] += 1
            else:
                status = r.get("status", "error")
                results[status] = results.get(status, 0) + 1
                if status == "analyzed":
                    results["systems"].append(r["label"])

    logger.info(f"로그 분석 완료: {results}")
    return results
