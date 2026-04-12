"""
Synapse Log Analyzer — 핵심 분석 로직

흐름:
  1. Admin API에서 활성 시스템 목록 조회
  2. 시스템별 Prometheus에서 최근 5분 log_error_total 메트릭 조회
  3. instance_role별 그룹화
  4. 담당자별 LLM API key / agent_code 조회 후 DevX API 호출
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
    normalize_log_for_embedding,
    search_similar_incidents,
    store_incident_vector,
)

from llm_client import call_llm_structured, LLM_API_KEY, LLM_AGENT_CODE

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

응답 형식:
{{"severity": "critical 또는 warning 또는 info", "root_cause": "오류의 근본 원인 (한국어, 1~2문장)", "recommendation": "해결 방법 및 권고사항 (한국어, 구체적으로)"}}"""




def mask_sensitive_data(text: str) -> str:
    """PII 및 결제정보 마스킹 처리"""
    text = re.sub(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '****-****-****-****', text)  # 카드번호
    text = re.sub(r'\b\d{6}[-\s]?\d{7}\b', '******-*******', text)                              # 주민등록번호
    text = re.sub(r'\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b', '010-****-****', text)               # 전화번호
    text = re.sub(r'[\w.-]+@[\w.-]+\.\w+', '***@***.***', text)                                 # 이메일
    return text


async def get_systems() -> list[dict]:
    """Admin API에서 활성 시스템 목록 조회"""
    resp = await _admin_http.get(f"{ADMIN_API_URL}/api/v1/systems")
    resp.raise_for_status()
    return resp.json()


