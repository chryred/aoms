"""
AOMS Log Analyzer — 핵심 분석 로직

흐름:
  1. Admin API에서 활성 시스템 목록 조회
  2. 시스템별 Loki에서 최근 5분 ERROR/WARN/FATAL 로그 수집
  3. instance_role별 그룹화 + PII 마스킹
  4. 담당자별 LLM API key / agent_code 조회 후 DevX API 호출
  5. 분석 결과를 Admin API로 전송 (Teams 알림은 Admin API가 처리)
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

LOKI_URL = os.getenv("LOKI_URL", "http://loki:3100")
LLM_API_URL = os.getenv("LLM_API_URL", "")       # DevX API endpoint
LLM_API_KEY = os.getenv("LLM_API_KEY", "")        # 기본 API key (담당자 미등록 시 사용)
LLM_AGENT_CODE = os.getenv("LLM_AGENT_CODE", "")  # 기본 agent_code (담당자 미등록 시 사용)
ADMIN_API_URL = os.getenv("ADMIN_API_URL", "http://admin-api:8080")

ANALYSIS_QUERY = """다음 서버 로그를 분석하여 반드시 아래 JSON 형식으로만 응답하세요. 추가 설명 없이 JSON만 출력하세요.

시스템명: {system_name}
서버 역할: {instance_role} ({host})
분석 대상 로그 ({count}건):

{log_content}

응답 형식:
{{"severity": "critical 또는 warning 또는 info", "root_cause": "오류의 근본 원인 (한국어, 1~2문장)", "recommendation": "해결 방법 및 권고사항 (한국어, 구체적으로)"}}"""


def _to_loki_ns(dt: datetime) -> str:
    """datetime → Loki 3.x nanosecond 타임스탬프 변환 (정밀도 손실 방지)"""
    return str(int(dt.timestamp()) * 1_000_000_000)


def mask_sensitive_data(text: str) -> str:
    """PII 및 결제정보 마스킹 처리"""
    text = re.sub(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '****-****-****-****', text)  # 카드번호
    text = re.sub(r'\b\d{6}[-\s]?\d{7}\b', '******-*******', text)                              # 주민등록번호
    text = re.sub(r'\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b', '010-****-****', text)               # 전화번호
    text = re.sub(r'[\w.-]+@[\w.-]+\.\w+', '***@***.***', text)                                 # 이메일
    return text


def _parse_llm_response(content: str) -> dict:
    """LLM 응답에서 JSON 파싱 (마크다운 코드블록 처리 포함)"""
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
    if match:
        content = match.group(1)
    return json.loads(content.strip())


async def get_systems() -> list[dict]:
    """Admin API에서 활성 시스템 목록 조회"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems", timeout=10)
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
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/systems/name/{system_name}/contacts",
                timeout=5,
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
    최근 5분간 ERROR/WARN/FATAL 로그 조회 후 instance_role별로 그룹화.

    Loki 3.x API 유의사항:
    - /loki/api/v1/query_range — GET 요청만 사용 (POST 시 400 반환)
    - start/end: nanosecond 정수 문자열
    - direction=forward: 시간순 정렬
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=5)

    query = f'{{system_name="{system_name}"}} |~ "(?i)(error|warn|fatal|exception|critical)"'
    params = {
        "query": query,
        "start": _to_loki_ns(start),
        "end": _to_loki_ns(now),
        "limit": "500",
        "direction": "forward",
    }

    data = None
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{LOKI_URL}/loki/api/v1/query_range",
                    params=params,
                    timeout=30,
                )
            if resp.status_code == 400:
                logger.error(f"Loki 쿼리 오류(400) [{system_name}]: {resp.text[:300]}")
                return {}
            resp.raise_for_status()
            data = resp.json()
            break
        except httpx.TimeoutException:
            logger.warning(f"Loki 조회 타임아웃 [{system_name}] (시도 {attempt}/3)")
        except httpx.RequestError as e:
            logger.error(f"Loki 조회 실패 [{system_name}] (시도 {attempt}/3): {e}")
            if attempt == 3:
                return {}

    if not data:
        return {}

    # instance_role별 그룹화
    by_role: dict[str, list[dict]] = {}
    for stream in data.get("data", {}).get("result", []):
        labels = stream.get("stream", {})
        instance_role = labels.get("instance_role", "unknown")
        host = labels.get("host", "unknown")
        for _ts, line in stream.get("values", []):
            by_role.setdefault(instance_role, []).append({
                "line": line,
                "instance_role": instance_role,
                "host": host,
            })

    return by_role


async def analyze_with_llm(
    system_name: str,
    instance_role: str,
    host: str,
    logs: list[dict],
    api_key: str,
    agent_code: str,
) -> dict:
    """DevX API로 로그 분석 요청 후 결과 반환"""
    log_content = mask_sensitive_data("\n".join(entry["line"] for entry in logs[:50]))

    query = ANALYSIS_QUERY.format(
        system_name=system_name,
        instance_role=instance_role,
        host=host,
        count=len(logs),
        log_content=log_content,
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "agent_code": agent_code,
        "query": query,
        "response_mode": "blocking",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(LLM_API_URL, headers=headers, json=body, timeout=120.0)
        resp.raise_for_status()
        raw_res = resp.json()

    # DevX 응답 구조: external_response.dify_response.answer 또는 answer
    answer = (
        raw_res.get("external_response", {}).get("dify_response", {}).get("answer")
        or raw_res.get("answer")
    )
    if not answer:
        raise ValueError(f"LLM 응답에서 answer 필드를 찾을 수 없음: {list(raw_res.keys())}")

    return _parse_llm_response(answer)


async def submit_analysis(
    system_id: int,
    instance_role: str,
    log_content: str,
    analysis_result: dict,
    severity: str,
    root_cause: str,
    recommendation: str,
) -> dict:
    """Admin API에 LLM 분석 결과 제출 (Teams 알림은 Admin API가 처리)"""
    payload = {
        "system_id": system_id,
        "instance_role": instance_role,
        "log_content": log_content[:10000],  # DB 저장 크기 제한
        "analysis_result": json.dumps(analysis_result, ensure_ascii=False),
        "severity": severity,
        "root_cause": root_cause,
        "recommendation": recommendation,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ADMIN_API_URL}/api/v1/analysis",
            json=payload,
            timeout=10,
        )
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
                host = logs[0]["host"] if logs else "unknown"
                try:
                    analysis = await analyze_with_llm(
                        system_name, instance_role, host, logs, api_key, agent_code
                    )
                    severity = analysis.get("severity", "info")
                    root_cause = analysis.get("root_cause", "")
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
                    )
                    results["analyzed"] += 1
                    results["systems"].append(f"{system_name}/{instance_role}")
                    logger.info(f"[{system_name}/{instance_role}] 분석 완료: {severity}")

                except Exception as e:
                    logger.error(f"[{system_name}/{instance_role}] 분석 실패: {e}")
                    results["errors"] += 1

        except Exception as e:
            logger.error(f"[{system_name}] 처리 중 오류: {e}")
            results["errors"] += 1

    logger.info(f"로그 분석 완료: {results}")
    return results
