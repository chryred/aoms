"""llm_client 테스트 — JSON 파서 + 공개 API(call_llm_structured / call_llm_text) + Strategy 디스패치."""
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

# log-analyzer 루트 디렉터리를 import path에 추가 (서비스가 모듈 패키지화 안 되어 있음)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import llm_client  # noqa: E402
from llm_client import (  # noqa: E402
    DevxStrategy,
    LLMStrategy,
    _build_strategy,
    _parse_json_from_text,
    call_llm_structured,
    call_llm_text,
)


# ── JSON 파서 ──────────────────────────────────────────────────────────────

def test_parse_json_code_fence():
    text = 'Here is the result:\n```json\n{"severity": "critical", "root_cause": "OOM"}\n```\nDone.'
    result = _parse_json_from_text(text)
    assert result == {"severity": "critical", "root_cause": "OOM"}


def test_parse_json_bare():
    text = '{"severity": "warning", "recommendation": "heap 증가"}'
    result = _parse_json_from_text(text)
    assert result["severity"] == "warning"
    assert result["recommendation"] == "heap 증가"


def test_parse_json_prose_wrapped():
    text = (
        '- Main point: 분석 결과는 다음과 같습니다\n'
        '{"severity": "warning", "root_cause": "timeout", "recommendation": "retry"}\n'
        'Sources\n- ref1'
    )
    result = _parse_json_from_text(text)
    assert result == {
        "severity": "warning",
        "root_cause": "timeout",
        "recommendation": "retry",
    }


def test_parse_json_nested_braces():
    text = '{"severity": "critical", "meta": {"model": "devx", "tokens": 100}}'
    result = _parse_json_from_text(text)
    assert result["severity"] == "critical"
    assert result["meta"]["model"] == "devx"
    assert result["meta"]["tokens"] == 100


def test_parse_json_invalid_raises():
    text = "This is just plain prose, no JSON here."
    with pytest.raises(Exception):
        _parse_json_from_text(text)


def test_parse_json_string_with_braces():
    text = 'Output: {"severity": "info", "message": "user said {hello}"}'
    result = _parse_json_from_text(text)
    assert result["message"] == "user said {hello}"


# ── call_llm_structured ────────────────────────────────────────────────────

async def test_structured_returns_parsed_dict(monkeypatch):
    mock = AsyncMock(return_value='{"severity": "warning", "root_cause": "x"}')
    monkeypatch.setattr(llm_client._strategy, "call", mock)
    result = await call_llm_structured("p")
    assert result == {"severity": "warning", "root_cause": "x"}


async def test_structured_raises_on_empty_response(monkeypatch):
    monkeypatch.setattr(llm_client._strategy, "call", AsyncMock(return_value=""))
    with pytest.raises(ValueError, match="비어"):
        await call_llm_structured("p")


async def test_structured_raises_with_snippet_on_invalid_json(monkeypatch):
    monkeypatch.setattr(
        llm_client._strategy, "call",
        AsyncMock(return_value="plain prose without json"),
    )
    with pytest.raises(ValueError) as exc_info:
        await call_llm_structured("p")
    assert "plain prose" in str(exc_info.value)
    assert "파싱 실패" in str(exc_info.value)


async def test_structured_passes_override_keys(monkeypatch):
    mock = AsyncMock(return_value='{"ok": true}')
    monkeypatch.setattr(llm_client._strategy, "call", mock)
    await call_llm_structured("prompt-x", api_key="k1", agent_code="c1")
    mock.assert_awaited_once()
    _, kwargs = mock.call_args
    assert kwargs["api_key"] == "k1"
    assert kwargs["agent_code"] == "c1"


# ── call_llm_text ──────────────────────────────────────────────────────────

async def test_text_returns_str_on_success(monkeypatch):
    monkeypatch.setattr(
        llm_client._strategy, "call", AsyncMock(return_value="요약 결과"),
    )
    result = await call_llm_text("p")
    assert result == "요약 결과"


async def test_text_returns_none_on_empty(monkeypatch):
    monkeypatch.setattr(llm_client._strategy, "call", AsyncMock(return_value=""))
    result = await call_llm_text("p")
    assert result is None


async def test_text_returns_none_on_exception(monkeypatch):
    monkeypatch.setattr(
        llm_client._strategy, "call",
        AsyncMock(side_effect=httpx.TimeoutException("timeout")),
    )
    result = await call_llm_text("p")
    assert result is None


async def test_text_passes_max_tokens(monkeypatch):
    mock = AsyncMock(return_value="ok")
    monkeypatch.setattr(llm_client._strategy, "call", mock)
    await call_llm_text("p", max_tokens=777, api_key="kX", agent_code="cX")
    _, kwargs = mock.call_args
    assert kwargs["max_tokens"] == 777
    assert kwargs["api_key"] == "kX"
    assert kwargs["agent_code"] == "cX"


# ── Strategy 디스패치 ──────────────────────────────────────────────────────

def test_build_strategy_known_types():
    assert set(llm_client._STRATEGIES.keys()) >= {"devx", "claude", "openai"}
    for cls in llm_client._STRATEGIES.values():
        assert issubclass(cls, LLMStrategy)


def test_build_strategy_unknown_falls_back_to_devx(monkeypatch):
    monkeypatch.setattr(llm_client, "LLM_TYPE", "bogus-provider")
    strategy = _build_strategy()
    assert isinstance(strategy, DevxStrategy)