async def get_llm_config_for_system(system_name: str) -> tuple[str, str]:
    """
    시스템의 primary 담당자 LLM 설정 조회.
    반환: (api_key, agent_code)

    1순위: contacts의 llm_api_key / agent_code (담당자 등록 값)
    2순위: 환경변수 LLM_API_KEY / LLM_AGENT_CODE (공용 기본값)
    """
    try:
        resp = await _admin_http.get(
            f"{ADMIN_API_URL}/api/v1/systems/name/{system_name}/contacts",
            timeout=5.0,
        )
        if resp.status_code == 200:
            for contact in resp.json():
                if contact.get("role") == "primary":
                    api_key = contact.get("llm_api_key") or LLM_API_KEY
                    agent_code = contact.get("agent_code") or LLM_AGENT_CODE
                    return api_key, agent_code
    except Exception as e:
        logger.warning(f"LLM 설정 조회 실패 ({system_name}): {e}")
    return LLM_API_KEY, LLM_AGENT_CODE


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
    api_key: str,
    agent_code: str,
) -> dict:
    """
    T4.14 — 벡터 유사도 검색 + LLM 분석 통합 파이프라인

    처리 순서:
      1. 로그 정규화 및 압축
      2. Ollama 임베딩 생성 (Server B)
      3. Qdrant 유사 이력 검색
      4. duplicate 판정 시 알림 억제 (조기 반환)
      5. 강화 프롬프트 구성 + LLM 호출
      6. 분석 결과 Qdrant 저장
    """
    # 1. 로그 정규화 및 압축
    log_text   = mask_sensitive_data("\n".join(entry["line"] for entry in logs[:50]))
    normalized = normalize_log_for_embedding(log_text)

    # 2. 임베딩 생성 (Server B Ollama)
    embedding = None
    try:
        embedding = await get_embedding(normalized)
    except Exception as e:
        logger.warning(f"임베딩 생성 실패: {e} → 벡터 검색 없이 분석 진행")

    # 3. 유사 이력 검색
    anomaly_info: dict = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}
    if embedding:
        try:
            similar      = await search_similar_incidents(embedding, system_name)
            anomaly_info = classify_anomaly(similar)
        except Exception as e:
            logger.warning(f"Qdrant 검색 실패: {e} → 신규 이상으로 처리")

    # 4. duplicate면 LLM 호출 없이 이전 분석 결과 재활용하여 알림 발송
    if anomaly_info["type"] == "duplicate":
        logger.info(f"{system_name}/{instance_role}: 중복 이상 감지 (score={anomaly_info['score']:.2f}) → 중복 알림 발송")
        top_payload = anomaly_info.get("top_results", [{}])[0].get("payload", {}) if anomaly_info.get("top_results") else {}
        similar_incidents = [
            {
                "score":       r["score"],
                "log_pattern": r["payload"].get("log_pattern", ""),
                "resolution":  r["payload"].get("resolution"),
            }
            for r in anomaly_info.get("top_results", [])
        ]
        return {
            "severity":          "info",
            "root_cause":        "중복 이상 감지 — 이전에 동일한 패턴의 이상이 발생하였습니다.",
            "recommendation":    top_payload.get("resolution") or "이전 분석 결과를 참고하세요.",
            "anomaly_type":      "duplicate",
            "similarity_score":  anomaly_info["score"],
            "qdrant_point_id":   None,
            "has_solution":      anomaly_info["has_solution"],
            "similar_incidents": similar_incidents,
        }

    # 5. 강화 프롬프트 구성 + LLM 호출
    prompt   = build_enhanced_prompt(log_text, system_name, instance_role, anomaly_info)
    analysis = await call_llm_structured(prompt, api_key, agent_code)

    # 6. 벡터 저장 (새로운 분석 결과 누적)
    point_id = None
    if embedding:
        try:
            point_id = await store_incident_vector(
                embedding, system_name, instance_role,
                analysis.get("severity", "unknown"),
                normalized[:500],
                analysis.get("error_category"),
            )
        except Exception as e:
            logger.warning(f"Qdrant 저장 실패: {e}")

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
) -> dict:
    """Admin API에 LLM 분석 결과 제출 (Teams 알림은 Admin API가 처리)"""
    payload: dict = {
        "system_id":       system_id,
        "instance_role":   instance_role,
        "log_content":     log_content[:10000],  # DB 저장 크기 제한
        "analysis_result": json.dumps(analysis_result, ensure_ascii=False),
        "severity":        severity,
        "root_cause":      root_cause,
        "recommendation":  recommendation,
    }
    # Phase 4b: 벡터 필드 (값이 있을 때만 포함)
    if anomaly_type      is not None: payload["anomaly_type"]      = anomaly_type
    if similarity_score  is not None: payload["similarity_score"]  = similarity_score
    if qdrant_point_id   is not None: payload["qdrant_point_id"]   = qdrant_point_id
    if has_solution      is not None: payload["has_solution"]      = has_solution
    if similar_incidents is not None: payload["similar_incidents"] = similar_incidents

    resp = await _admin_http.post(f"{ADMIN_API_URL}/api/v1/analysis", json=payload)
    resp.raise_for_status()
    return resp.json()


async def run_analysis() -> dict:
    """전체 활성 시스템 로그 분석 실행 (n8n 트리거 또는 내부 스케줄러 호출)"""
    logger.info("로그 분석 시작")
    results: dict = {"analyzed": 0, "skipped": 0, "errors": 0, "systems": []}

    try:
        systems = await get_systems()
    except Exception as e:
        logger.error(f"시스템 목록 조회 실패: {e}")
        return results

    for system in systems:
        if system.get("status") != "active":
            results["skipped"] += 1
            continue

        system_name = system["system_name"]
        system_id = system["id"]

        try:
            logs_by_role = await fetch_logs_for_system(system_name)
            if not logs_by_role:
                logger.debug(f"[{system_name}] 이상 로그 없음, 스킵")
                results["skipped"] += 1
                continue

            api_key, agent_code = await get_llm_config_for_system(system_name)

            for instance_role, logs in logs_by_role.items():
                try:
                    analysis = await analyze_with_vector_context(
                        system_name, instance_role, logs, api_key, agent_code
                    )

                    severity       = analysis.get("severity", "info")
                    root_cause     = analysis.get("root_cause", "")
                    recommendation = analysis.get("recommendation", "")

                    masked_log = mask_sensitive_data(
                        "\n".join(entry["line"] for entry in logs[:50])
                    )
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

        except Exception as e:
            logger.error(f"[{system_name}] 처리 중 오류: {e}")
            results["errors"] += 1

    logger.info(f"로그 분석 완료: {results}")
    return results
