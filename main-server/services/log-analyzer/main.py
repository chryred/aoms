"""
Synapse Log Analyzer — FastAPI 앱

스케줄러 구현은 scheduler_tasks.py 참조.

수동 트리거 엔드포인트:
  - POST /analyze/trigger      : 로그 분석 즉시 실행
  - POST /aggregation/*/trigger: 집계 즉시 실행 (관리/테스트용)
  - POST /knowledge/sync/jira/trigger    : Jira 동기화 즉시 실행
  - POST /knowledge/sync/confluence/trigger: Confluence 동기화 즉시 실행
  - GET  /analyze/status       : 마지막 실행 결과 조회
  - GET  /health               : 헬스체크
"""

import asyncio
import logging
import os
import pathlib
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from pydantic import BaseModel

import analyzer
import vector_client
import aggregation_vector_client
import aggregation_processor
import knowledge_vector_client
import guides_vector_client
import scheduler_tasks
from routes import incident_postmortem
from routes import guides

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

KNOWLEDGE_DOCS_DIR = os.getenv(
    "KNOWLEDGE_DOCS_DIR",
    str(pathlib.Path(__file__).parent.parent / "attaches" / "knowledge-docs"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dense + Sparse 모델 사전 로드 — 첫 요청 타임아웃 방지
    # snapshot_download + ONNX 세션 초기화(수 초)를 startup 단계에서 완료
    try:
        await vector_client.get_embedding("warmup")
        await vector_client.get_sparse_vector("warmup")
        logger.info("임베딩 모델 사전 로드 완료")
    except Exception as e:
        logger.warning("임베딩 모델 사전 로드 실패 — 첫 요청 시 지연 발생 가능: %s", e)

    # Reranker(bge-reranker-v2-m3, ~2.3GB) 사전 로드 — 첫 knowledge/search 요청 타임아웃 방지
    try:
        from reranker import _get_reranker_session
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _get_reranker_session)
        logger.info("Reranker 모델 사전 로드 완료")
    except Exception as e:
        logger.warning("Reranker 사전 로드 실패 — 첫 요청 시 지연 발생 가능: %s", e)

    # ADR-011: log_incidents / metric_baselines 는 Hybrid (Dense+Sparse) 스키마
    for col in ("log_incidents", "metric_baselines"):
        try:
            await vector_client.ensure_collection(col, hybrid=True)
        except Exception as e:
            logger.warning("컬렉션 초기화 실패 %s — 분석 중 재시도됨: %s", col, e)

    # 집계 컬렉션 (metric_hourly_patterns / aggregation_summaries) 보장
    try:
        await aggregation_vector_client.ensure_aggregation_collections()
    except Exception as e:
        logger.warning("집계 컬렉션 초기화 실패 — 스케줄러 실행 중 재시도됨: %s", e)

    # V1 Knowledge 컬렉션 (3종) 보장
    try:
        await knowledge_vector_client.ensure_knowledge_collections()
    except Exception as e:
        logger.warning("Knowledge 컬렉션 초기화 실패 — 동기화 중 재시도됨: %s", e)

    # Wave 1B: incident_postmortems 컬렉션 보장
    try:
        await vector_client.ensure_postmortem_collection()
    except Exception as e:
        logger.warning("incident_postmortems 컬렉션 초기화 실패 — 요청 시 재시도됨: %s", e)

    # knowledge_guides 컬렉션 보장
    try:
        await guides_vector_client.ensure_guides_collection()
    except Exception as e:
        logger.warning("knowledge_guides 컬렉션 초기화 실패 — 요청 시 재시도됨: %s", e)

    tasks = [
        asyncio.create_task(scheduler_tasks._scheduler()),
        asyncio.create_task(scheduler_tasks._hourly_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._daily_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._trend_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._weekly_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._monthly_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._longperiod_agg_scheduler()),
        asyncio.create_task(scheduler_tasks._jira_sync_scheduler()),
        asyncio.create_task(scheduler_tasks._confluence_sync_scheduler()),
        asyncio.create_task(scheduler_tasks._jira_cleanup_scheduler()),
        asyncio.create_task(scheduler_tasks._confluence_cleanup_scheduler()),
    ]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    # 모듈 레벨 httpx 클라이언트 정리 (FastEmbed는 인프로세스이므로 close 불필요)
    await vector_client._qdrant_http.aclose()
    await analyzer._admin_http.aclose()
    await analyzer._prom_http.aclose()


app = FastAPI(title="Synapse Log Analyzer", version="1.0.0", lifespan=lifespan)

app.include_router(incident_postmortem.router)
app.include_router(guides.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "running": scheduler_tasks._running,
        "interval_seconds": scheduler_tasks.ANALYSIS_INTERVAL,
        "last_run": scheduler_tasks._last_run,
    }


@app.post("/analyze/trigger")
async def trigger_analysis():
    """수동 트리거 엔드포인트 — 외부 시스템 또는 테스트용 (내부 스케줄러가 자동 실행)"""
    if scheduler_tasks._running:
        return {"status": "already_running", "last_run": scheduler_tasks._last_run}
    asyncio.create_task(scheduler_tasks._run_analysis_task())
    return {"status": "triggered", "interval_seconds": scheduler_tasks.ANALYSIS_INTERVAL}


@app.get("/analyze/status")
async def analysis_status():
    return {"running": scheduler_tasks._running, "last_run": scheduler_tasks._last_run}


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

    ADR-011: hourly만 Dense 전용, 나머지 3개는 Dense+Sparse Hybrid.
    """
    name    = _resolve_collection(collection_type)
    hybrid  = collection_type != "hourly"
    created = await vector_client.ensure_collection(name, hybrid=hybrid)
    return {"collection": name, "created": created, "hybrid": hybrid}


@app.delete("/collections/{collection_type}", status_code=200)
async def delete_collection_endpoint(collection_type: str):
    """컬렉션 삭제."""
    name = _resolve_collection(collection_type)
    await vector_client.delete_collection(name)
    return {"collection": name, "deleted": True}


@app.post("/collections/{collection_type}/reset", status_code=200)
async def reset_collection(collection_type: str):
    """컬렉션 초기화 — 삭제 후 재생성 (테스트용). 모든 데이터가 삭제됩니다."""
    name   = _resolve_collection(collection_type)
    hybrid = collection_type != "hourly"
    await vector_client.reset_collection(name, hybrid=hybrid)
    return {"collection": name, "reset": True, "hybrid": hybrid}


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


# ── 해결책 업데이트 엔드포인트 ──────────────────────────────────────────────────

class SolutionUpdateRequest(BaseModel):
    point_id: str
    collection_type: str  # "log" | "metric"
    solution: str
    resolver: str


@app.post("/solution/update")
async def solution_update(req: SolutionUpdateRequest):
    """admin-api가 프론트엔드 피드백 등록 시 호출. Qdrant 포인트에 해결책 추가."""
    if req.collection_type == "metric":
        await vector_client.update_metric_resolution(
            req.point_id, req.solution, req.resolver
        )
    else:
        await vector_client.update_resolution(
            req.point_id, req.solution, req.resolver
        )
    return {"point_id": req.point_id, "updated": True}


# ── 역방향 incident_id 업데이트 ───────────────────────────────────────────────

class LinkIncidentRequest(BaseModel):
    incident_id:      int
    log_point_ids:    list[str] = []
    metric_point_ids: list[str] = []


@app.patch("/incidents/points/link-incident")
async def link_incident_points(req: LinkIncidentRequest):
    """
    피드백 승인 시 admin-api가 호출.
    log_incidents / metric_baselines Qdrant 포인트에 incident_id를 역방향 주입.
    이후 유사도 검색 → incident_id → incident_postmortems.solution 경로 활성화.
    """
    if req.log_point_ids:
        await vector_client.update_log_incident_ids(req.log_point_ids, req.incident_id)
    if req.metric_point_ids:
        await vector_client.update_metric_incident_ids(req.metric_point_ids, req.incident_id)
    return {
        "incident_id":     req.incident_id,
        "updated_log":     len(req.log_point_ids),
        "updated_metric":  len(req.metric_point_ids),
    }


class NotificationFlagRequest(BaseModel):
    point_ids: list[str]


@app.patch("/incident/notification-flag")
async def mark_notification_flag(body: NotificationFlagRequest):
    """담당자 정보성 분류 → log_incidents Qdrant 포인트 is_notification=True 갱신."""
    if not body.point_ids:
        return {"updated": 0}
    try:
        resp = await vector_client._qdrant_http.post(
            f"{vector_client.QDRANT_URL}/collections/{vector_client.COLLECTION}/points/payload",
            json={
                "payload": {"is_notification": True, "notification_source": "human"},
                "points": body.point_ids,
            },
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.error("notification-flag Qdrant 업데이트 실패: %s", exc)
        raise HTTPException(status_code=502, detail=f"Qdrant 업데이트 실패: {str(exc)[:200]}")
    logger.info("notification-flag: %d건 is_notification=True 갱신 완료", len(body.point_ids))
    return {"updated": len(body.point_ids)}


# ── Phase 5: 집계 벡터 검색 엔드포인트 (UI 프록시) ────────────────────────────

class AggregationSearchRequest(BaseModel):
    query_text:       str
    collection:       str           # "metric_hourly_patterns" | "aggregation_summaries"
    system_id:        int | None = None
    limit:            int = 10
    rerank:           bool = False    # cross-encoder 재정렬 (bge-reranker-v2-m3)
    rerank_top_k:     int  = 10
    score_threshold:  float = 0.5    # dense prefetch 최소 유사도
    with_scores:      bool = False   # Track C: dense/sparse 개별 점수 병합


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

    ADR-011: Hybrid Dense+Sparse RRF 검색. prefetch cosine >= 0.5 + RRF 순위 기준 limit N개 반환.
    """
    try:
        results = await aggregation_vector_client.search_similar_aggregations(
            query_text=req.query_text,
            collection=req.collection,
            system_id=req.system_id,
            limit=req.limit,
            rerank=req.rerank,
            rerank_top_k=req.rerank_top_k,
            score_threshold=req.score_threshold,
            with_scores=req.with_scores,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"count": len(results), "results": results}


# ── RAG 챗봇용 인시던트 통합 검색 ────────────────────────────────────────────

class IncidentSearchRequest(BaseModel):
    query:           str
    system_name:     str | None = None
    limit:           int = 5
    rerank:          bool = False         # cross-encoder 재정렬 (bge-reranker-v2-m3)
    rerank_top_k:    int | None = None    # None이면 limit과 동일
    score_threshold: float = 0.5         # dense prefetch 최소 유사도
    with_scores:     bool = False         # Track C: dense/sparse 개별 점수 병합


@app.post("/incident/search")
async def incident_search(req: IncidentSearchRequest):
    """
    RAG 챗봇 전용 — log_incidents + metric_baselines Hybrid 통합 검색.
    admin-api chat_tools.qdrant.qdrant_search_incident_knowledge 에서 호출.

    rerank=True 일 때 retrieval limit를 limit*4로 늘려 후보 확보 후
    cross-encoder(bge-reranker-v2-m3)로 rerank_top_k 개로 재정렬한다.
    """
    try:
        dense  = await vector_client.get_embedding(req.query)
        sparse = await vector_client.get_sparse_vector(req.query)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"임베딩 실패: {exc}")

    filter_must = None
    if req.system_name:
        filter_must = [{"key": "system_name", "match": {"value": req.system_name}}]

    retrieval_limit = req.limit * 4 if req.rerank else req.limit
    rerank_top_k = req.rerank_top_k if req.rerank_top_k is not None else req.limit

    log_hits = []
    metric_hits = []
    try:
        log_hits = await vector_client._hybrid_search(
            collection=vector_client.COLLECTION,
            dense=dense,
            sparse=sparse,
            filter_must=filter_must,
            limit=retrieval_limit,
            dense_prefetch_threshold=req.score_threshold,
            with_scores=req.with_scores,
        )
    except Exception as exc:
        logger.warning("log_incidents 검색 실패: %s", exc)

    try:
        metric_hits = await vector_client._hybrid_search(
            collection=vector_client.METRIC_COLLECTION,
            dense=dense,
            sparse=sparse,
            filter_must=filter_must,
            limit=retrieval_limit,
            dense_prefetch_threshold=req.score_threshold,
            with_scores=req.with_scores,
        )
    except Exception as exc:
        logger.warning("metric_baselines 검색 실패: %s", exc)

    if req.rerank:
        # cross-encoder 재정렬: 두 컬렉션 후보를 합쳐서 reranker로 정렬한 뒤 분리
        from reranker import rerank as _rerank

        def _log_text(h: dict) -> str:
            p = h.get("payload") or {}
            return " | ".join(filter(None, [
                p.get("log_pattern", ""),
                p.get("root_cause", ""),
                p.get("recommendation", ""),
                p.get("resolution", ""),
            ]))

        def _metric_text(h: dict) -> str:
            p = h.get("payload") or {}
            return " | ".join(filter(None, [
                p.get("alertname", ""),
                p.get("metric_name", ""),
                str(p.get("metric_value", "") or ""),
                p.get("resolution", ""),
            ]))

        log_candidates = [{**h, "_rt": _log_text(h), "_kind": "log"} for h in log_hits]
        metric_candidates = [{**h, "_rt": _metric_text(h), "_kind": "metric"} for h in metric_hits]
        merged = log_candidates + metric_candidates
        if merged:
            try:
                reranked = await _rerank(req.query, merged, top_k=rerank_top_k * 2, text_field="_rt")
                log_hits = [r for r in reranked if r["_kind"] == "log"][:rerank_top_k]
                metric_hits = [r for r in reranked if r["_kind"] == "metric"][:rerank_top_k]
                # 임시 필드 제거
                for r in log_hits + metric_hits:
                    r.pop("_rt", None)
                    r.pop("_kind", None)
            except Exception as exc:
                logger.warning("Reranker 실패: %s → 원본 RRF 순서 유지", exc)
                log_hits = log_hits[:rerank_top_k]
                metric_hits = metric_hits[:rerank_top_k]

    def _score_fields(h: dict) -> dict:
        """Track C: dense/sparse 점수 분해 필드 추출 (with_scores=True 시에만 존재)."""
        out: dict = {}
        for key in ("dense_score", "dense_rank", "sparse_score", "sparse_rank",
                    "rerank_score", "original_rank", "rerank_rank"):
            if key in h:
                out[key] = h[key]
        return out

    return {
        "log_incidents": [
            {
                "id":             h["id"],
                "score":          h["score"],
                "system_name":    h["payload"].get("system_name"),
                "severity":       h["payload"].get("severity"),
                "log_pattern":    h["payload"].get("log_pattern", "")[:300],
                "root_cause":     h["payload"].get("root_cause"),
                "recommendation": h["payload"].get("recommendation"),
                "resolution":     h["payload"].get("resolution"),
                "resolver":       h["payload"].get("resolver"),
                "timestamp":      h["payload"].get("timestamp"),
                **_score_fields(h),
            }
            for h in log_hits
        ],
        "metric_incidents": [
            {
                "id":           h["id"],
                "score":        h["score"],
                "system_name":  h["payload"].get("system_name"),
                "metric_name":  h["payload"].get("metric_name"),
                "alertname":    h["payload"].get("alertname"),
                "severity":     h["payload"].get("severity"),
                "metric_value": h["payload"].get("metric_value"),
                "resolution":   h["payload"].get("resolution"),
                "resolver":     h["payload"].get("resolver"),
                "timestamp":    h["payload"].get("timestamp"),
                **_score_fields(h),
            }
            for h in metric_hits
        ],
    }


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
    embedding, sparse = await asyncio.gather(
        vector_client.get_embedding(req.summary_text),
        vector_client.get_sparse_vector(req.summary_text),
    )
    point_id = await aggregation_vector_client.store_hourly_pattern_vector(
        embedding=embedding,
        sparse=sparse,
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

@app.post("/aggregation/hourly/trigger")
async def trigger_hourly():
    """WF6 호출용 — 1시간 메트릭 집계 트리거 (asyncio 병렬, semaphore=20)"""
    return scheduler_tasks._trigger_aggregation("hourly", aggregation_processor.run_hourly_aggregation)


@app.post("/aggregation/daily/trigger")
async def trigger_daily():
    """WF7 호출용 — 전일 시간별 집계 → 일별 롤업 트리거"""
    return scheduler_tasks._trigger_aggregation("daily", aggregation_processor.run_daily_aggregation)


@app.post("/aggregation/weekly/trigger")
async def trigger_weekly():
    """WF8 호출용 — 전주 일별 집계 → 주간 리포트 + Teams 발송 트리거"""
    return scheduler_tasks._trigger_aggregation("weekly", aggregation_processor.run_weekly_report)


@app.post("/aggregation/monthly/trigger")
async def trigger_monthly():
    """WF9 호출용 — 전월 주별 집계 → 월간 리포트 + Teams 발송 트리거"""
    return scheduler_tasks._trigger_aggregation("monthly", aggregation_processor.run_monthly_report)


@app.post("/aggregation/longperiod/trigger")
async def trigger_longperiod():
    """WF10 호출용 — 분기/반기/연간 리포트 + Teams 발송 트리거"""
    return scheduler_tasks._trigger_aggregation("longperiod", aggregation_processor.run_longperiod_report)


@app.post("/aggregation/trend/trigger")
async def trigger_trend():
    """WF11 호출용 — 지속 이상 시스템 추세 분석 + Teams 프로액티브 알림 트리거"""
    return scheduler_tasks._trigger_aggregation("trend", aggregation_processor.run_trend_alert)


@app.get("/aggregation/status")
async def aggregation_status():
    """WF6~WF11 집계 실행 상태 일괄 조회 (프론트엔드 타입 호환)"""
    result = {}
    for name in scheduler_tasks._AGG_TYPES:
        run = scheduler_tasks._agg_last_run[name]
        finished = run.get("finished_at")
        run_result = run.get("result")
        if run_result is None:
            last_status = None
        elif isinstance(run_result, dict) and run_result.get("error"):
            last_status = "error"
        else:
            last_status = "ok"
        result[name] = {
            "running": scheduler_tasks._agg_running[name],
            "last_run": finished,
            "last_status": last_status,
            "error_message": str(run_result.get("error")) if isinstance(run_result, dict) and run_result.get("error") else None,
        }
    return result


@app.post("/aggregation/store-summary")
async def store_agg_summary(req: StoreAggSummaryRequest):
    """
    WF7-WF10 호출용 — 일/주/월 집계 요약을 임베딩 후 aggregation_summaries에 저장.
    point_id 반환.
    """
    embedding, sparse = await asyncio.gather(
        vector_client.get_embedding(req.summary_text),
        vector_client.get_sparse_vector(req.summary_text),
    )
    point_id = await aggregation_vector_client.store_aggregation_summary_vector(
        embedding=embedding,
        sparse=sparse,
        system_id=req.system_id,
        system_name=req.system_name,
        period_type=req.period_type,
        period_start=req.period_start,
        summary_text=req.summary_text,
        dominant_severity=req.dominant_severity,
        pg_row_id=req.pg_row_id,
    )
    return {"point_id": point_id}


# ── V1 Knowledge: 검색 / 문서 임베딩 / 운영자 노트 / 피드백 ──────────────────


class KnowledgeSearchRequest(BaseModel):
    query:           str
    system_ids:      list[int] | None = None
    system_id:       int | None = None  # deprecated, kept for BC; system_ids takes priority
    system_name:     str | None = None
    sources:         list[str] | None = None   # ["jira","confluence","documents"]
    limit:           int = 10
    rerank:          bool = False
    rerank_top_k:    int = 10
    score_threshold: float = 0.5             # dense prefetch 최소 유사도
    with_scores:     bool = False            # Track C: dense/sparse 개별 점수 병합


@app.post("/knowledge/search")
async def knowledge_search(req: KnowledgeSearchRequest):
    """
    V1 Knowledge 3종 컬렉션 federated 검색.
    jira / confluence / documents 에서 병렬 Hybrid 검색 → 2차 RRF 병합
    → corrected 보너스 → (옵션) reranker.

    admin-api chat_tools 또는 프론트엔드에서 호출.
    """
    try:
        result = await knowledge_vector_client.federated_search(
            req.query,
            system_ids=req.system_ids,
            system_id=req.system_id,
            system_name=req.system_name,
            sources=req.sources,
            limit=req.limit,
            rerank=req.rerank,
            rerank_top_k=req.rerank_top_k,
            score_threshold=req.score_threshold,
            with_scores=req.with_scores,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Knowledge 검색 실패: {exc}")
    # uint64 point_id는 JS Number 정밀도를 초과하므로 문자열로 직렬화
    for item in result.get("results", []):
        if "point_id" in item and item["point_id"] is not None:
            item["point_id"] = str(item["point_id"])
    return result


class EmbedTextRequest(BaseModel):
    text: str


@app.post("/embed/text")
async def embed_text(req: EmbedTextRequest):
    """단일 텍스트 임베딩 반환. admin-api 질문 클러스터링용."""
    embedding = await vector_client.get_embedding(req.text)
    return {"embedding": embedding}


class EmbedBatchRequest(BaseModel):
    texts: list[str]


@app.post("/embed/batch")
async def embed_batch(req: EmbedBatchRequest):
    """복수 텍스트 배치 임베딩 반환. ONNX 1회 추론으로 처리."""
    embeddings = await vector_client.get_embedding_batch(req.texts)
    return {"embeddings": embeddings}


class EmbedDocumentRequest(BaseModel):
    file_path: str
    doc_type:  str        # docx / pdf / xlsx / pptx
    system_id: int
    tags:      list[str] | None = None


# 임베딩 Job 인메모리 추적
_embed_jobs: dict[str, dict] = {}


async def _do_embed_task(job_id: str, req: EmbedDocumentRequest) -> None:
    """비동기 백그라운드 임베딩 작업."""
    import chunking

    _embed_jobs[job_id]["status"] = "embedding"
    doc_type = req.doc_type.lower()

    ocr_stats = chunking.make_ocr_stats()

    def _chunk_text_file() -> list[dict]:
        import pathlib
        text = pathlib.Path(req.file_path).read_text(encoding="utf-8", errors="replace")
        return chunking.chunk_text(text, base_metadata={"source_type": doc_type})

    chunkers = {
        "docx": lambda: chunking.chunk_docx(req.file_path, stats=ocr_stats),
        "pdf":  lambda: chunking.chunk_pdf(req.file_path, stats=ocr_stats),
        "xlsx": lambda: chunking.chunk_xlsx(req.file_path, stats=ocr_stats),
        "pptx": lambda: chunking.chunk_pptx(req.file_path, stats=ocr_stats),
        "txt":  _chunk_text_file,
        "md":   _chunk_text_file,
    }

    if doc_type not in chunkers:
        _embed_jobs[job_id].update({"status": "error", "error": f"지원하지 않는 doc_type: {doc_type}"})
        return

    try:
        chunks = chunkers[doc_type]()
    except Exception as exc:
        _embed_jobs[job_id].update({"status": "error", "error": f"청킹 실패: {exc}"})
        return

    if not chunks:
        _embed_jobs[job_id].update({"status": "done", "point_count": 0, "ocr_stats": ocr_stats})
        return

    file_name = os.path.basename(req.file_path)
    try:
        point_count = await knowledge_vector_client.upsert_document_chunks(
            file_name=file_name,
            doc_type=doc_type,
            system_id=req.system_id,
            chunks=chunks,
            tags=req.tags,
        )
        _embed_jobs[job_id].update({"status": "done", "point_count": point_count, "file_name": file_name, "ocr_stats": ocr_stats})
    except Exception as exc:
        _embed_jobs[job_id].update({"status": "error", "error": f"임베딩 저장 실패: {exc}"})


@app.post("/embed/document")
async def embed_document(req: EmbedDocumentRequest, background_tasks: BackgroundTasks):
    """
    admin-api 문서 업로드 → 비동기 청킹/임베딩 → knowledge_documents 저장.
    즉시 job_id 반환 (status: queued). GET /embed/jobs/{job_id} 로 폴링.
    """
    job_id = str(uuid.uuid4())
    _embed_jobs[job_id] = {"job_id": job_id, "status": "queued"}
    background_tasks.add_task(_do_embed_task, job_id, req)
    return {"job_id": job_id, "status": "queued"}


@app.get("/embed/jobs/{job_id}")
async def get_embed_job(job_id: str):
    """임베딩 Job 상태 조회. status: queued | embedding | done | error"""
    job = _embed_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job을 찾을 수 없습니다.")
    return job


class OperatorNoteRequest(BaseModel):
    question:         str
    answer:           str
    system_id:        int
    source_reference: str | None = None
    tags:             list[str] | None = None
    created_by:       str | None = None


@app.get("/knowledge/operator-notes")
async def list_operator_notes(
    system_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
):
    """운영자 노트 목록 조회 (Qdrant scroll, doc_type=operator_note)."""
    return await knowledge_vector_client.scroll_operator_notes(
        system_id=system_id,
        limit=min(limit, 100),
        offset=offset,
    )


@app.post("/knowledge/operator-note")
async def add_operator_note(req: OperatorNoteRequest):
    """운영자 노트(Q&A) 등록 → knowledge_documents(doc_type=operator_note) 저장."""
    try:
        point_id = await knowledge_vector_client.upsert_operator_note(
            question=req.question,
            answer=req.answer,
            system_id=req.system_id,
            source_reference=req.source_reference,
            tags=req.tags,
            created_by=req.created_by,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"운영자 노트 저장 실패: {exc}")
    return {"point_id": str(point_id)}


class OperatorNoteUpdateRequest(BaseModel):
    question:         str | None = None
    answer:           str | None = None
    system_id:        int | None = None
    source_reference: str | None = None
    tags:             list[str] | None = None


@app.patch("/knowledge/operator-note/{point_id}")
async def patch_operator_note(point_id: str, req: OperatorNoteUpdateRequest):
    """운영자 노트 수정 — Qdrant payload set_payload.

    point_id 는 uint64 문자열로 수신 (JS Number 정밀도 손실 방지).
    내부 Qdrant 호출은 int 변환 후 전달.
    """
    try:
        point_id_int = int(point_id)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"point_id가 유효한 정수가 아닙니다: {point_id}")
    fields = req.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="수정할 필드가 없습니다")
    try:
        ok = await knowledge_vector_client.update_operator_note(point_id=point_id_int, **fields)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"운영자 노트 수정 실패: {exc}")
    if not ok:
        raise HTTPException(status_code=404, detail=f"운영자 노트 없음: {point_id}")
    return {"ok": True, "point_id": point_id}


