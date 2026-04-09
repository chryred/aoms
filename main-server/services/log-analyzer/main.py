"""
Synapse Log Analyzer — FastAPI 앱

내부 스케줄러 (n8n WF1~WF11 대체):
  - _scheduler()              : ANALYSIS_INTERVAL_SECONDS마다 로그 분석 (WF1)
  - _hourly_agg_scheduler()   : 매 시간 :05분 hourly 집계 (WF6)
  - _daily_agg_scheduler()    : 매일 07:30 daily 롤업 (WF7)
  - _weekly_agg_scheduler()   : 매주 월요일 08:00 weekly 리포트 (WF8)
  - _monthly_agg_scheduler()  : 매월 1일 08:00 monthly 리포트 (WF9)
  - _longperiod_agg_scheduler(): 매월 1일 09:00 longperiod 리포트 (WF10)
  - _trend_agg_scheduler()    : 4시간마다 trend 이상 알림 (WF11)

수동 트리거 엔드포인트:
  - POST /analyze/trigger      : 로그 분석 즉시 실행
  - POST /aggregation/*/trigger: 집계 즉시 실행 (관리/테스트용)
  - GET  /analyze/status       : 마지막 실행 결과 조회
  - GET  /health               : 헬스체크
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import analyzer
import vector_client
import aggregation_vector_client
import aggregation_processor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

ANALYSIS_INTERVAL = int(os.getenv("ANALYSIS_INTERVAL_SECONDS", "300"))

_KST = timezone(timedelta(hours=9))  # 집계 스케줄 기준 타임존

_running = False
_last_run: dict = {"started_at": None, "finished_at": None, "result": None}

# ── Phase 5: 집계 처리 실행 상태 ─────────────────────────────────────────────
_AGG_TYPES = ("hourly", "daily", "weekly", "monthly", "longperiod", "trend")
_agg_running: dict[str, bool] = {k: False for k in _AGG_TYPES}
_agg_last_run: dict[str, dict] = {k: {"started_at": None, "finished_at": None, "result": None} for k in _AGG_TYPES}


async def _run_analysis_task() -> None:
    global _running, _last_run
    if _running:
        logger.info("이전 분석이 진행 중 — 스킵")
        return
    _running = True
    _last_run["started_at"] = datetime.now().isoformat()
    _last_run["finished_at"] = None
    try:
        result = await analyzer.run_analysis()
        _last_run["result"] = result
    except Exception as e:
        logger.error(f"분석 실행 중 예외: {e}")
        _last_run["result"] = {"error": str(e)}
    finally:
        _running = False
        _last_run["finished_at"] = datetime.now().isoformat()


async def _scheduler() -> None:
    """ANALYSIS_INTERVAL_SECONDS 주기로 분석 실행"""
    await asyncio.sleep(15)  # 서비스 기동 안정화 대기
    while True:
        await _run_analysis_task()
        await asyncio.sleep(ANALYSIS_INTERVAL)


# ── 내부 집계 스케줄러 (WF6~WF11 대체) ──────────────────────────────────────

def _seconds_until_next(hour: int, minute: int) -> float:
    """다음 KST 지정 시각까지의 초 수"""
    now = datetime.now(_KST)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _hourly_agg_scheduler() -> None:
    """WF6 대체 — 매 시간 :05분에 hourly 집계 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(minute=5, second=0, microsecond=0)
        if now >= target:
            target += timedelta(hours=1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("hourly", aggregation_processor.run_hourly_aggregation))


async def _daily_agg_scheduler() -> None:
    """WF7 대체 — 매일 07:30에 daily 롤업 트리거"""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(_seconds_until_next(7, 30))
        asyncio.create_task(_run_agg_task("daily", aggregation_processor.run_daily_aggregation))


async def _trend_agg_scheduler() -> None:
    """WF11 대체 — 4시간마다 trend 이상 알림 트리거"""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(4 * 3600)
        asyncio.create_task(_run_agg_task("trend", aggregation_processor.run_trend_alert))


async def _weekly_agg_scheduler() -> None:
    """WF8 대체 — 매주 월요일 08:00에 weekly 리포트 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(hour=8, minute=0, second=0, microsecond=0)
        days_until_monday = (0 - now.weekday()) % 7  # 0 = 월요일
        if days_until_monday == 0 and now >= target:
            days_until_monday = 7
        target += timedelta(days=days_until_monday)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("weekly", aggregation_processor.run_weekly_report))


async def _monthly_agg_scheduler() -> None:
    """WF9 대체 — 매월 1일 08:00에 monthly 리포트 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(day=1, hour=8, minute=0, second=0, microsecond=0)
        if now >= target:
            if target.month == 12:
                target = target.replace(year=target.year + 1, month=1)
            else:
                target = target.replace(month=target.month + 1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("monthly", aggregation_processor.run_monthly_report))


