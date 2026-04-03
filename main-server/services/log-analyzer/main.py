"""
AOMS Log Analyzer — FastAPI 앱

- 백그라운드 스케줄러: ANALYSIS_INTERVAL_SECONDS마다 자동 분석
- POST /analyze/trigger: n8n 등 외부 스케줄러에서 수동 트리거
- GET  /analyze/status : 마지막 실행 결과 조회
- GET  /health        : 헬스체크
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import analyzer
import vector_client
import aggregation_vector_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

ANALYSIS_INTERVAL = int(os.getenv("ANALYSIS_INTERVAL_SECONDS", "300"))

_running = False
_last_run: dict = {"started_at": None, "finished_at": None, "result": None}


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_scheduler())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="AOMS Log Analyzer", version="1.0.0", lifespan=lifespan)


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
    """n8n Schedule 워크플로우에서 호출하는 수동 트리거 엔드포인트"""
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
