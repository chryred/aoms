import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

from database import engine, Base, AsyncSessionLocal
from routes import alerts, analysis, contacts, feedback, systems
from routes import collector_config, aggregations, reports, auth as auth_router
from routes import agents as agents_router, agents_control as agents_control_router, dashboard, websocket, llm_config, traces as traces_router
from routes import incidents as incidents_router
from routes import chat, chat_attachments, chat_tools as chat_tools_router, chat_executor_configs
from routes import alert_exclusions as alert_exclusions_router
from routes import metric_exclusions as metric_exclusions_router
from routes import llm_query as llm_query_router
from routes import scheduler_runs as scheduler_runs_router
from routes import knowledge as knowledge_router
from routes import knowledge_verify as knowledge_verify_router
from routes import help as help_router
from routes import oauth as oauth_router
from routes import guides as guides_router
from routes import ssl_servers as ssl_servers_router
from routes import ssl_deployments as ssl_deployments_router
from routes import ssl_certs as ssl_certs_router
from routes import ssl_websocket as ssl_websocket_router
from routes import ssl_root_ca as ssl_root_ca_router
from routes import ssl_dmz as ssl_dmz_router
from services.ssh_session import run_cleanup_loop
# knowledge_guides 컬렉션 초기화는 ADR-011 Hybrid 통일 이후 log-analyzer가 담당.
# admin-api 측 qdrant_guides.ensure_collection 은 호환을 위해 noop으로 유지된다.
from services.prometheus_analyzer import run_prometheus_analyzer_loop
from services.db_collector import db_collection_loop
from services.ssl_scheduler import run_ssl_scheduler_loop
from services.chat_tools.executors.ems import aclose_client as ems_aclose


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 테이블 자동 생성 (운영에서는 init.sql / Alembic 사용 권장)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # knowledge_guides 컬렉션 ensure는 log-analyzer lifespan이 담당 (ADR-011)
    # SSH 세션 만료 정리 루프 시작
    cleanup_task = asyncio.create_task(run_cleanup_loop())
    # Prometheus 메트릭 자동 분석 루프 (PROMETHEUS_URL 설정 시 활성화)
    analyzer_task = asyncio.create_task(run_prometheus_analyzer_loop())
    # DB 메트릭 수집 루프 (ENCRYPTION_KEY 설정 시 활성화)
    db_task = None
    if os.getenv("ENCRYPTION_KEY"):
        db_task = asyncio.create_task(db_collection_loop(AsyncSessionLocal))
    # SSL 인증서 자동 갱신 배치 (매일 02:00 KST)
    ssl_task = asyncio.create_task(run_ssl_scheduler_loop())
    yield
    cleanup_task.cancel()
    analyzer_task.cancel()
    ssl_task.cancel()
    if db_task:
        db_task.cancel()
    # EMS 싱글톤 httpx 클라이언트 정리
    try:
        await ems_aclose()
    except Exception:
        logger.warning("EMS aclose failed during shutdown", exc_info=True)


app = FastAPI(
    title="Synapse Admin API",
    description="백화점 통합 모니터링 시스템 - 관리 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: CORS_ORIGINS 환경변수로 허용 도메인 지정 (콤마 구분)
# allow_credentials=True 필수 — httpOnly refresh 쿠키 전달을 위해 와일드카드 불가
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-SSH-Session"],
    allow_credentials=True,
)

app.include_router(auth_router.router)
app.include_router(systems.router)
app.include_router(contacts.router)
app.include_router(alerts.router)
app.include_router(analysis.router)
app.include_router(incidents_router.router)
app.include_router(feedback.router)
app.include_router(collector_config.router)
app.include_router(aggregations.router)
app.include_router(aggregations._metrics_router)
app.include_router(reports.router)
app.include_router(agents_router.router)
app.include_router(agents_control_router.router)
app.include_router(dashboard.router)
app.include_router(websocket.router)
app.include_router(llm_config.router)
app.include_router(traces_router.router)
app.include_router(chat.router)
app.include_router(chat_attachments.router)
app.include_router(chat_tools_router.router)
app.include_router(chat_executor_configs.router)
app.include_router(alert_exclusions_router.router)
app.include_router(metric_exclusions_router.router)
app.include_router(llm_query_router.router)
app.include_router(scheduler_runs_router.router)
app.include_router(knowledge_router.router)
app.include_router(knowledge_verify_router.router, prefix="/api/v1/knowledge")
app.include_router(help_router.router)
app.include_router(oauth_router.router)  # OIDC IdP (ADR-014): /.well-known, /oauth/*, /api/v1/oauth/*
app.include_router(guides_router.router)
app.include_router(ssl_servers_router.router)
app.include_router(ssl_deployments_router.router)
app.include_router(ssl_certs_router.router)
app.include_router(ssl_websocket_router.router)
app.include_router(ssl_root_ca_router.router)
app.include_router(ssl_dmz_router.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    """Prometheus scrape 엔드포인트 — db_collector Gauge 값 노출."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
