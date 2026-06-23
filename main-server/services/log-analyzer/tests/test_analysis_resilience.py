"""고카디널리티 시스템이 분석 파이프라인을 멈춰 세우는 회귀 방지 테스트.

배경: cxm(신규 등록 시스템)이 단일 instance_role에 801개 distinct 에러 template을
쏟아내자, _analyze_one_role 한 태스크가 801건을 순차 처리하며 수십 분간 한 사이클을
붙잡았고, _run_analysis_task에 타임아웃이 없어 _running 락이 영구 True가 되어
전 시스템 로그 분석이 멈췄다.

방어:
1. _analyze_one_role: role당 처리 template 수 상한 (발생횟수 상위 N개만).
2. _run_analysis_task: run_analysis()를 wait_for로 감싸 한 사이클이 끝나지 않아도
   _running을 리셋하고 다음 주기에 재시도.
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analyzer  # noqa: E402
import scheduler_tasks  # noqa: E402


# ── 1. role당 template 처리 상한 ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_analyze_one_role_caps_templates_per_cycle(monkeypatch):
    """distinct template이 상한을 초과하면 발생횟수 상위 N개만 처리하고 나머지는 보류."""
    # 60개 distinct template, count = 1..60 (E60이 가장 빈번)
    logs = [
        {"template": f"E{i}", "line": f"[{i}x][ERROR][app] E{i}", "level": "ERROR", "log_type": "app", "count": i, "host": "h", "instance_role": "was1"}
        for i in range(1, 61)
    ]

    captured: dict = {}

    async def fake_recognize(system_name, instance_role, templates):
        captured["templates"] = list(templates)
        return {
            t: {
                "recognized": False, "is_notification": False, "severity": "info",
                "point_exists": False, "occurrence": 0,
                "norm": t, "point_id": "pid", "dense": None, "sparse": None,
            }
            for t in templates
        }

    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)
    monkeypatch.setattr(analyzer, "_recognize_templates", fake_recognize)
    monkeypatch.setattr(
        analyzer, "analyze_with_vector_context",
        AsyncMock(return_value={"severity": "info", "template_classifications": [], "is_notification": False}),
    )
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "store_incident_vector", AsyncMock(return_value="pid"))
    monkeypatch.setattr(analyzer, "submit_analysis", AsyncMock())

    sem = asyncio.Semaphore(10)
    result = await analyzer._analyze_one_role(sem, 5, "cxm", "was1", logs, "agent", "", [])

    assert result["status"] == "analyzed"
    # 60개 → 상위 50개만 _recognize_templates로 전달
    assert len(captured["templates"]) == 50
    # 발생횟수 상위(E60)는 포함, 하위(E1)는 보류(드롭)
    assert "E60" in captured["templates"]
    assert "E1" not in captured["templates"]


@pytest.mark.asyncio
async def test_analyze_one_role_under_cap_processes_all(monkeypatch):
    """상한 이하이면 전량 처리 (기존 동작 회귀 방지)."""
    logs = [
        {"template": f"E{i}", "line": f"[{i}x][ERROR][app] E{i}", "level": "ERROR", "log_type": "app", "count": i, "host": "h", "instance_role": "was1"}
        for i in range(1, 6)
    ]
    captured: dict = {}

    async def fake_recognize(system_name, instance_role, templates):
        captured["templates"] = list(templates)
        return {
            t: {
                "recognized": False, "is_notification": False, "severity": "info",
                "point_exists": False, "occurrence": 0,
                "norm": t, "point_id": "pid", "dense": None, "sparse": None,
            }
            for t in templates
        }

    monkeypatch.setattr(analyzer, "_MAX_TEMPLATES_PER_ROLE", 50)
    monkeypatch.setattr(analyzer, "_recognize_templates", fake_recognize)
    monkeypatch.setattr(
        analyzer, "analyze_with_vector_context",
        AsyncMock(return_value={"severity": "info", "template_classifications": [], "is_notification": False}),
    )
    monkeypatch.setattr(analyzer, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]}))
    monkeypatch.setattr(analyzer, "store_incident_vector", AsyncMock(return_value="pid"))
    monkeypatch.setattr(analyzer, "submit_analysis", AsyncMock())

    sem = asyncio.Semaphore(10)
    await analyzer._analyze_one_role(sem, 5, "cxm", "was1", logs, "agent", "", [])

    assert len(captured["templates"]) == 5  # 전량 처리


# ── 2. 분석 사이클 타임아웃 (파이프라인 자가복구) ──────────────────────────────

@pytest.mark.asyncio
async def test_run_analysis_task_times_out_and_resets_running(monkeypatch):
    """run_analysis()가 끝나지 않아도 _run_analysis_task는 타임아웃 후 _running을 리셋한다."""
    async def hang():
        await asyncio.sleep(100)  # 영원히 안 끝나는 사이클 시뮬레이션

    monkeypatch.setattr(scheduler_tasks.analyzer, "run_analysis", hang)
    monkeypatch.setattr(scheduler_tasks, "ANALYSIS_RUN_TIMEOUT", 0.1)
    monkeypatch.setattr(scheduler_tasks, "_record_run", AsyncMock())
    scheduler_tasks._running = False
    scheduler_tasks._last_run = {"started_at": None, "finished_at": None, "result": None}

    # 멈춘 run_analysis에도 불구하고 빠르게 반환되어야 함 (타임아웃 부재 시 여기서 TimeoutError)
    await asyncio.wait_for(scheduler_tasks._run_analysis_task(), timeout=3)

    assert scheduler_tasks._running is False               # 락 해제 (다음 주기 재시도 가능)
    assert scheduler_tasks._last_run["finished_at"] is not None
    assert "timeout" in str(scheduler_tasks._last_run["result"]).lower()