async def _longperiod_agg_scheduler() -> None:
    """WF10 대체 — 매월 1일 09:00에 longperiod 리포트 트리거 (함수 내부에서 분기/반기/연간 판단)"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0)
        if now >= target:
            if target.month == 12:
                target = target.replace(year=target.year + 1, month=1)
            else:
                target = target.replace(month=target.month + 1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("longperiod", aggregation_processor.run_longperiod_report))


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(_scheduler()),
        asyncio.create_task(_hourly_agg_scheduler()),
        asyncio.create_task(_daily_agg_scheduler()),
        asyncio.create_task(_trend_agg_scheduler()),
        asyncio.create_task(_weekly_agg_scheduler()),
        asyncio.create_task(_monthly_agg_scheduler()),
        asyncio.create_task(_longperiod_agg_scheduler()),
    ]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    # 모듈 레벨 httpx 클라이언트 정리
    await vector_client._qdrant_http.aclose()
    await vector_client._ollama_http.aclose()
    await analyzer._admin_http.aclose()
    await analyzer._loki_http.aclose()
    await analyzer._llm_http.aclose()


app = FastAPI(title="Synapse Log Analyzer", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "running": _running,
        "interval_seconds": ANALYSIS_INTERVAL,
        "last_run": _last_run,
    }


@app.post("/analyze/trigger")
async def trigger_analysis():
    """수동 트리거 엔드포인트 — 외부 시스템 또는 테스트용 (내부 스케줄러가 자동 실행)"""
    if _running:
        return {"status": "already_running", "last_run": _last_run}
    asyncio.create_task(_run_analysis_task())
    return {"status": "triggered", "interval_seconds": ANALYSIS_INTERVAL}


@app.get("/analyze/status")
async def analysis_status():
    return {"running": _running, "last_run": _last_run}


# ── Phase 4c: 메트릭 유사도 분석 엔드포인트 ─────────────────────────────────

class MetricSimilarityRequest(BaseModel):
    system_name:   str
    instance_role: str = ""
    alertname:     str
    labels:        dict = {}
    annotations:   dict = {}


@app.post("/metric/similarity")
async def metric_similarity(req: MetricSimilarityRequest):
    """
    admin-api가 Alertmanager 메트릭 알림 수신 시 호출.
    메트릭 상태를 임베딩하여 metric_baselines 컬렉션에서 유사 이력 검색 후 분류 반환.

    Response:
        type:         "new" | "recurring" | "related" | "duplicate"
        score:        float (최고 유사도)
        has_solution: bool
        top_results:  list (상위 3건 payload)
        point_id:     str | None (저장된 Qdrant point UUID)
        description:  str (임베딩에 사용된 기술문)
    """
    return await vector_client.analyze_metric_similarity(
        system_name=req.system_name,
        instance_role=req.instance_role,
        alertname=req.alertname,
        labels=req.labels,
        annotations=req.annotations,
    )


# ── 컬렉션 관리 엔드포인트 ───────────────────────────────────────────────────

_COLLECTION_MAP = {
    "log":     vector_client.COLLECTION,                                      # "log_incidents"
    "metric":  vector_client.METRIC_COLLECTION,                               # "metric_baselines"
    "hourly":  aggregation_vector_client.HOURLY_PATTERNS_COLLECTION,          # "metric_hourly_patterns"
    "summary": aggregation_vector_client.AGG_SUMMARIES_COLLECTION,            # "aggregation_summaries"
}


def _resolve_collection(collection_type: str) -> str:
    name = _COLLECTION_MAP.get(collection_type)
    if not name:
        raise HTTPException(
            status_code=400,
            detail=f"collection_type은 {list(_COLLECTION_MAP.keys())} 중 하나여야 합니다.",
        )
    return name


@app.post("/collections/{collection_type}/create", status_code=201)
async def create_collection(collection_type: str):
    """
    컬렉션 생성 (log_incidents / metric_baselines).
    이미 존재하면 created=false 반환.
    HNSW: m=16, ef_construct=200, ef=128
    """
    name    = _resolve_collection(collection_type)
    created = await vector_client.ensure_collection(name)
    return {"collection": name, "created": created}


@app.delete("/collections/{collection_type}", status_code=200)
async def delete_collection_endpoint(collection_type: str):
    """컬렉션 삭제."""
    name = _resolve_collection(collection_type)
    await vector_client.delete_collection(name)
    return {"collection": name, "deleted": True}


@app.post("/collections/{collection_type}/reset", status_code=200)
async def reset_collection(collection_type: str):
    """컬렉션 초기화 — 삭제 후 재생성 (테스트용). 모든 데이터가 삭제됩니다."""
    name = _resolve_collection(collection_type)
    await vector_client.reset_collection(name)
    return {"collection": name, "reset": True}


# ── 메트릭 복구 엔드포인트 ────────────────────────────────────────────────────

class MetricResolveRequest(BaseModel):
    point_id: str


@app.post("/metric/resolve")
async def metric_resolve(req: MetricResolveRequest):
    """
    admin-api가 Alertmanager resolved 이벤트 수신 시 호출.
    metric_baselines Qdrant 포인트에 resolved=True 업데이트.
    """
    await vector_client.resolve_metric_vector(req.point_id)
    return {"point_id": req.point_id, "resolved": True}


# ── Phase 5: 집계 벡터 검색 엔드포인트 (UI 프록시) ────────────────────────────

class AggregationSearchRequest(BaseModel):
    query_text:      str
    collection:      str           # "metric_hourly_patterns" | "aggregation_summaries"
    system_id:       int | None = None
    limit:           int = 10
    score_threshold: float = 0.70


class SimilarPeriodRequest(BaseModel):
    point_id:    str
    collection:  str
    system_id:   int | None = None
    limit:       int = 5


@app.post("/aggregation/search")
async def aggregation_search(req: AggregationSearchRequest):
    """
    UI에서 자연어로 유사 집계 기간 검색.
    query_text를 임베딩 후 Qdrant 컬렉션에서 유사도 조회.

    collection 옵션:
      - "metric_hourly_patterns"  : 1시간 집계 패턴 검색
      - "aggregation_summaries"   : 일/주/월 리포트 요약 검색
    """
    try:
        results = await aggregation_vector_client.search_similar_aggregations(
            query_text=req.query_text,
            collection=req.collection,
            system_id=req.system_id,
            limit=req.limit,
            score_threshold=req.score_threshold,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"count": len(results), "results": results}


@app.post("/aggregation/similar-period")
async def aggregation_similar_period(req: SimilarPeriodRequest):
    """
    기존 집계 기간(point_id)과 유사한 과거 기간 검색.
    "이 주와 비슷한 상황이었던 과거 주간" 조회 등에 활용.
    """
    try:
        results = await aggregation_vector_client.search_similar_by_vector(
            point_id=req.point_id,
            collection=req.collection,
            system_id=req.system_id,
            limit=req.limit,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"count": len(results), "results": results}


@app.get("/aggregation/collections/info")
async def aggregation_collections_info():
    """
    metric_hourly_patterns, aggregation_summaries 컬렉션 현황.
    UI 헬스 체크 및 데이터 적재 확인용.
    """
    return await aggregation_vector_client.get_collections_info()


@app.post("/aggregation/collections/setup", status_code=201)
async def aggregation_collections_setup():
    """
    WF12 또는 초기 배포 시 호출 — 두 컬렉션이 없으면 생성.
    이미 존재하면 created=false 반환 (안전하게 재호출 가능).
    """
    result = await aggregation_vector_client.ensure_aggregation_collections()
    return {"created": result}


class StoreHourlyPatternRequest(BaseModel):
    system_id:      int
    system_name:    str
    hour_bucket:    str                 # ISO datetime string
    collector_type: str
    metric_group:   str
    summary_text:   str                 # 임베딩에 사용할 요약 텍스트
    llm_severity:   str                 # normal | warning | critical
    llm_trend:      str | None = None
    llm_prediction: str | None = None
    pg_row_id:      int                 # metric_hourly_aggregations.id


class StoreAggSummaryRequest(BaseModel):
    system_id:         int
    system_name:       str
    period_type:       str              # daily | weekly | monthly | quarterly | half_year | annual
    period_start:      str
    summary_text:      str
    dominant_severity: str
    pg_row_id:         int


@app.post("/aggregation/store-hourly")
async def store_hourly_pattern(req: StoreHourlyPatternRequest):
    """
    WF6 호출용 — 1시간 집계 요약 텍스트를 임베딩 후 metric_hourly_patterns에 저장.
    point_id 반환 (admin-api hourly 레코드에 업데이트 용도).
    """
    embedding = await vector_client.get_embedding(req.summary_text)
    point_id = await aggregation_vector_client.store_hourly_pattern_vector(
        embedding=embedding,
        system_id=req.system_id,
        system_name=req.system_name,
        hour_bucket=req.hour_bucket,
        collector_type=req.collector_type,
        metric_group=req.metric_group,
        summary_text=req.summary_text,
        llm_severity=req.llm_severity,
        llm_trend=req.llm_trend,
        llm_prediction=req.llm_prediction,
        pg_row_id=req.pg_row_id,
    )
    return {"point_id": point_id}


# ── Phase 5: 집계 트리거 엔드포인트 (WF6~WF11 → log-analyzer) ─────────────────

async def _run_agg_task(name: str, fn) -> None:
    global _agg_running, _agg_last_run
    if _agg_running[name]:
        return
    _agg_running[name] = True
    _agg_last_run[name]["started_at"] = datetime.now().isoformat()
    _agg_last_run[name]["finished_at"] = None
    try:
        result = await fn()
        _agg_last_run[name]["result"] = result
    except Exception as e:
        logger.error(f"집계 오류 [{name}]: {e}")
        _agg_last_run[name]["result"] = {"error": str(e)}
    finally:
        _agg_running[name] = False
        _agg_last_run[name]["finished_at"] = datetime.now().isoformat()


def _trigger_aggregation(task_key: str, coro_fn) -> dict:
    """집계 트리거 공통 처리 — 실행 중이면 상태 반환, 아니면 백그라운드 태스크 시작"""
    if _agg_running[task_key]:
        return {"status": "already_running", "last_run": _agg_last_run[task_key]}
    asyncio.create_task(_run_agg_task(task_key, coro_fn))
    return {"status": "triggered"}


@app.post("/aggregation/hourly/trigger")
async def trigger_hourly():
    """WF6 호출용 — 1시간 메트릭 집계 트리거 (asyncio 병렬, semaphore=20)"""
    return _trigger_aggregation("hourly", aggregation_processor.run_hourly_aggregation)


@app.post("/aggregation/daily/trigger")
async def trigger_daily():
    """WF7 호출용 — 전일 시간별 집계 → 일별 롤업 트리거"""
    return _trigger_aggregation("daily", aggregation_processor.run_daily_aggregation)


@app.post("/aggregation/weekly/trigger")
async def trigger_weekly():
    """WF8 호출용 — 전주 일별 집계 → 주간 리포트 + Teams 발송 트리거"""
    return _trigger_aggregation("weekly", aggregation_processor.run_weekly_report)


@app.post("/aggregation/monthly/trigger")
async def trigger_monthly():
    """WF9 호출용 — 전월 주별 집계 → 월간 리포트 + Teams 발송 트리거"""
    return _trigger_aggregation("monthly", aggregation_processor.run_monthly_report)


@app.post("/aggregation/longperiod/trigger")
async def trigger_longperiod():
    """WF10 호출용 — 분기/반기/연간 리포트 + Teams 발송 트리거"""
    return _trigger_aggregation("longperiod", aggregation_processor.run_longperiod_report)


@app.post("/aggregation/trend/trigger")
async def trigger_trend():
    """WF11 호출용 — 지속 이상 시스템 추세 분석 + Teams 프로액티브 알림 트리거"""
    return _trigger_aggregation("trend", aggregation_processor.run_trend_alert)


@app.get("/aggregation/status")
async def aggregation_status():
    """WF6~WF11 집계 실행 상태 일괄 조회"""
    return {
        name: {"running": _agg_running[name], **_agg_last_run[name]}
        for name in _AGG_TYPES
    }


@app.post("/aggregation/store-summary")
async def store_agg_summary(req: StoreAggSummaryRequest):
    """
    WF7-WF10 호출용 — 일/주/월 집계 요약을 임베딩 후 aggregation_summaries에 저장.
    point_id 반환.
    """
    embedding = await vector_client.get_embedding(req.summary_text)
    point_id = await aggregation_vector_client.store_aggregation_summary_vector(
        embedding=embedding,
        system_id=req.system_id,
        system_name=req.system_name,
        period_type=req.period_type,
        period_start=req.period_start,
        summary_text=req.summary_text,
        dominant_severity=req.dominant_severity,
        pg_row_id=req.pg_row_id,
    )
    return {"point_id": point_id}
