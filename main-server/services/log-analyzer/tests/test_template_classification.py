"""per-template LLM 분류 회귀 테스트.

혼재 배치(알림성 + 실에러)에서 LLM이 template별 is_notification/severity를 반환하고,
소비 코드가 그에 따라 알림성/실에러를 분리하는지 검증한다. (배치 verdict 하나로 뭉개지던
버그의 재발 방지 — 최근 3일 template_classifications_json 전량 NULL 이었던 원인)
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analyzer  # noqa: E402
import prompts   # noqa: E402


def _novel(norm):
    return {
        "recognized": False, "is_notification": False, "severity": "info",
        "point_exists": False, "occurrence": 0,
        "norm": norm, "point_id": f"pid:{norm}", "dense": None, "sparse": None,
    }


def _mk_logs(specs):
    return [
        {"template": t, "line": f"[{c}x][ERROR][app] {t}", "level": "ERROR",
         "log_type": "app", "count": c, "host": "h", "instance_role": "was1"}
        for t, c in specs
    ]


# ── build_enhanced_prompt: templates 주면 per-template 스키마/목록 포함 ──────────

def test_prompt_requests_per_template_when_templates_given():
    anomaly = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}
    p = prompts.build_enhanced_prompt(
        "logblob", "cxm", "was1", anomaly,
        templates=["ERR A dump {x=<N>}", "ERR B stacktrace at com.x"],
    )
    assert "template_classifications" in p          # per-template 스키마 요청
    assert "[0]" in p and "[1]" in p                # 번호 목록
    assert "ERR A dump" in p and "ERR B stacktrace" in p


def test_prompt_batch_schema_when_no_templates():
    anomaly = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}
    p = prompts.build_enhanced_prompt("logblob", "cxm", "was1", anomaly)
    assert "template_classifications" not in p      # 레거시 배치 스키마


# ── analyze_with_vector_context: index → template 매핑 + 누락 보수 처리 ──────────

@pytest.mark.asyncio
async def test_avc_remaps_index_to_template(monkeypatch):
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "fetch_system_metrics", AsyncMock(return_value={}))
    monkeypatch.setattr(analyzer, "search_similar_incidents", AsyncMock(return_value=[]))
    monkeypatch.setattr(analyzer, "classify_anomaly",
                        lambda *a, **k: {"type": "new", "score": 0.0, "has_solution": False, "top_results": []})
    # LLM은 index 0,2만 반환 (index 1은 누락 → 보수적으로 tc에서 빠져야 함)
    monkeypatch.setattr(analyzer, "call_llm_structured", AsyncMock(return_value={
        "template_classifications": [
            {"index": 0, "is_notification": True,  "severity": "info"},
            {"index": 2, "is_notification": False, "severity": "warning"},
        ],
        "root_cause": "실에러 원인", "recommendation": "1) ...",
    }))

    templates = ["TMPL_NOTIF", "TMPL_OMITTED", "TMPL_REAL"]
    out = await analyzer.analyze_with_vector_context(
        "cxm", "was1", _mk_logs([(t, 1) for t in templates]), "agent",
        skip_vector_store=True, classify_templates=templates,
    )
    tc = out["template_classifications"]
    by_t = {x["template"]: x for x in tc}
    assert by_t["TMPL_NOTIF"]["is_notification"] is True
    assert by_t["TMPL_REAL"]["is_notification"] is False
    assert "TMPL_OMITTED" not in by_t          # 누락 index → tc 미포함 (소비측 보수적 실에러)


# ── _analyze_one_role: per-template 분류로 알림성/실에러 분리 ────────────────────

@pytest.mark.asyncio
async def test_mixed_batch_split_by_per_template_classification(monkeypatch):
    """혼재 배치: NOTIF는 anomaly_type=notification(실에러 아님), REAL은 실에러로 분리."""
    analyzer._backlog.clear()
    logs = _mk_logs([("NOTIF_DUMP", 5), ("REAL_ERR", 3)])

    async def recog(system_name, instance_role, templates, max_fuzzy=None):
        return {t: _novel(t) for t in templates}   # 전부 신규 → need_llm

    monkeypatch.setattr(analyzer, "_recognize_templates", recog)
    # analyze_with_vector_context가 per-template(template-keyed) 분류 반환하도록 mock
    monkeypatch.setattr(analyzer, "analyze_with_vector_context", AsyncMock(return_value={
        "severity": "warning", "root_cause": "rc", "recommendation": "rec",
        "template_classifications": [
            {"template": "NOTIF_DUMP", "is_notification": True,  "severity": "info"},
            {"template": "REAL_ERR",   "is_notification": False, "severity": "warning"},
        ],
    }))
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "store_incident_vector", AsyncMock(return_value="pid"))
    monkeypatch.setattr(analyzer, "bump_occurrence", AsyncMock())
    monkeypatch.setattr(analyzer, "notify_role_batch", AsyncMock())
    submit = AsyncMock()
    monkeypatch.setattr(analyzer, "submit_analysis", submit)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)

    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])

    calls = {c.kwargs.get("templates", [None])[0]: c.kwargs for c in submit.call_args_list if c.kwargs.get("templates")}
    # NOTIF_DUMP → 알림성 (anomaly_type=notification, real_error_count=0)
    assert calls["NOTIF_DUMP"]["anomaly_type"] == "notification"
    assert calls["NOTIF_DUMP"]["real_error_count"] == 0
    # REAL_ERR → 실에러 (notification 아님, real_error_count>0, suppress_teams)
    assert calls["REAL_ERR"]["anomaly_type"] not in ("notification", "notification_auto")
    assert calls["REAL_ERR"]["real_error_count"] > 0
    assert calls["REAL_ERR"].get("suppress_teams") is True
    # tc_json 이 채워져 저장됨 (이전엔 NULL)
    assert calls["REAL_ERR"].get("template_classifications_json")


@pytest.mark.asyncio
async def test_omitted_template_treated_as_real_error(monkeypatch):
    """LLM이 분류를 누락한 template은 보수적으로 실에러 처리(알림 은폐 방지)."""
    analyzer._backlog.clear()
    logs = _mk_logs([("ONLY_ONE", 2)])

    async def recog(system_name, instance_role, templates, max_fuzzy=None):
        return {t: _novel(t) for t in templates}

    monkeypatch.setattr(analyzer, "_recognize_templates", recog)
    monkeypatch.setattr(analyzer, "analyze_with_vector_context", AsyncMock(return_value={
        "severity": "warning", "root_cause": "rc", "recommendation": "rec",
        "template_classifications": [],   # LLM이 아무것도 분류 못 함
    }))
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "store_incident_vector", AsyncMock(return_value="pid"))
    monkeypatch.setattr(analyzer, "notify_role_batch", AsyncMock())
    submit = AsyncMock()
    monkeypatch.setattr(analyzer, "submit_analysis", submit)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)

    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])

    c = next(c.kwargs for c in submit.call_args_list if c.kwargs.get("templates"))
    assert c["anomaly_type"] not in ("notification", "notification_auto")  # 실에러 처리
    assert c["real_error_count"] > 0
