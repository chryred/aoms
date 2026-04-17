# SYNC: keep aligned with main-server/services/admin-api/services/llm_client.py
# (새 프로바이더 추가 또는 파싱 로직 변경 시 양쪽 동시 수정 필요)
"""
LLM 멀티 프로바이더 클라이언트 (Strategy 패턴)

LLM_TYPE 환경변수로 프로바이더를 선택하고, 동일 인터페이스로 호출.
- devx:   DevX OAuth (client_credentials → agent chat)
- ollama: 로컬 Ollama 서버
- claude: Anthropic Claude Messages API
- openai: OpenAI Chat Completions API
"""

import asyncio
import json
import logging
import os
import re
import time
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger(__name__)

# ── 환경변수 ────────────────────────────────────────────────────────────────

LLM_TYPE       = os.getenv("LLM_TYPE", "devx")
LLM_API_URL    = os.getenv("LLM_API_URL", "")
LLM_API_KEY    = os.getenv("LLM_API_KEY", "")          # claude/openai Strategy 용
LLM_AGENT_CODE = os.getenv("LLM_AGENT_CODE", "")       # agent_code 폴백 (area config 미조회 시)
LLM_MODEL      = os.getenv("LLM_MODEL", "")

# DevX OAuth (client_credentials)
DEVX_CLIENT_ID     = os.getenv("DEVX_CLIENT_ID", "")
DEVX_CLIENT_SECRET = os.getenv("DEVX_CLIENT_SECRET", "")
DEVX_TOKEN_URL     = os.getenv("DEVX_TOKEN_URL", "https://devx-gw.shinsegae-inc.com/api/v1/auth/token")
DEVX_CHAT_URL      = os.getenv("DEVX_CHAT_URL", "https://devx-gw.shinsegae-inc.com/api/v1/agent/chat")

# 공용 HTTP 클라이언트
_http = httpx.AsyncClient(timeout=120.0)


# ── Strategy 인터페이스 ─────────────────────────────────────────────────────

class LLMStrategy(ABC):
    @abstractmethod
    async def call(
        self, prompt: str, *,
        api_key: str = "", agent_code: str = "", max_tokens: int = 1024,
    ) -> str:
        """프롬프트를 보내고 텍스트 응답을 반환"""


# ── 구현체 ──────────────────────────────────────────────────────────────────

class DevxStrategy(LLMStrategy):
    """DevX OAuth (client_credentials) → agent chat API"""

    def __init__(self):
        self._token: str = ""
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_token(self) -> str:
        """OAuth access_token 발급/갱신 (double-check lock 패턴)."""
        if self._token and time.monotonic() < self._expires_at:
            return self._token
        async with self._lock:
            if self._token and time.monotonic() < self._expires_at:
                return self._token
            resp = await _http.post(
                DEVX_TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": DEVX_CLIENT_ID,
                    "client_secret": DEVX_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            body = resp.json()
            self._token = body["access_token"]
            expires_in = body.get("expires_in", 3600)
            self._expires_at = time.monotonic() + expires_in - 60  # 만료 60초 전 갱신
            logger.info("DevX OAuth token acquired (expires_in=%s)", expires_in)
            return self._token

    async def call(self, prompt, *, api_key="", agent_code="", max_tokens=1024):
        code = agent_code or LLM_AGENT_CODE
        if not DEVX_CLIENT_ID:
            logger.warning("DEVX_CLIENT_ID 미설정 — LLM 호출 생략")
            return ""
        token = await self._ensure_token()
        # streaming SSE로 호출 후 workflow_finished에서 answer 추출
        answer = ""
        async with _http.stream(
            "POST",
            DEVX_CHAT_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"agent_code": code, "query": prompt, "response_mode": "streaming", "user": "synapse-v"},
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    evt = json.loads(line[5:].strip())
                except (json.JSONDecodeError, ValueError):
                    continue
                event_type = evt.get("event", "")
                if event_type == "workflow_finished":
                    outputs = evt.get("data", {}).get("outputs") or {}
                    answer = outputs.get("answer") or outputs.get("result") or ""
                elif event_type == "message_end":
                    # workflow_finished가 없는 경우 message_end 폴백
                    if not answer:
                        answer = evt.get("answer") or ""
        return answer


class OllamaStrategy(LLMStrategy):
    """로컬 Ollama 서버"""

    async def call(self, prompt, *, api_key="", agent_code="", max_tokens=1024):
        url = LLM_API_URL or "http://localhost:11434"
        model = LLM_MODEL or "llama3"
        resp = await _http.post(
            f"{url}/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"num_predict": max_tokens},
            },
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


class ClaudeStrategy(LLMStrategy):
    """Anthropic Claude Messages API"""

    async def call(self, prompt, *, api_key="", agent_code="", max_tokens=1024):
        key = api_key or LLM_API_KEY
        model = LLM_MODEL or "claude-sonnet-4-20250514"
        resp = await _http.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]