@app.delete("/knowledge/operator-note/{point_id}")
async def delete_operator_note_route(point_id: str):
    """운영자 노트 삭제 — Qdrant 포인트 제거.

    point_id 는 uint64 문자열로 수신 (JS Number 정밀도 손실 방지).
    내부 Qdrant 호출은 int 변환 후 전달.
    """
    try:
        point_id_int = int(point_id)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"point_id가 유효한 정수가 아닙니다: {point_id}")
    try:
        ok = await knowledge_vector_client.delete_operator_note(point_id=point_id_int)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"운영자 노트 삭제 실패: {exc}")
    if not ok:
        raise HTTPException(status_code=404, detail=f"운영자 노트 없음: {point_id}")
    return {"ok": True, "point_id": point_id}


class CorrectionRequest(BaseModel):
    point_id:        str   # uint64 문자열 (JS Number 정밀도 손실 방지)
    collection:      str
    correction_text: str


@app.post("/knowledge/correction")
async def apply_correction_endpoint(req: CorrectionRequest):
    """검색 결과 피드백 적용 — corrected=True + correction_text Qdrant 저장."""
    try:
        point_id_int = int(req.point_id)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"point_id가 유효한 정수가 아닙니다: {req.point_id}")
    ok = await knowledge_vector_client.apply_correction(
        point_id=point_id_int,
        collection=req.collection,
        correction_text=req.correction_text,
    )
    return {"ok": ok}


