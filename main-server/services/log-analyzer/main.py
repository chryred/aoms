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

from fastapi import FastAPI

import analyzer

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
