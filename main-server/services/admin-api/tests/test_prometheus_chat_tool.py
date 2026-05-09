"""prometheus_query 챗봇 도구 단위 테스트.

검증 항목:
1. _parse_kst_time: ISO / 한국어 / None
2. _check_retention: 15일 초과 거부
3. _validate_window: 형식 검증
4. _build_query: PromQL 조립
5. execute: 정상 + 미지원 metric_group + 인스턴스 분리 결과 (mock httpx)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.chat_tools.executors import prometheus as p


_KST = timezone(timedelta(hours=9))


# ── 시간 파서 ────────────────────────────────────────────────────────────────

def test_parse_kst_time_none_or_now_returns_none():
    assert p._parse_kst_time(None) is None
    assert p._parse_kst_time("") is None
    assert p._parse_kst_time("now") is None
    assert p._parse_kst_time("지금") is None
    assert p._parse_kst_time("현재") is None


def test_parse_kst_time_iso_naive_treated_as_kst():
    # naive ISO → KST 가정 → UTC로 변환
    out = p._parse_kst_time("2026-05-09T03:00:00")
    assert out is not None
    assert out.tzinfo == timezone.utc
    # KST 03:00 → UTC 18:00 (전날)
    assert out.hour == 18
    assert out.day == 8


def test_parse_kst_time_korean_natural():
    out = p._parse_kst_time("2026-05-09 03:00")
    assert out is not None
    # ems.parse_korean_date → KST 03:00 → UTC 18:00 (전날)
    assert out.hour == 18


# ── retention 체크 ──────────────────────────────────────────────────────────

def test_check_retention_passes_recent_time():
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    assert p._check_retention(recent) is None


def test_check_retention_rejects_old_time():
    old = datetime.now(timezone.utc) - timedelta(days=20)
    err = p._check_retention(old)
    assert err is not None
    assert "보관 기간" in err
    assert "ems_get_system_period_usage" in err


def test_check_retention_none_passes():
    assert p._check_retention(None) is None


# ── 윈도우 검증 ──────────────────────────────────────────────────────────────

def test_validate_window_default():
    assert p._validate_window(None) == "5m"
    assert p._validate_window("") == "5m"


def test_validate_window_valid_durations():
    assert p._validate_window("1h") == "1h"
    assert p._validate_window("30m") == "30m"
    assert p._validate_window("24h") == "24h"
    assert p._validate_window("7d") == "7d"


def test_validate_window_invalid_raises():
    with pytest.raises(ValueError, match="window 형식"):
        p._validate_window("1hour")
    with pytest.raises(ValueError, match="window 형식"):
        p._validate_window("abc")


# ── PromQL 조립 ──────────────────────────────────────────────────────────────

def test_build_query_avg_with_window():
    base = 'cpu_usage_percent{{system_name="{sn}",core="total"}}'
    out = p._build_query(base, "cxm", "avg", "5m")
    assert out == 'avg_over_time(cpu_usage_percent{system_name="cxm",core="total"}[5m])'


def test_build_query_p95_uses_quantile():
    base = 'cpu_usage_percent{{system_name="{sn}"}}'
    out = p._build_query(base, "cxm", "p95", "1h")
    assert out.startswith("quantile_over_time(0.95, ")
    assert "[1h]" in out


# ── execute() 통합 ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_execute_unknown_tool_name():
    out = await p.execute(MagicMock(), "wrong_tool", {})
    assert "unknown" in out["error"]


@pytest.mark.asyncio
async def test_execute_missing_system_name():
    out = await p.execute(MagicMock(), "prometheus_query", {"metric_group": "cpu"})
    assert "system_name" in out["error"]


@pytest.mark.asyncio
async def test_execute_invalid_metric_group():
    out = await p.execute(
        MagicMock(),
        "prometheus_query",
        {"system_name": "cxm", "metric_group": "unknown"},
    )
    assert "metric_group" in out["error"]


@pytest.mark.asyncio
async def test_execute_invalid_aggregation():
    out = await p.execute(
        MagicMock(),
        "prometheus_query",
        {"system_name": "cxm", "metric_group": "cpu", "aggregation": "median"},
    )
    assert "aggregation" in out["error"]


@pytest.mark.asyncio
async def test_execute_retention_exceeded_returns_error():
    old_time = (datetime.now(_KST) - timedelta(days=30)).strftime("%Y-%m-%d %H:%M")
    out = await p.execute(
        MagicMock(),
        "prometheus_query",
        {"system_name": "cxm", "metric_group": "cpu", "time": old_time},
    )
    assert "보관 기간" in out["error"]


@pytest.mark.asyncio
async def test_execute_groups_results_by_instance_role():
    """mock Prometheus 응답 → instance_role별로 분리된 instances 배열 검증."""
    fake_resp = MagicMock()
    fake_resp.raise_for_status = MagicMock()
    # cpu_percent와 load_1m 두 sub_metric 모두 was1/was2 인스턴스 반환
    fake_resp.json = MagicMock(
        return_value={
            "data": {
                "result": [
                    {"metric": {"system_name": "cxm", "instance_role": "was1"},
                     "value": [1715200000, "75.3"]},
                    {"metric": {"system_name": "cxm", "instance_role": "was2"},
                     "value": [1715200000, "62.1"]},
                ]
            }
        }
    )
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=fake_resp)
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=None)

    with patch.object(p.httpx, "AsyncClient", return_value=fake_client):
        out = await p.execute(
            MagicMock(),
            "prometheus_query",
            {"system_name": "cxm", "metric_group": "cpu"},
        )

    assert "error" not in out
    assert out["system_name"] == "cxm"
    assert out["metric_group"] == "cpu"
    assert out["aggregation"] == "avg"
    assert out["window"] == "5m"
    insts = {it["instance_role"]: it["metrics"] for it in out["instances"]}
    assert "was1" in insts and "was2" in insts
    # 두 sub_metric(cpu_percent + load_1m) 모두 같은 mock 응답을 사용했으므로 둘 다 채워짐
    assert insts["was1"]["cpu_percent"] == 75.3
    assert insts["was1"]["load_1m"] == 75.3  # 동일 mock
    assert insts["was2"]["cpu_percent"] == 62.1