# ── V1 Knowledge: 동기화 수동 트리거 ──────────────────────────────────────────

@app.post("/knowledge/sync/jira/trigger")
async def trigger_jira_sync():
    """Jira 동기화 즉시 실행 (관리/테스트용)."""
    asyncio.create_task(scheduler_tasks._jira_sync_run())
    return {"status": "triggered", "source": "jira"}


@app.post("/knowledge/sync/confluence/trigger")
async def trigger_confluence_sync():
    """Confluence 동기화 즉시 실행 (관리/테스트용)."""
    asyncio.create_task(scheduler_tasks._confluence_sync_run())
    return {"status": "triggered", "source": "confluence"}


@app.post("/knowledge/sync/jira/{issue_key}/force")
async def force_sync_jira_issue(issue_key: str) -> dict:
    """Jira 단건 이슈 강제 재동기화. 완료까지 대기 후 결과 반환."""
    if not (scheduler_tasks.JIRA_URL and scheduler_tasks.JIRA_TOKEN):
        raise HTTPException(status_code=503, detail="Jira 환경변수 미설정")
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {scheduler_tasks.JIRA_TOKEN}", "Accept": "application/json"},
        ) as client:
            resp = await client.get(
                f"{scheduler_tasks.JIRA_URL}/rest/api/2/issue/{issue_key}",
                params={"fields": scheduler_tasks._JIRA_FIELDS},
            )
            resp.raise_for_status()
            issue = resp.json()
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 404:
            raise HTTPException(status_code=404, detail=f"Jira 이슈를 찾을 수 없음: {issue_key}")
        raise HTTPException(status_code=502, detail=f"Jira API 오류: {code}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jira 연결 실패: {str(exc)[:200]}")
    try:
        await knowledge_vector_client.upsert_jira_issue(**scheduler_tasks._issue_to_upsert_kwargs(issue))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Qdrant upsert 실패: {str(exc)[:200]}")
    logger.info("Jira force sync 완료: %s", issue_key)
    return {"synced": True, "issue_key": issue_key}


