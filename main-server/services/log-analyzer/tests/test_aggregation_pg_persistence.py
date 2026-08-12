"""집계 리포트의 PG 영속화 회귀 테스트.

배경 (2026-08-12 운영기 진단):
- weekly는 PG POST payload에 admin-api 필수 필드(collector_type/metric_group)가 없어
  422로 거부됐다 → `metric_weekly_aggregations` 영구 공백.
- monthly / longperiod(분기·반기·연간)는 PG POST 자체가 없어
  `metric_monthly_aggregations` 영구 공백.
→ 안정성 리포트 화면의 주별/월별/분기/반기/연간 탭이 계속 "집계 데이터가 없습니다".

분기 기간 계산도 4개월 창(4/1~8/1)이었고 KST 경계를 UTC로 변환하지 않았다.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.test_processors import _make_async_client_cm  # noqa: E402

_KST = timezone(timedelta(hours=9))


def _posts_to(mock_client, path: str) -> list[dict]:
    """mock client의 POST 호출 중 URL이 path를 포함하는 것들의 json payload 목록."""
    out = []
    for call in mock_client.post.call_args_list:
        url = call.args[0] if call.args else call.kwargs.get("url", "")
        if path in url:
            out.append(call.kwargs.get("json"))
    return out


_DAILY_ROWS = [
    {
        "system_id":      1,
        "collector_type": "synapse_agent",
        "metric_group":   "cpu",
        "llm_severity":   "warning",
        "llm_trend":      "CPU 상승 추세",
        "metrics_json":   json.dumps({"hour_count": 24, "anomaly_hours": 3}),
    },
]
_SYSTEMS = [{"id": 1, "system_name": "was-test", "display_name": "테스트 WAS"}]


def _vector_patches():
    """Qdrant/LLM/Teams 외부 의존성 패치 컨텍스트 목록."""
    return [
        patch("aggregation_processor.vector_client.get_embedding", AsyncMock(return_value=[0.0] * 1024)),
        patch(
            "aggregation_processor.vector_client.get_sparse_vector",
            AsyncMock(return_value={"indices": [1], "values": [1.0]}),
        ),
        patch(
            "aggregation_processor.aggregation_vector_client.store_aggregation_summary_vector",
            AsyncMock(return_value="point-uuid-1"),
        ),
        patch("aggregation_processor.get_agent_code_for_area", AsyncMock(return_value="agent_x")),
        patch("aggregation_processor.call_llm_text", AsyncMock(return_value="요약 텍스트")),
        patch("aggregation_processor._send_teams", AsyncMock()),
    ]


class TestWeeklyPgPersistence:
    """run_weekly_report → POST /api/v1/aggregations/weekly 계약."""

    @pytest.mark.asyncio
    async def test_weekly_payload_has_admin_api_required_fields(self):
        """admin-api WeeklyAggregationCreate 필수 필드(collector_type/metric_group) 포함."""
        import aggregation_processor

        routes = {
            "GET /api/v1/systems": _SYSTEMS,
            "GET /api/v1/aggregations/daily": _DAILY_ROWS,
            "POST /api/v1/reports": {"id": 1},
            "POST /api/v1/aggregations/weekly": {"id": 55},
        }
        client_class, mock_client = _make_async_client_cm(routes)

        with patch("aggregation_processor.httpx.AsyncClient", client_class):
            for p in _vector_patches():
                p.start()
            try:
                result = await aggregation_processor.run_weekly_report()
            finally:
                patch.stopall()

        assert result["status"] == "ok"
        payloads = _posts_to(mock_client, "/api/v1/aggregations/weekly")
        assert len(payloads) == 1, "시스템당 주간 집계 행 1건이 저장돼야 한다"
        p = payloads[0]
        assert p["collector_type"], "collector_type 누락 → admin-api 422"
        assert p["metric_group"], "metric_group 누락 → admin-api 422"
        assert p["system_id"] == 1
        assert p["week_start"]
        assert json.loads(p["metrics_json"])["total_anomaly_hours"] == 3


class TestMonthlyPgPersistence:
    """run_monthly_report → POST /api/v1/aggregations/monthly 계약."""

    @pytest.mark.asyncio
    async def test_monthly_stores_pg_row(self):
        import aggregation_processor

        routes = {
            "GET /api/v1/systems": _SYSTEMS,
            "GET /api/v1/aggregations/daily": _DAILY_ROWS,
            "POST /api/v1/reports": {"id": 2},
            "POST /api/v1/aggregations/monthly": {"id": 77},
        }
        client_class, mock_client = _make_async_client_cm(routes)

        with patch("aggregation_processor.httpx.AsyncClient", client_class):
            for p in _vector_patches():
                p.start()
            try:
                result = await aggregation_processor.run_monthly_report()
            finally:
                patch.stopall()

        assert result["status"] == "ok"
        payloads = _posts_to(mock_client, "/api/v1/aggregations/monthly")
        assert len(payloads) == 1
        p = payloads[0]
        assert p["period_type"] == "monthly"
        assert p["collector_type"] and p["metric_group"]
        assert p["period_start"]


class TestLongPeriodPgPersistence:
    """_run_single_period_report → POST /api/v1/aggregations/monthly (period_type 구분)."""

    @pytest.mark.asyncio
    async def test_quarterly_stores_pg_row_with_period_type(self):
        import aggregation_processor

        routes = {
            "GET /api/v1/systems": _SYSTEMS,
            "GET /api/v1/aggregations/daily": _DAILY_ROWS,
            "POST /api/v1/reports": {"id": 3},
            "POST /api/v1/aggregations/monthly": {"id": 88},
        }
        client_class, mock_client = _make_async_client_cm(routes)

        ps = datetime(2026, 4, 1, tzinfo=_KST)
        pe = datetime(2026, 7, 1, tzinfo=_KST)

        for p in _vector_patches():
            p.start()
        try:
            result = await aggregation_processor._run_single_period_report(
                mock_client, "quarterly", ps, pe, "2026년 2분기"
            )
        finally:
            patch.stopall()

        assert result["status"] == "ok"
        payloads = _posts_to(mock_client, "/api/v1/aggregations/monthly")
        assert len(payloads) == 1
        p = payloads[0]
        assert p["period_type"] == "quarterly"
        assert p["collector_type"] and p["metric_group"]
        # KST 자정 → UTC naive 로 변환 저장 (전 계층 저장=UTC 규칙)
        assert p["period_start"] == "2026-03-31T15:00:00"

    @pytest.mark.asyncio
    async def test_report_history_period_is_utc_naive(self):
        """report_history period_start/end 도 UTC naive (기존엔 KST 벽시계를 그대로 저장)."""
        import aggregation_processor

        routes = {
            "GET /api/v1/systems": _SYSTEMS,
            "GET /api/v1/aggregations/daily": _DAILY_ROWS,
            "POST /api/v1/reports": {"id": 4},
            "POST /api/v1/aggregations/monthly": {"id": 89},
        }
        client_class, mock_client = _make_async_client_cm(routes)

        ps = datetime(2026, 4, 1, tzinfo=_KST)
        pe = datetime(2026, 7, 1, tzinfo=_KST)

        for p in _vector_patches():
            p.start()
        try:
            await aggregation_processor._run_single_period_report(
                mock_client, "quarterly", ps, pe, "2026년 2분기"
            )
        finally:
            patch.stopall()

        reports = _posts_to(mock_client, "/api/v1/reports")
        assert reports[0]["period_start"] == "2026-03-31T15:00:00"
        assert reports[0]["period_end"] == "2026-06-30T15:00:00"


class TestLongPeriodConfigs:
    """_build_longperiod_configs — 직전 완료 분기/반기/연간 창 계산 (순수 함수)."""

    def test_quarterly_is_previous_calendar_quarter(self):
        """8월 실행 → 직전 완료 분기 = 2026 Q2 (4/1~7/1). 기존엔 4/1~8/1 4개월 창."""
        import aggregation_processor

        configs = aggregation_processor._build_longperiod_configs(datetime(2026, 8, 12, 9, 0, tzinfo=_KST))
        quarterly = [c for c in configs if c[0] == "quarterly"]
        assert len(quarterly) == 1
        _, ps, pe, label = quarterly[0]
        assert (ps.year, ps.month, ps.day) == (2026, 4, 1)
        assert (pe.year, pe.month, pe.day) == (2026, 7, 1)
        assert label == "2026년 2분기"

    def test_quarterly_january_rolls_to_previous_year_q4(self):
        import aggregation_processor

        configs = aggregation_processor._build_longperiod_configs(datetime(2026, 1, 1, 9, 0, tzinfo=_KST))
        _, ps, pe, label = [c for c in configs if c[0] == "quarterly"][0]
        assert (ps.year, ps.month) == (2025, 10)
        assert (pe.year, pe.month) == (2026, 1)
        assert label == "2025년 4분기"

    def test_january_adds_half_year_and_annual(self):
        import aggregation_processor

        configs = aggregation_processor._build_longperiod_configs(datetime(2026, 1, 1, 9, 0, tzinfo=_KST))
        types = [c[0] for c in configs]
        assert types == ["quarterly", "half_year", "annual"]

    def test_july_adds_half_year_only(self):
        import aggregation_processor

        configs = aggregation_processor._build_longperiod_configs(datetime(2026, 7, 1, 9, 0, tzinfo=_KST))
        types = [c[0] for c in configs]
        assert types == ["quarterly", "half_year"]
        _, hs, he, label = configs[1]
        assert (hs.year, hs.month) == (2026, 1)
        assert (he.year, he.month) == (2026, 7)
        assert label == "2026년 상반기"

    def test_other_months_quarterly_only(self):
        import aggregation_processor

        configs = aggregation_processor._build_longperiod_configs(datetime(2026, 5, 1, 9, 0, tzinfo=_KST))
        assert [c[0] for c in configs] == ["quarterly"]
