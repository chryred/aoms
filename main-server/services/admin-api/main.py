import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base
from routes import alerts, analysis, contacts, feedback, systems
from routes import collector_config, aggregations, reports, auth as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 테이블 자동 생성 (운영에서는 init.sql / Alembic 사용 권장)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="AOMS Admin API",
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
app.include_router(collector_config.prometheus_router)
app.include_router(aggregations.router)
app.include_router(reports.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
