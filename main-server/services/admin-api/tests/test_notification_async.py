"""spawn_teams_send — 세마포어 가드 비동기 Teams 발송 회귀 테스트.

느린/죽은 웹훅이 분석 쓰기 경로를 막지 않도록 발송을 fire-and-forget으로 돌리고,
동시성 상한(세마포어)으로 태스크 누적을 막으며, 예외는 삼켜 호출측에 영향이 없어야 한다.
"""
import asyncio

from services import notification


async def test_spawn_is_nonblocking_and_runs_in_background():
    ran = asyncio.Event()

    async def _job():
        ran.set()

    # 즉시 반환(블로킹 아님) — 스폰 시점엔 아직 실행 전
    notification.spawn_teams_send(_job(), label="t")
    assert not ran.is_set()
    await asyncio.sleep(0.02)   # 이벤트 루프에 제어를 넘기면 백그라운드로 실행됨
    assert ran.is_set()


async def test_spawn_swallows_exceptions():
    async def _boom():
        raise RuntimeError("webhook down")

    # 예외가 호출측으로 전파되지 않아야 함 (best-effort)
    notification.spawn_teams_send(_boom(), label="boom")
    await asyncio.sleep(0.02)   # 태스크가 돌며 예외를 삼킴 — 여기서 raise 없으면 통과


async def test_spawn_respects_concurrency_cap(monkeypatch):
    # 상한을 2로 낮춰, 3개 스폰 시 동시에 최대 2개만 실행되는지 확인
    monkeypatch.setattr(notification, "_teams_send_sem", asyncio.Semaphore(2))
    active = 0
    peak = 0

    async def _job():
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.03)
        active -= 1

    for _ in range(3):
        notification.spawn_teams_send(_job(), label="cap")
    await asyncio.sleep(0.1)
    assert peak <= 2
