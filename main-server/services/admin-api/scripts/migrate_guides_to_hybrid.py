"""knowledge_guides 컬렉션 마이그레이션 — Dense-only → Hybrid (1회용).

기존 admin-api에서 직접 인덱싱하던 knowledge_guides 컬렉션을 log-analyzer가 관리하는
Hybrid(Dense+BM25) 컬렉션으로 재인덱싱한다.

수행 절차:
  1. 기존 knowledge_guides 컬렉션 삭제 (Qdrant 차원/스파스 추가 불가하므로 재생성 필수)
  2. log-analyzer가 새 Hybrid 컬렉션을 자동 ensure (lifespan 진입 또는 첫 호출 시)
  3. PostgreSQL `knowledge_guides` 테이블에서 is_active=true 가이드 모두 조회
  4. 각 가이드를 log-analyzer POST /guides/embed 로 재인덱싱

사용법:
    docker exec -it synapse-admin-api ./venv/bin/python scripts/migrate_guides_to_hybrid.py

옵션 (환경변수):
    QDRANT_URL          — Qdrant API URL (기본: http://server-b:6333)
    LOG_ANALYZER_URL    — log-analyzer API URL (기본: http://log-analyzer:8000)
    DATABASE_URL        — PostgreSQL URL (기본: 컨테이너 환경변수)
    DRY_RUN=1           — 실제 재인덱싱은 하지 않고 대상만 출력
    SKIP_DROP=1         — 기존 컬렉션 삭제 단계 건너뛰기 (이미 Hybrid면 활용)
"""
import asyncio
import logging
import os
import sys

# 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from sqlalchemy import select

from database import AsyncSessionLocal
from models import KnowledgeGuide

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("migrate_guides")

QDRANT_URL = os.getenv("QDRANT_URL", "http://server-b:6333")
LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")
COLLECTION = "knowledge_guides"
DRY_RUN = os.getenv("DRY_RUN") == "1"
SKIP_DROP = os.getenv("SKIP_DROP") == "1"


async def drop_legacy_collection() -> None:
    """기존 Dense-only knowledge_guides 컬렉션 삭제.

    log-analyzer는 컬렉션이 없을 때만 자동으로 Hybrid 신규 생성을 한다
    (`ensure_guides_collection`이 dense-only 잔존 시 경고만 출력하고 재생성 안 함).
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(f"{QDRANT_URL}/collections/{COLLECTION}")
            if resp.status_code == 404:
                logger.info("기존 컬렉션 없음 — 삭제 단계 건너뜀")
                return
            resp.raise_for_status()
        except Exception as exc:
            logger.error("컬렉션 존재 확인 실패: %s", exc)
            return

        if DRY_RUN:
            logger.info("[DRY_RUN] 기존 %s 컬렉션 삭제 (예정)", COLLECTION)
            return

        try:
            del_resp = await client.delete(f"{QDRANT_URL}/collections/{COLLECTION}")
            del_resp.raise_for_status()
            logger.info("기존 %s 컬렉션 삭제 완료", COLLECTION)
        except Exception as exc:
            logger.error("컬렉션 삭제 실패 — 수동 삭제 필요: %s", exc)
            raise


async def ensure_log_analyzer_collection() -> None:
    """log-analyzer에 빈 호출 한 번 — lifespan ensure가 이미 Hybrid 컬렉션을 만들었어야 함.

    검증을 위해 search 빈 쿼리를 호출 (서버가 살아 있고 컬렉션이 준비됐는지 확인).
    """
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            resp = await client.post(
                f"{LOG_ANALYZER_URL}/guides/search",
                json={"query": "", "limit": 1},
            )
            if resp.status_code >= 400:
                logger.warning(
                    "log-analyzer /guides/search 응답 %d — 컬렉션 ensure 확인 필요: %s",
                    resp.status_code, resp.text[:200],
                )
                return
            logger.info("log-analyzer /guides/search 정상 응답 — 컬렉션 준비됨")
        except Exception as exc:
            logger.error("log-analyzer 접근 실패: %s — 서비스 가동 후 재시도하세요", exc)
            raise


async def reindex_all_guides() -> tuple[int, int]:
    """is_active=true 가이드 전체를 log-analyzer로 재인덱싱.

    Returns:
        (success_count, fail_count)
    """
    success = 0
    fail = 0

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(KnowledgeGuide).where(KnowledgeGuide.is_active.is_(True))
            )
        ).scalars().all()
        logger.info("활성 가이드 %d건 발견", len(rows))

        if DRY_RUN:
            for g in rows:
                logger.info(
                    "[DRY_RUN] guide_id=%s system_id=%s title=%s",
                    g.id, g.system_id, g.title[:40],
                )
            return len(rows), 0

        async with httpx.AsyncClient(timeout=30.0) as client:
            for g in rows:
                payload = {
                    "guide_id": str(g.id),
                    "system_id": g.system_id,  # None 가능 (전체 공용 가이드)
                    "title": g.title or "",
                    "content": g.content or "",
                }
                try:
                    resp = await client.post(
                        f"{LOG_ANALYZER_URL}/guides/embed",
                        json=payload,
                    )
                    if resp.status_code >= 400:
                        logger.warning(
                            "guide %s 임베딩 실패 %d: %s",
                            g.id, resp.status_code, resp.text[:200],
                        )
                        fail += 1
                    else:
                        success += 1
                        if success % 10 == 0:
                            logger.info("진행 %d/%d", success, len(rows))
                except Exception as exc:
                    logger.warning("guide %s 임베딩 예외: %s", g.id, str(exc)[:200])
                    fail += 1

    return success, fail


async def main() -> None:
    logger.info("=== knowledge_guides Hybrid 마이그레이션 시작 ===")
    logger.info("QDRANT_URL=%s", QDRANT_URL)
    logger.info("LOG_ANALYZER_URL=%s", LOG_ANALYZER_URL)
    logger.info("DRY_RUN=%s SKIP_DROP=%s", DRY_RUN, SKIP_DROP)

    # 1. 기존 Dense-only 컬렉션 삭제
    if not SKIP_DROP:
        await drop_legacy_collection()
    else:
        logger.info("SKIP_DROP=1 — 기존 컬렉션 삭제 건너뜀")

    # 2. log-analyzer 측 컬렉션 ensure 확인
    await ensure_log_analyzer_collection()

    # 3. 가이드 재인덱싱
    success, fail = await reindex_all_guides()
    logger.info("=== 마이그레이션 완료: 성공 %d / 실패 %d ===", success, fail)


if __name__ == "__main__":
    asyncio.run(main())
