"""고카디널리티 무손실 처리 회귀 테스트 (Phase B + 기존 타임아웃).

설계:
- by_tmpl은 정규화 template으로 키잉 → URL/라인번호 변형이 1개로 합쳐짐(1 row=1 point 유지).
- 전체 distinct를 인식(배치) → 알림성(recognized notification)은 cap과 무관하게 전량 싼 경로.
- 실에러 후보(need_llm)에만 per-cycle 상한 적용, 초과분은 드롭이 아니라 in-memory 백로그로 이월.
- 백로그는 다음 주기 우선 처리 → 여러 주기에 걸쳐 영구 누락 0.
- _run_analysis_task는 타임아웃으로 자가복구.
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analyzer  # noqa: E402
import scheduler_tasks  # noqa: E402


def _novel(norm):
    return {
        "recognized": False, "is_notification": False, "severity": "info",
        "point_exists": False, "occurrence": 0,
        "norm": norm, "point_id": f"pid:{norm}", "dense": None, "sparse": None,
    }


def _notif(norm):
    return {
        "recognized": True, "is_notification": True, "severity": "info",
        "point_exists": True, "occurrence": 3,
        "norm": norm, "point_id": f"pid:{norm}", "dense": None, "sparse": None,
    }


def _mk_logs(specs):
    """specs: list of (raw_template, count). line 필드 포함."""
    return [
        {"template": t, "line": f"[{c}x][ERROR][app] {t}", "level": "ERROR",
         "log_type": "app", "count": c, "host": "h", "instance_role": "was1"}
        for t, c in specs
    ]


def _patch_common(monkeypatch, recog_fn):
    monkeypatch.setattr(analyzer, "_recognize_templates", recog_fn)
    monkeypatch.setattr(
        analyzer, "analyze_with_vector_context",
        AsyncMock(return_value={"severity": "warning", "template_classifications": [], "is_notification": False}),
    )
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "store_incident_vector", AsyncMock(return_value="pid"))
    monkeypatch.setattr(analyzer, "bump_occurrence", AsyncMock())
    monkeypatch.setattr(analyzer, "notify_role_batch", AsyncMock())  # Phase C 통합 발송 (HTTP 차단)
    submit = AsyncMock()
    monkeypatch.setattr(analyzer, "submit_analysis", submit)
    return submit


def _real_templates_submitted(submit):
    """submit_analysis 호출 중 실에러(notification_auto/notification 제외)의 templates 집합."""
    out = set()
    for call in submit.call_args_list:
        kw = call.kwargs
        if kw.get("anomaly_type") in ("notification_auto", "notification"):
            continue
        for t in (kw.get("templates") or []):
            out.add(t)
    return out


# ── 정규화 키잉: URL 변형은 1건으로 처리 ──────────────────────────────────────

@pytest.mark.asyncio
async def test_by_tmpl_keyed_by_normalized_collapses_variants(monkeypatch):
    """referer URL만 다른 두 로그는 정규화 키로 합쳐져 실에러 submit 1회."""
    analyzer._backlog.clear()
    logs = _mk_logs([
        ("ERROR [Sso:248] referer = https://x/a?id=1", 5),
        ("ERROR [Sso:248] referer = https://x/b?id=2", 7),
    ])

    async def recog(system_name, instance_role, templates):
        # 전달된 distinct는 정규화된 1개여야 함
        recog.seen = list(templates)
        return {t: _novel(t) for t in templates}

    submit = _patch_common(monkeypatch, recog)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)

    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])

    assert len(recog.seen) == 1                       # 두 변형이 1개로 수렴
    real = _real_templates_submitted(submit)
    assert len(real) == 1                             # 실에러 submit 1건 (159변형→1 원칙)


# ── 알림성은 cap과 무관하게 전량 처리 ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_notifications_excluded_from_cap(monkeypatch):
    """recognized 알림성 다수 + 실에러 소수, cap 작아도 알림성은 전량·실에러만 cap."""
    analyzer._backlog.clear()
    notif_specs = [(f"NOTIF {i}", 100) for i in range(8)]   # 8개 알림성(고빈도)
    real_specs = [("REAL_A", 3), ("REAL_B", 2)]             # 2개 실에러(저빈도)
    logs = _mk_logs(notif_specs + real_specs)

    async def recog(system_name, instance_role, templates):
        out = {}
        for t in templates:
            out[t] = _notif(t) if t.startswith("NOTIF") else _novel(t)
        return out

    submit = _patch_common(monkeypatch, recog)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 1)  # 실에러 cap=1

    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])

    # 알림성 8개는 cap 무관하게 처리 (notification_auto submit 1건에 8개 templates)
    notif_submits = [c for c in submit.call_args_list if c.kwargs.get("anomaly_type") == "notification_auto"]
    assert notif_submits, "알림성 notification_auto submit이 있어야 함"
    assert len(notif_submits[0].kwargs.get("templates") or []) == 8
    # 실에러는 cap=1 → 1개만 이번 주기 처리, 나머지는 백로그
    assert len(_real_templates_submitted(submit)) == 1
    assert analyzer._backlog.get("cxm:was1")            # 1개 이월됨


# ── 백로그 로테이션: 여러 주기에 걸쳐 영구 누락 0 ─────────────────────────────

@pytest.mark.asyncio
async def test_backlog_rotation_no_permanent_loss(monkeypatch):
    """실에러 5종 + cap=2 → 3주기 안에 모든 실에러가 빠짐없이 처리(영구 누락 0)."""
    analyzer._backlog.clear()
    specs = [(f"E{i}", i) for i in range(1, 6)]   # E1..E5, count 1..5
    logs = _mk_logs(specs)

    async def recog(system_name, instance_role, templates):
        return {t: _novel(t) for t in templates}    # 매 주기 전부 신규(보수적 최악)

    submit = _patch_common(monkeypatch, recog)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 2)

    seen = set()
    for _ in range(3):                              # 3주기 (윈도우에 동일 template 지속)
        submit.reset_mock()
        await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])
        seen |= _real_templates_submitted(submit)

    assert seen == {"E1", "E2", "E3", "E4", "E5"}   # 전부 처리됨 — 영구 누락 없음


@pytest.mark.asyncio
async def test_deferred_templates_processed_first_next_cycle(monkeypatch):
    """이번 주기에 보류된 template은 다음 주기에 우선 처리된다(로테이션 보장)."""
    analyzer._backlog.clear()
    specs = [(f"E{i}", i) for i in range(1, 6)]
    logs = _mk_logs(specs)

    async def recog(system_name, instance_role, templates):
        return {t: _novel(t) for t in templates}

    submit = _patch_common(monkeypatch, recog)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 2)

    # 주기1: 상위 count E5,E4 처리, E3,E2,E1 보류
    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])
    assert analyzer._backlog["cxm:was1"] == ["E3", "E2", "E1"]

    # 주기2: 보류분(E3,E2) 우선 처리
    submit.reset_mock()
    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])
    assert _real_templates_submitted(submit) == {"E3", "E2"}


# ── Phase C: 실에러는 per-template Teams 억제 + role 통합 발송 1회 ────────────

@pytest.mark.asyncio
async def test_real_errors_suppress_teams_and_notify_role_once(monkeypatch):
    """실에러 submit은 suppress_teams=True, 루프 후 notify_role_batch 1회(영향 template 동봉)."""
    analyzer._backlog.clear()
    logs = _mk_logs([("REAL_A", 5), ("REAL_B", 3)])

    async def recog(system_name, instance_role, templates):
        return {t: _novel(t) for t in templates}

    submit = _patch_common(monkeypatch, recog)
    notify = AsyncMock()
    monkeypatch.setattr(analyzer, "notify_role_batch", notify)
    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)

    await analyzer._analyze_one_role(asyncio.Semaphore(5), 5, "cxm", "was1", logs, "agent", "", [])

    # 실에러 per-template submit은 모두 suppress_teams=True
    real_calls = [c for c in submit.call_args_list
                  if c.kwargs.get("anomaly_type") not in ("notification_auto", "notification")]
    assert real_calls and all(c.kwargs.get("suppress_teams") is True for c in real_calls)
    # role 통합 발송은 정확히 1회, 영향 template 2종 동봉
    notify.assert_called_once()
    sent_templates = notify.call_args.args[5] if len(notify.call_args.args) > 5 else notify.call_args.kwargs.get("templates")
    assert len(sent_templates) == 2


# ── 기존: 분석 사이클 타임아웃 (파이프라인 자가복구) ──────────────────────────

@pytest.mark.asyncio
async def test_run_analysis_task_times_out_and_resets_running(monkeypatch):
    async def hang():
        await asyncio.sleep(100)

    monkeypatch.setattr(scheduler_tasks.analyzer, "run_analysis", hang)
    monkeypatch.setattr(scheduler_tasks, "ANALYSIS_RUN_TIMEOUT", 0.1)
    monkeypatch.setattr(scheduler_tasks, "_record_run", AsyncMock())
    scheduler_tasks._running = False
    scheduler_tasks._last_run = {"started_at": None, "finished_at": None, "result": None}

    await asyncio.wait_for(scheduler_tasks._run_analysis_task(), timeout=3)

    assert scheduler_tasks._running is False
    assert scheduler_tasks._last_run["finished_at"] is not None
    assert "timeout" in str(scheduler_tasks._last_run["result"]).lower()
