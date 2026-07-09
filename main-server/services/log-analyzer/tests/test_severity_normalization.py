"""severity 정규화 회귀 테스트.

LLM이 프롬프트 열거형(info/warning/critical)을 벗어난 값("error" 등)을 반환하면
검증 없이 Qdrant payload → stored-wins 승계 → alert_history까지 전파되어
UI에 "error" 원문 표기 + Teams 발송 조건(warning/critical) 누락이 발생했다.
normalize_severity가 유입 지점(LLM 응답)과 승계 지점(_recognize_templates)에서
허용값 밖 severity를 정규화하는지 검증한다.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analyzer  # noqa: E402


# ── normalize_severity 단위 ───────────────────────────────────────────────────

def test_allowed_values_pass_through():
    assert analyzer.normalize_severity("info") == "info"
    assert analyzer.normalize_severity("warning") == "warning"
    assert analyzer.normalize_severity("critical") == "critical"


def test_error_maps_to_warning():
    # LLM이 ERROR 레벨 로그를 보고 "error"를 반환하는 대표 케이스
    assert analyzer.normalize_severity("error") == "warning"


def test_case_insensitive():
    assert analyzer.normalize_severity("ERROR") == "warning"
    assert analyzer.normalize_severity("Critical") == "critical"


def test_none_and_unknown_fall_back_to_default():
    assert analyzer.normalize_severity(None) == "warning"
    assert analyzer.normalize_severity("높음") == "warning"
    assert analyzer.normalize_severity("unknown", default="info") == "info"


# ── analyze_with_vector_context: LLM 응답 severity 정규화 ─────────────────────

@pytest.mark.asyncio
async def test_avc_normalizes_batch_and_per_template_severity(monkeypatch):
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "fetch_system_metrics", AsyncMock(return_value={}))
    monkeypatch.setattr(analyzer, "search_similar_incidents", AsyncMock(return_value=[]))
    monkeypatch.setattr(analyzer, "classify_anomaly",
                        lambda *a, **k: {"type": "new", "score": 0.0, "has_solution": False, "top_results": []})
    # LLM이 배치/템플릿 모두 열거형 밖 "error"를 반환
    monkeypatch.setattr(analyzer, "call_llm_structured", AsyncMock(return_value={
        "severity": "error",
        "template_classifications": [
            {"index": 0, "is_notification": False, "severity": "error"},
        ],
        "root_cause": "rc", "recommendation": "rec",
    }))

    templates = ["TMPL_REAL"]
    logs = [{"template": "TMPL_REAL", "line": "[1x][ERROR][app] TMPL_REAL", "level": "ERROR",
             "log_type": "app", "count": 1, "host": "h", "instance_role": "was1"}]
    out = await analyzer.analyze_with_vector_context(
        "cxm", "was1", logs, "agent",
        skip_vector_store=True, classify_templates=templates,
    )

    assert out["severity"] == "warning"
    assert out["template_classifications"][0]["severity"] == "warning"


# ── _recognize_templates: 이미 오염된 저장 payload 승계 시 정규화 ───────────────

@pytest.mark.asyncio
async def test_recognize_normalizes_stored_severity(monkeypatch):
    """과거에 severity="error"로 저장된 Qdrant 포인트를 tier-1 승계할 때 정규화 (방어 계층)."""
    async def fake_retrieve(point_ids):
        return {pid: {"payload": {"is_notification": False, "severity": "error",
                                  "occurrence_count": 3}} for pid in point_ids}

    monkeypatch.setattr(analyzer, "retrieve_points_batch", fake_retrieve)

    result = await analyzer._recognize_templates("cxm", "was1", ["TMPL_STORED"])

    assert result["TMPL_STORED"]["recognized"] is True
    assert result["TMPL_STORED"]["severity"] == "warning"