class OpenAIStrategy(LLMStrategy):
    """OpenAI Chat Completions API"""

    async def call(self, prompt, *, api_key="", agent_code="", max_tokens=1024):
        key = api_key or LLM_API_KEY
        model = LLM_MODEL or "gpt-4o-mini"
        resp = await _http.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# ── 전략 선택 ───────────────────────────────────────────────────────────────

_STRATEGIES: dict[str, type[LLMStrategy]] = {
    "devx": DevxStrategy,
    "ollama": OllamaStrategy,
    "claude": ClaudeStrategy,
    "openai": OpenAIStrategy,
}


def _build_strategy() -> LLMStrategy:
    cls = _STRATEGIES.get(LLM_TYPE)
    if cls is None:
        logger.warning("알 수 없는 LLM_TYPE=%s — devx 사용", LLM_TYPE)
        cls = DevxStrategy
    logger.info("LLM 프로바이더: %s (model=%s)", LLM_TYPE, LLM_MODEL or "(기본값)")
    return cls()


_strategy: LLMStrategy = _build_strategy()


# ── JSON 파싱 헬퍼 ──────────────────────────────────────────────────────────

def _parse_json_from_text(text: str) -> dict:
    """
    LLM 텍스트 응답에서 JSON 추출.

    처리 순서 (각 단계 실패 시 다음으로 fallback):
      1) 마크다운 코드블록 ```json {...} ``` 에서 추출
      2) 전체 텍스트를 그대로 json.loads
      3) 중괄호 depth 추적으로 첫 균형 {...} 블록 추출 (prose-wrapped JSON 대응)

    모두 실패하면 마지막 JSONDecodeError 를 re-raise.
    """
    # 1) 코드펜스 우선
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass  # 다음 단계로

    stripped = text.strip()

    # 2) 전체 문자열 시도
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as bare_err:
        last_err = bare_err

    # 3) brace-depth 추적으로 첫 균형 {...} 추출
    start = stripped.find("{")
    if start != -1:
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(stripped)):
            ch = stripped[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(stripped[start:i + 1])
                    except json.JSONDecodeError as inner_err:
                        last_err = inner_err
                        break  # 첫 블록 추출은 했으나 내부가 깨짐
    raise last_err


# ── 공개 API ────────────────────────────────────────────────────────────────

async def call_llm_structured(
    prompt: str, api_key: str = "", agent_code: str = "",
) -> dict:
    """
    JSON dict 반환 (analyzer.py용 — 로그 분석).
    LLM 응답을 파싱하여 dict로 반환. 실패 시 응답 snippet을 포함한 예외 발생.
    """
    text = await _strategy.call(prompt, api_key=api_key, agent_code=agent_code)
    if not text:
        raise ValueError("LLM 응답이 비어 있음")
    try:
        return _parse_json_from_text(text)
    except (ValueError, Exception) as e:
        # JSON 파싱 실패 시 응답 앞부분을 에러에 포함 → 운영 디버깅 용이 (DevX 필터 거절 등 즉시 식별)
        snippet = text[:150].replace("\n", " ")
        raise ValueError(
            f"LLM 응답 JSON 파싱 실패 (응답: {snippet!r})"
        ) from e


async def call_llm_text(
    prompt: str, max_tokens: int = 400,
    api_key: str = "", agent_code: str = "",
) -> str | None:
    """
    텍스트 반환 (aggregation_processor.py / prometheus_analyzer.py용).
    실패 시 None 반환 (호출 측에서 graceful 처리).

    api_key / agent_code: 오버라이드 (미지정 시 환경변수 기본값).
    """
    try:
        text = await _strategy.call(
            prompt, api_key=api_key, agent_code=agent_code, max_tokens=max_tokens,
        )
        return text or None
    except Exception as exc:
        logger.warning("LLM 호출 실패: %s", exc)
        return None
