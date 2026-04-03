import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base
from routes import alerts, analysis, contacts, feedback, systems
from routes import collector_config, aggregations, reports


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(systems.router)
app.include_router(contacts.router)
app.include_router(alerts.router)
app.include_router(analysis.router)
app.include_router(feedback.router)
app.include_router(collector_config.router)
app.include_router(aggregations.router)
app.include_router(reports.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
