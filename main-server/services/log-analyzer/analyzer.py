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

import json
import logging
import os
import re
from datetime import datetime, timezone

import httpx

from vector_client import (
    build_enhanced_prompt,
    classify_anomaly,
    get_embedding,
    get_sparse_vector,
    normalize_log_for_embedding,
    search_similar_incidents,
    store_incident_vector,
)

from llm_client import call_llm_structured, LLM_AGENT_CODE, LLM_TYPE
from trace_summarizer import build_trace_context

logger = logging.getLogger(__name__)

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
ADMIN_API_URL  = os.getenv("ADMIN_API_URL",  "http://admin-api:8080")

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

응답 형식:
{{"severity": "critical 또는 warning 또는 info", "root_cause": "원인 요약\\n근거/세부 설명", "recommendation": "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ..."}}"""




def mask_sensitive_data(text: str) -> str:
    """PII 및 결제정보 마스킹 처리"""
    text = re.sub(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '****-****-****-****', text)  # 카드번호
    text = re.sub(r'\b\d{6}[-\s]?\d{7}\b', '******-*******', text)                              # 주민등록번호
    text = re.sub(r'\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b', '010-****-****', text)               # 전화번호
    text = re.sub(r'[\w.-]+@[\w.-]+\.\w+', '***@***.***', text)                                 # 이메일
    return text


def _sample_logs_by_type(logs: list[dict], max_count: int = 50) -> list[dict]:
    """log_type 비율 보장 샘플링. 전체 ≤ max_count면 전부 반환."""
    if len(logs) <= max_count:
        return logs
    by_type: dict[str, list[dict]] = {}
    for entry in logs:
        by_type.setdefault(entry.get("log_type", "app"), []).append(entry)
    # 발생 횟수(count) 합계 내림차순으로 log_type 정렬
    sorted_types = sorted(
        by_type.items(),
        key=lambda x: -sum(e["count"] for e in x[1]),
    )
    total = len(logs)
    sampled: list[dict] = []
    remaining = max_count
    for i, (_, type_logs) in enumerate(sorted_types):
        if i == len(sorted_types) - 1:
            alloc = remaining
        else:
            alloc = max(1, round(len(type_logs) / total * max_count))
            alloc = min(alloc, remaining)
        sampled.extend(type_logs[:alloc])
        remaining -= alloc
        if remaining <= 0:
            break
    return sampled


def _format_logs_by_type(logs: list[dict]) -> str:
    """log_type별 섹션으로 분리. 단일 타입이면 헤더 없이 단순 나열."""
    by_type: dict[str, list[dict]] = {}
    for entry in logs:
        by_type.setdefault(entry.get("log_type", "app"), []).append(entry)
    if len(by_type) == 1:
        return "\n".join(entry["line"] for entry in logs)
    lines: list[str] = []
    for log_type, type_logs in sorted(by_type.items(), key=lambda x: -len(x[1])):
        lines.append(f"[{log_type}] {len(type_logs)}건")
        lines.append("─" * 20)
        lines.extend(entry["line"] for entry in type_logs)
        lines.append("")
    return "\n".join(lines).strip()


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
        })

    return by_role


async def analyze_with_vector_context(
    system_name: str,
    instance_role: str,
    logs: list[dict],
    agent_code: str,
    trace_context: str = "",
    trace_tier: str = "5min",
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

    # 2. 임베딩 생성 (FastEmbed ONNX — Dense bge-m3 + Sparse BM25)
    dense_vec = None
    sparse_vec = None
    try:
        dense_vec  = await get_embedding(normalized)
        sparse_vec = await get_sparse_vector(normalized)
    except Exception as e:
        logger.warning(
            f"임베딩 생성 실패: {type(e).__name__}: {e!r} → 벡터 검색 없이 분석 진행"
        )

    # 3. 유사 이력 Hybrid 검색 (Dense + Sparse RRF)
    anomaly_info: dict = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}
    if dense_vec and sparse_vec:
        try:
            similar      = await search_similar_incidents(dense_vec, sparse_vec, system_name)
            anomaly_info = classify_anomaly(similar)
        except Exception as e:
            logger.warning(
                f"Qdrant 검색 실패: {type(e).__name__}: {e!r} → 신규 이상으로 처리"
            )

    if anomaly_info["type"] == "duplicate":
        # 중복 패턴이어도 LLM 분석은 매번 수행한다 (재분석 비용 < 빈 root_cause 로 인한
        # UX 저하·해결책 재현 실패 위험). anomaly_type 만 "duplicate"로 남겨 UI/Teams가
        # 중복 뱃지를 달고 기존 해결책을 제안할 수 있게 한다.
        logger.info(
            f"{system_name}/{instance_role}: 중복 이상 감지 "
            f"(score={anomaly_info['score']:.2f}) → LLM 재분석 진행"
        )

    # 4. 강화 프롬프트 구성 + LLM 호출
    # trace_context / trace_tier는 run_analysis()에서 주입 (OTel 미적용 시 기본값 유지)
    prompt   = build_enhanced_prompt(
        log_text, system_name, instance_role, anomaly_info,
        trace_context=_trace_context,
        trace_tier=_trace_tier,
    )
    analysis = await call_llm_structured(prompt, agent_code=agent_code)

    # 5. 벡터 저장 (새로운 분석 결과 누적 — duplicate 포함, Dense+Sparse)
    point_id = None
    qdrant_store_error: str | None = None
    if dense_vec and sparse_vec:
        try:
            point_id = await store_incident_vector(
                dense_vec, sparse_vec, system_name, instance_role,
                analysis.get("severity", "unknown"),
                normalized[:500],
                analysis.get("error_category"),
                root_cause=analysis.get("root_cause"),
                recommendation=analysis.get("recommendation"),
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
        for r in anomaly_info.get("top_results", [])
    ]

    return {
        **analysis,
        "anomaly_type":       anomaly_info["type"],
        "similarity_score":   anomaly_info["score"],
        "qdrant_point_id":    point_id,
        "has_solution":       anomaly_info["has_solution"],
        "similar_incidents":  similar_incidents,
        "qdrant_store_error": qdrant_store_error,  # 값 있으면 LLM 성공했으나 벡터 저장 실패
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
) -> dict:
    """Admin API에 LLM 분석 결과 제출 (Teams 알림은 Admin API가 처리)

    error_message: LLM/분석 실패 사유. 값이 있으면 admin-api에서 Teams 미발송 + UI 분석 실패 뱃지.
    model_used: LLM 프로바이더 코드 (devx/claude/openai). 미지정 시 LLM_TYPE 기본값. (ADR-012: ollama 제거)
    """
    payload: dict = {
        "system_id":       system_id,
        "instance_role":   instance_role,
        "log_content":     log_content[:10000],  # DB 저장 크기 제한
        "analysis_result": json.dumps(analysis_result, ensure_ascii=False),
        "severity":        severity,
        "root_cause":      root_cause,
        "recommendation":  recommendation,
        "model_used":      model_used or LLM_TYPE,
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

    resp = await _admin_http.post(f"{ADMIN_API_URL}/api/v1/analysis", json=payload)
    resp.raise_for_status()
    return resp.json()


async def run_analysis() -> dict:
    """전체 활성 시스템 로그 분석 실행 (n8n 트리거 또는 내부 스케줄러 호출)

    results 필드:
      analyzed: 분석 완료 건 (성공)
      skipped : 비활성 시스템 skip 건
      no_logs : 활성 시스템이지만 최근 5분 이상 로그 없음
      errors  : 분석 과정 예외 발생 건 (실패 레코드는 DB에 별도 저장됨)
    """
    logger.info("로그 분석 시작")
    results: dict = {"analyzed": 0, "skipped": 0, "no_logs": 0, "errors": 0, "systems": []}

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

            # OTel gating: trace_context 조회 (5분 window)
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
                # masked_log는 성공/실패 두 경로 모두에서 필요 → try 진입 전 구성
                masked_log = mask_sensitive_data(
                    _format_logs_by_type(_sample_logs_by_type(logs))
                )
                try:
                    analysis = await analyze_with_vector_context(
                        system_name, instance_role, logs, agent_code,
                        trace_context=trace_ctx,
                        trace_tier="5min",
                    )

                    severity       = analysis.get("severity", "info")
                    root_cause     = analysis.get("root_cause", "")
                    recommendation = analysis.get("recommendation", "")

                    await submit_analysis(
                        system_id=system_id,
                        instance_role=instance_role,
                        log_content=masked_log,
                        analysis_result=analysis,
                        severity=severity,
                        root_cause=root_cause,
                        recommendation=recommendation,
                        anomaly_type=analysis.get("anomaly_type"),
                        similarity_score=analysis.get("similarity_score"),
                        qdrant_point_id=analysis.get("qdrant_point_id"),
                        has_solution=analysis.get("has_solution"),
                        similar_incidents=analysis.get("similar_incidents"),
                        # LLM은 성공했으나 Qdrant 저장만 실패한 경우 사유 기록
                        error_message=analysis.get("qdrant_store_error"),
                        referenced_trace_ids=trace_ref_ids or None,
                        trace_summary_text=trace_ctx or None,
                    )
                    results["analyzed"] += 1
                    results["systems"].append(f"{system_name}/{instance_role}")
                    logger.info(
                        f"[{system_name}/{instance_role}] 분석 완료: {severity} "
                        f"[{analysis.get('anomaly_type', 'unknown')}]"
                    )

                except Exception as e:
                    logger.error(f"[{system_name}/{instance_role}] 분석 실패: {e}")
                    results["errors"] += 1
                    # 실패 이력을 DB에 저장 (피드백 관리 화면에서 "분석 실패" 뱃지로 노출)
                    try:
                        await submit_analysis(
                            system_id=system_id,
                            instance_role=instance_role,
                            log_content=masked_log,
                            analysis_result={"error": str(e)[:500]},
                            severity="warning",
                            root_cause="LLM 분석 실패 — 재시도 필요",
                            recommendation="",
                            error_message=f"{type(e).__name__}: {str(e)[:300]}",
                        )
                    except Exception as submit_e:
                        logger.error(
                            f"[{system_name}/{instance_role}] 분석 실패 레코드 저장도 실패: {submit_e}"
                        )

        except Exception as e:
            logger.error(f"[{system_name}] 처리 중 오류: {e}")
            results["errors"] += 1

    logger.info(f"로그 분석 완료: {results}")
    return results