@app.post("/knowledge/sync/confluence/{page_id}/force")
async def force_sync_confluence_page(page_id: str) -> dict:
    """Confluence 단건 페이지 강제 재동기화. 완료까지 대기 후 결과 반환."""
    if not (scheduler_tasks.CONFLUENCE_URL and scheduler_tasks.CONFLUENCE_TOKEN):
        raise HTTPException(status_code=503, detail="Confluence 환경변수 미설정")
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            headers={"Authorization": f"Bearer {scheduler_tasks.CONFLUENCE_TOKEN}", "Accept": "application/json"},
        ) as client:
            resp = await client.get(
                f"{scheduler_tasks.CONFLUENCE_URL}/rest/api/content/{page_id}",
                params={"expand": "body.storage,space,version"},
            )
            resp.raise_for_status()
            page = resp.json()
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 404:
            raise HTTPException(status_code=404, detail=f"Confluence 페이지를 찾을 수 없음: {page_id}")
        raise HTTPException(status_code=502, detail=f"Confluence API 오류: {code}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Confluence 연결 실패: {str(exc)[:200]}")
    import chunking  # noqa: PLC0415
    page_title = page.get("title", "")
    space_key = page.get("space", {}).get("key", "")
    html_content = page.get("body", {}).get("storage", {}).get("value", "") or ""
    page_url = f"{scheduler_tasks.CONFLUENCE_URL}/pages/{page_id}"
    try:
        chunks = chunking.chunk_confluence_page(
            content=html_content, page_id=page_id, page_title=page_title, space=space_key,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Confluence 청킹 실패: {str(exc)[:200]}")
    try:
        await knowledge_vector_client.delete_confluence_chunks_by_page_id(page_id)
        n = await knowledge_vector_client.upsert_confluence_chunks(
            page_id=page_id, page_title=page_title, space=space_key, chunks=chunks, url=page_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Qdrant upsert 실패: {str(exc)[:200]}")
    logger.info("Confluence force sync 완료: page_id=%s, chunks=%d", page_id, n)
    return {"synced": True, "page_id": page_id, "synced_chunks": n}


# ── V1 Knowledge: 삭제 감지 purge 수동 트리거 ────────────────────────────────

@app.post("/knowledge/cleanup/jira/trigger")
async def trigger_jira_cleanup(dry_run: bool = False):
    """Jira Qdrant cleanup 즉시 실행 (관리/테스트용).

    dry_run=True 이면 삭제 없이 후보 카운트만 반환.
    """
    asyncio.create_task(scheduler_tasks._jira_cleanup_run(dry_run=dry_run))
    return {"status": "triggered", "source": "jira", "dry_run": dry_run}


@app.post("/knowledge/cleanup/confluence/trigger")
async def trigger_confluence_cleanup(dry_run: bool = False):
    """Confluence Qdrant cleanup 즉시 실행 (관리/테스트용).

    dry_run=True 이면 삭제 없이 후보 카운트만 반환.
    """
    asyncio.create_task(scheduler_tasks._confluence_cleanup_run(dry_run=dry_run))
    return {"status": "triggered", "source": "confluence", "dry_run": dry_run}


# ── V1 Knowledge: 문서 목록 조회 / 일괄 삭제 ──────────────────────────────────

@app.get("/knowledge/documents")
async def list_documents_endpoint(system_id: int | None = None):
    """
    knowledge_documents 컬렉션에 적재된 문서 목록 조회 (file_hash 단위 그룹핑).
    operator_note 제외. system_id 지정 시 해당 시스템 문서만 반환.

    Response: {"items": [{"file_hash", "file_name", "system_id", "chunk_count", "uploaded_at"}]}
    """
    try:
        items = await knowledge_vector_client.list_documents(system_id=system_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"문서 목록 조회 실패: {exc}")
    return {"items": items}


@app.get("/knowledge/documents/{file_hash}/chunks")
async def get_document_chunks_endpoint(
    file_hash: str,
    chunk_indexes: list[int] | None = Query(default=None),
):
    """
    file_hash 기반 문서 청크 조회 (point_id, text, metadata 포함, chunk_index 오름차순).
    chunk_indexes 지정 시 해당 인덱스 청크만 반환 (예: ?chunk_indexes=2&chunk_indexes=4).
    Response: {"chunks": [{point_id, chunk_index, text, stored_at, ...}]}
    """
    try:
        chunks = await knowledge_vector_client.get_document_chunks(
            file_hash, chunk_indexes=chunk_indexes,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"청크 조회 실패: {exc}")
    return {"chunks": chunks}


@app.get("/knowledge/confluence/{page_id}/chunks")
async def get_confluence_chunks_endpoint(
    page_id: str,
    chunk_indexes: list[int] | None = Query(default=None),
    max_chunks: int = 50,
):
    """
    page_id 기반 Confluence 청크 조회 (chunk_index 오름차순).
    chunk_indexes 지정 시 해당 인덱스 청크만 반환.
    Response: {"page_id", "chunks": [{point_id, chunk_index, text, page_title, ...}]}
    """
    try:
        chunks = await knowledge_vector_client.get_confluence_chunks(
            page_id,
            chunk_indexes=chunk_indexes,
            max_chunks=max_chunks,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"청크 조회 실패: {exc}")
    return {"page_id": page_id, "chunks": chunks}


@app.delete("/knowledge/documents/{file_hash}")
async def delete_document_endpoint(file_hash: str):
    """
    file_hash 기반 문서 청크 일괄 삭제 + 디스크 원본 파일 삭제.

    1. Qdrant에서 해당 file_hash의 모든 포인트 삭제
    2. KNOWLEDGE_DOCS_DIR 하위에서 file_name 일치 파일 삭제
       (디스크 삭제 실패해도 deleted_points 는 반환)

    Response: {"deleted_points": int, "deleted_file": bool}
    """
    import pathlib

    # Qdrant 포인트 삭제 전 file_name 조회 (삭제 후엔 payload 접근 불가)
    file_name: str | None = None
    system_id_found: int | None = None
    try:
        scroll_resp = await knowledge_vector_client._qdrant_http.post(
            f"{knowledge_vector_client.QDRANT_URL}/collections/{knowledge_vector_client.DOCUMENTS_COLLECTION}/points/scroll",
            json={
                "filter": {"must": [{"key": "file_hash", "match": {"value": file_hash}}]},
                "limit": 1,
                "with_payload": True,
                "with_vector": False,
            },
        )
        scroll_resp.raise_for_status()
        pts = scroll_resp.json().get("result", {}).get("points", [])
        if pts:
            pl = pts[0].get("payload", {})
            file_name = pl.get("file_name")
            system_id_found = pl.get("system_id")
    except Exception as exc:
        logger.warning("문서 삭제 전 file_name 조회 실패 file_hash=%s: %s", file_hash, exc)

    # Qdrant 청크 삭제
    try:
        deleted_points = await knowledge_vector_client.delete_document_chunks_by_file_hash(file_hash)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Qdrant 청크 삭제 실패: {exc}")

    # 디스크 원본 파일 삭제
    deleted_file = False
    if file_name:
        # admin-api 저장 구조: KNOWLEDGE_DOCS_DIR/{system_id}/{file_name}
        search_dirs: list[pathlib.Path] = []
        if system_id_found is not None:
            search_dirs.append(pathlib.Path(KNOWLEDGE_DOCS_DIR) / str(system_id_found))
        # system_id 불명 시 하위 전체 탐색
        docs_root = pathlib.Path(KNOWLEDGE_DOCS_DIR)
        if docs_root.exists() and not search_dirs:
            search_dirs = [d for d in docs_root.iterdir() if d.is_dir()]

        for dir_path in search_dirs:
            candidate = dir_path / file_name
            if candidate.exists():
                try:
                    candidate.unlink()
                    deleted_file = True
                    logger.info("문서 원본 파일 삭제: %s", candidate)
                except Exception as exc:
                    logger.warning("문서 원본 파일 삭제 실패 %s: %s", candidate, exc)
                break

    return {"deleted_points": deleted_points, "deleted_file": deleted_file}
