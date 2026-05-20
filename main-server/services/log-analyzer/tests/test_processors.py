"""log-analyzer 핵심 처리기 happy path 단위 테스트.

대상:
- analyzer.run_analysis (PR-4)
- aggregation_processor.run_hourly_aggregation (PR-4)
- aggregation_processor.run_daily_aggregation (PR-4)

전략: 외부 의존성(httpx, vector_client, llm 호출, _send_teams 등)을 AsyncMock으로
패치하고 entry point 함수의 오케스트레이션 로직만 검증한다.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── httpx.AsyncClient 컨텍스트 매니저 mock helper ────────────────────────────

def _make_async_client_cm(routes: dict):
    """`async with httpx.AsyncClient(...) as client:` 형태를 위한 mock.

    routes: {"GET /api/v1/systems": response_json, ...} 형식.
    URL substring 매칭으로 응답 결정.

    Returns (mock_client_class, mock_client).
    """
    mock_client = AsyncMock()

    async def _get(url, **kwargs):
        for key, body in routes.items():
            if key.startswith("GET ") and key[4:] in url:
                resp = MagicMock()
                resp.status_code = 200
                resp.raise_for_status = MagicMock()
                resp.json = MagicMock(return_value=body)
                return resp
        resp = MagicMock()
        resp.status_code = 404
        resp.raise_for_status = MagicMock(side_effect=Exception("unmocked GET " + url))
        return resp

    async def _post(url, **kwargs):
        for key, body in routes.items():
            if key.startswith("POST ") and key[5:] in url:
                resp = MagicMock()
                resp.status_code = 200
                resp.raise_for_status = MagicMock()
                resp.json = MagicMock(return_value=body)
                return resp
        resp = MagicMock()
        resp.status_code = 404
        resp.raise_for_status = MagicMock(side_effect=Exception("unmocked POST " + url))
        return resp

    mock_client.get = AsyncMock(side_effect=_get)
    mock_client.post = AsyncMock(side_effect=_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    mock_class = MagicMock(return_value=mock_client)
    return mock_class, mock_client


# ── analyzer.run_analysis ────────────────────────────────────────────────────

class TestRunAnalysis:
    """analyzer.run_analysis 의 오케스트레이션 검증."""

    @pytest.mark.asyncio
    async def test_happy_path_one_active_system_one_role(self):
        """활성 시스템 1개, 1 instance_role, 분석 성공 → analyzed=1."""
        import analyzer

        active_systems = [
            {"id": 1, "system_name": "was-test", "status": "active"},
        ]
        logs_by_role = {
            "was1": [{"template": "NullPointerException", "count": 3}],
        }

        # OTel 헬스체크는 실패시켜서 has_otel=False 경로
        otel_class, _ = _make_async_client_cm({})

        with patch("analyzer.get_systems", AsyncMock(return_value=active_systems)), \
             patch("analyzer.fetch_logs_for_system", AsyncMock(return_value=logs_by_role)), \
             patch("analyzer.get_agent_code_for_area", AsyncMock(return_value="agent_log")), \
             patch("analyzer._analyze_one_role",
                   AsyncMock(return_value={"status": "analyzed", "label": "was-test/was1"})), \
             patch("analyzer.httpx.AsyncClient", otel_class):
            result = await analyzer.run_analysis()

        assert result["analyzed"] == 1
        assert result["skipped"] == 0
        assert result["no_logs"] == 0
        assert result["errors"] == 0
        assert "was-test/was1" in result["systems"]

    @pytest.mark.asyncio
    async def test_inactive_system_skipped(self):
        """status != active → skipped, fetch_logs 호출 안 됨."""
        import analyzer

        systems = [
            {"id": 1, "system_name": "inactive-sys", "status": "inactive"},
        ]
        fetch_mock = AsyncMock()
        otel_class, _ = _make_async_client_cm({})

        with patch("analyzer.get_systems", AsyncMock(return_value=systems)), \
             patch("analyzer.fetch_logs_for_system", fetch_mock), \
             patch("analyzer.get_agent_code_for_area", AsyncMock(return_value="agent_log")), \
             patch("analyzer._analyze_one_role", AsyncMock()), \
             patch("analyzer.httpx.AsyncClient", otel_class):
            result = await analyzer.run_analysis()

        assert result["skipped"] == 1
        assert result["analyzed"] == 0
        fetch_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_logs_branch(self):
        """활성 시스템이지만 로그 없음 → no_logs=1, _analyze_one_role 미호출."""
        import analyzer

        systems = [{"id": 2, "system_name": "quiet-sys", "status": "active"}]
        analyze_mock = AsyncMock()
        otel_class, _ = _make_async_client_cm({})

        with patch("analyzer.get_systems", AsyncMock(return_value=systems)), \
             patch("analyzer.fetch_logs_for_system", AsyncMock(return_value={})), \
             patch("analyzer.get_agent_code_for_area", AsyncMock(return_value="agent_log")), \
             patch("analyzer._analyze_one_role", analyze_mock), \
             patch("analyzer.httpx.AsyncClient", otel_class):
            result = await analyzer.run_analysis()

        assert result["no_logs"] == 1
        assert result["analyzed"] == 0
        analyze_mock.assert_not_called()


# ── aggregation_processor.run_hourly_aggregation ─────────────────────────────

class TestRunHourlyAggregation:
    """aggregation_processor.run_hourly_aggregation 의 오케스트레이션 검증."""

    @pytest.mark.asyncio
    async def test_happy_path_one_config_processed(self):
        """활성 수집기 1개 → _process_single_config 한 번 호출, processed=1."""
        import aggregation_processor

        configs = [{
            "system_id": 1,
            "system_name": "was-test",
            "display_name": "테스트 WAS",
            "collector_type": "synapse_agent",
            "metric_group": "cpu",
        }]
        routes = {
            "GET /api/v1/collector-config": configs,
            "GET /api/v1/dashboard/system-health": {"systems": []},
        }
        client_class, _ = _make_async_client_cm(routes)

        process_mock = AsyncMock(return_value={"status": "ok", "anomaly": False})

        with patch("aggregation_processor.httpx.AsyncClient", client_class), \
             patch("aggregation_processor._process_single_config", process_mock):
            result = await aggregation_processor.run_hourly_aggregation()

        assert result["processed"] == 1
        assert result["skipped"] == 0
        assert result["anomalies"] == 0
        assert result["errors"] == 0
        process_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_configs_returns_all_zero(self):
        """수집기 설정 없음 → 모든 카운터 0."""
        import aggregation_processor

        routes = {
            "GET /api/v1/collector-config": [],
        }
        client_class, _ = _make_async_client_cm(routes)

        process_mock = AsyncMock()
        with patch("aggregation_processor.httpx.AsyncClient", client_class), \
             patch("aggregation_processor._process_single_config", process_mock):
            result = await aggregation_processor.run_hourly_aggregation()

        assert result == {"processed": 0, "skipped": 0, "anomalies": 0, "errors": 0}
        process_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_anomaly_counted(self):
        """_process_single_config가 anomaly=True 반환 → anomalies=1."""
        import aggregation_processor

        configs = [{
            "system_id": 1,
            "system_name": "was-test",
            "display_name": "테스트 WAS",
            "collector_type": "synapse_agent",
            "metric_group": "cpu",
        }]
        routes = {
            "GET /api/v1/collector-config": configs,
            "GET /api/v1/dashboard/system-health": {"systems": []},
        }
        client_class, _ = _make_async_client_cm(routes)

        process_mock = AsyncMock(return_value={"status": "ok", "anomaly": True})
        with patch("aggregation_processor.httpx.AsyncClient", client_class), \
             patch("aggregation_processor._process_single_config", process_mock):
            result = await aggregation_processor.run_hourly_aggregation()

        assert result["processed"] == 1
        assert result["anomalies"] == 1


# ── aggregation_processor.run_daily_aggregation ──────────────────────────────

class TestRunDailyAggregation:
    """aggregation_processor.run_daily_aggregation 의 오케스트레이션 검증."""

    @pytest.mark.asyncio
    async def test_happy_path_one_group_stored(self):
        """hourly 1행 → 그룹 1개 → daily POST 성공 → processed=1."""
        import aggregation_processor

        systems = [{"id": 1, "system_name": "was-test", "display_name": "테스트 WAS"}]
        hourly_rows = [{
            "system_id":      1,
            "system_name":    "was-test",
            "display_name":   "테스트 WAS",
            "collector_type": "synapse_agent",
            "metric_group":   "cpu",
            "llm_severity":   "normal",
            "metrics_json":   '{"cpu_avg": 35.2}',
        }]
        routes = {
            "GET /api/v1/systems": systems,
            "GET /api/v1/aggregations/hourly": hourly_rows,
            "POST /api/v1/aggregations/daily": {"id": 99},
        }
        client_class, _ = _make_async_client_cm(routes)

        with patch("aggregation_processor.httpx.AsyncClient", client_class), \
             patch(
                 "aggregation_processor.vector_client.get_embedding",
                 AsyncMock(return_value=[0.0] * 1024),
             ), \
             patch(
                 "aggregation_processor.vector_client.get_sparse_vector",
                 AsyncMock(return_value={"indices": [1], "values": [1.0]}),
             ), \
             patch(
                 "aggregation_processor.aggregation_vector_client.store_aggregation_summary_vector",
                 AsyncMock(return_value="point-uuid-1"),
             ), \
             patch(
                 "aggregation_processor.get_agent_code_for_area",
                 AsyncMock(return_value="agent_daily"),
             ), \
             patch("aggregation_processor.call_llm_text", AsyncMock(return_value="요약 텍스트")), \
             patch("aggregation_processor._send_teams", AsyncMock()):
            result = await aggregation_processor.run_daily_aggregation()

        assert result["processed"] == 1
        assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_no_hourly_data_returns_zero(self):
        """전일 hourly 없음 → processed=0 errors=0, daily POST 호출 안 됨."""
        import aggregation_processor

        routes = {
            "GET /api/v1/systems": [],
            "GET /api/v1/aggregations/hourly": [],
        }
        client_class, mock_client = _make_async_client_cm(routes)

        store_mock = AsyncMock()
        teams_mock = AsyncMock()

        with patch("aggregation_processor.httpx.AsyncClient", client_class), \
             patch(
                 "aggregation_processor.aggregation_vector_client.store_aggregation_summary_vector",
                 store_mock,
             ), \
             patch("aggregation_processor._send_teams", teams_mock):
            result = await aggregation_processor.run_daily_aggregation()

        assert result == {"processed": 0, "errors": 0}
        store_mock.assert_not_called()
        teams_mock.assert_not_called()
        # daily POST 도 호출되지 않음 (호출은 client.post 모두 추적)
        for call in mock_client.post.call_args_list:
            assert "/api/v1/aggregations/daily" not in call.args[0]
