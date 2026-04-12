"""
LLM 멀티 프로바이더 클라이언트 (Strategy 패턴)

LLM_TYPE 환경변수로 프로바이더를 선택하고, 동일 인터페이스로 호출.
- devx:   운영 내부 LLM API (기존 방식)
- ollama: 로컬 Ollama 서버
- claude: Anthropic Claude Messages API
- openai: OpenAI Chat Completions API
"""

import json
import logging
import os
import re
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger(__name__)

# ── 환경변수 ────────────────────────────────────────────────────────────────

LLM_TYPE       = os.getenv("LLM_TYPE", "devx")
LLM_API_URL    = os.getenv("LLM_API_URL", "")
LLM_API_KEY    = os.getenv("LLM_API_KEY", "")
LLM_AGENT_CODE = os.getenv("LLM_AGENT_CODE", "")
LLM_MODEL      = os.getenv("LLM_MODEL", "")

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
    """운영 내부 DevX API"""

    async def call(self, prompt, *, api_key="", agent_code="", max_tokens=1024):
        key = api_key or LLM_API_KEY
        code = agent_code or LLM_AGENT_CODE
        if not LLM_API_URL:
            logger.warning("LLM_API_URL 미설정 — LLM 호출 생략")
            return ""
        resp = await _http.post(
            LLM_API_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"agent_code": code, "query": prompt, "response_mode": "blocking"},
        )
        resp.raise_for_status()
        raw = resp.json()
        answer = (
            raw.get("external_response", {}).get("dify_response", {}).get("answer")
            or raw.get("answer")
            or ""
        )
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
    """LLM 텍스트 응답에서 JSON 추출 (마크다운 코드블록 처리 포함)"""
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        text = match.group(1)
    return json.loads(text.strip())


# ── 공개 API ────────────────────────────────────────────────────────────────

async def call_llm_structured(
    prompt: str, api_key: str = "", agent_code: str = "",
) -> dict:
    """
    JSON dict 반환 (analyzer.py용 — 로그 분석).
    LLM 응답을 파싱하여 dict로 반환. 실패 시 예외 발생.
    """
    text = await _strategy.call(prompt, api_key=api_key, agent_code=agent_code)
    if not text:
        raise ValueError("LLM 응답이 비어 있음")
    return _parse_json_from_text(text)


async def call_llm_text(
    prompt: str, max_tokens: int = 400,
) -> str | None:
    """
    텍스트 반환 (aggregation_processor.py용 — 집계 분석).
    실패 시 None 반환 (호출 측에서 graceful 처리).
    """
    try:
        text = await _strategy.call(prompt, max_tokens=max_tokens)
        return text or None
    except Exception as exc:
        logger.warning("LLM 호출 실패: %s", exc)
        return None
