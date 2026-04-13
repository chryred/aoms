import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

from database import engine, Base, AsyncSessionLocal
from routes import alerts, analysis, contacts, feedback, systems
from routes import collector_config, aggregations, reports, auth as auth_router
from routes import agents as agents_router, dashboard, websocket
from services.ssh_session import run_cleanup_loop
from services.prometheus_analyzer import run_prometheus_analyzer_loop
from services.db_collector import db_collection_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 테이블 자동 생성 (운영에서는 init.sql / Alembic 사용 권장)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # SSH 세션 만료 정리 루프 시작
    cleanup_task = asyncio.create_task(run_cleanup_loop())
    # Prometheus 메트릭 자동 분석 루프 (PROMETHEUS_URL 설정 시 활성화)
    analyzer_task = asyncio.create_task(run_prometheus_analyzer_loop())
    # DB 메트릭 수집 루프 (DB_ENCRYPTION_KEY 설정 시 활성화)
    db_task = None
    if os.getenv("DB_ENCRYPTION_KEY"):
        db_task = asyncio.create_task(db_collection_loop(AsyncSessionLocal))
    yield
    cleanup_task.cancel()
    analyzer_task.cancel()
    if db_task:
        db_task.cancel()


app = FastAPI(
    title="Synapse Admin API",
    description="백화점 통합 모니터링 시스템 - 관리 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: CORS_ORIGINS 환경변수로 허용 도메인 지정 (콤마 구분)
# allow_credentials=True 필수 — httpOnly refresh 쿠키 전달을 위해 와일드카드 불가
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth_router.router)
app.include_router(systems.router)
app.include_router(contacts.router)
app.include_router(alerts.router)
app.include_router(analysis.router)
app.include_router(feedback.router)
app.include_router(collector_config.router)
app.include_router(aggregations.router)
app.include_router(aggregations._metrics_router)
app.include_router(reports.router)
app.include_router(agents_router.router)
app.include_router(dashboard.router)
app.include_router(websocket.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    """Prometheus scrape 엔드포인트 — db_collector Gauge 값 노출."""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
