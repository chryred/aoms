"""Feature 8: 챗봇 세션 검색 — 메시지 본문 매칭 + 미리보기 단위 테스트."""

import pytest
from httpx import AsyncClient

from models import ChatMessage, ChatSession


# ── _build_match_preview 단위 테스트 ──────────────────────────────────────────

def test_build_match_preview_basic():
    from routes.chat import _build_match_preview

    text = "OOM 발생 시 heap dump 수집해야 합니다. 그리고 GC 로그도 확인해야 합니다."
    p = _build_match_preview(text, "heap")
    assert "heap" in p.lower()
    # 120자 + 말줄임표(…) 여유 허용
    assert len(p) <= 130


def test_build_match_preview_match_at_start():
    from routes.chat import _build_match_preview

    text = "heap dump 파일은 /tmp 에 저장됩니다."
    p = _build_match_preview(text, "heap")
    assert "heap" in p.lower()
    # 시작 부분 매칭 — 앞 말줄임표 없어야 함
    assert not p.startswith("…")


def test_build_match_preview_no_match_returns_start():
    from routes.chat import _build_match_preview

    text = "긴 본문 내용입니다."
    p = _build_match_preview(text, "없는단어xyz")
    # 매칭 없으면 본문 앞부분 반환
    assert isinstance(p, str)
    assert len(p) > 0


def test_build_match_preview_max_length():
    from routes.chat import _build_match_preview

    # 매우 긴 내용에서 중간 부분 매칭 → 잘림 확인
    text = "A" * 200 + " target " + "B" * 200
    p = _build_match_preview(text, "target")
    assert "target" in p
    assert len(p) <= 130  # max_total(120) + "…" 여유


def test_build_match_preview_newlines_flattened():
    from routes.chat import _build_match_preview

    text = "첫 줄\n두 번째 줄\ntarget 키워드\n네 번째 줄"
    p = _build_match_preview(text, "target")
    # 줄바꿈이 공백으로 치환되어 단일 줄 미리보기
    assert "\n" not in p
    assert "target" in p


# ── HTTP 엔드포인트 — 메시지 본문 검색 ────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_matches_session_title(authed_client: AsyncClient, db_session):
    """제목 매칭 시 matched_in='title', match_preview=None."""
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    assert resp.status_code == 201
    sid = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid}", json={"title": "CPU 급증 분석"})

    resp = await authed_client.get("/api/v1/chat/sessions?q=CPU")
    assert resp.status_code == 200
    data = resp.json()
    matched = [s for s in data if s["id"] == sid]
    assert len(matched) == 1
    assert matched[0]["matched_in"] == "title"
    assert matched[0]["match_preview"] is None


@pytest.mark.asyncio
async def test_search_matches_message_content(authed_client: AsyncClient, db_session):
    """메시지 본문 매칭 시 matched_in='message', match_preview에 검색어 포함."""
    # 제목에는 검색어 없는 세션 생성
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    assert resp.status_code == 201
    sid = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid}", json={"title": "일반 대화"})

    # 메시지 직접 DB 삽입
    msg = ChatMessage(
        session_id=sid,
        role="user",
        content="OOM 발생 시 heap dump 수집해야 합니다.",
    )
    db_session.add(msg)
    await db_session.commit()

    resp = await authed_client.get("/api/v1/chat/sessions?q=heap")
    assert resp.status_code == 200
    data = resp.json()
    matched = [s for s in data if s["id"] == sid]
    assert len(matched) == 1
    s = matched[0]
    assert s["matched_in"] == "message"
    assert s["match_preview"] is not None
    assert "heap" in s["match_preview"].lower()


@pytest.mark.asyncio
async def test_search_no_q_returns_sessions_without_match_info(authed_client: AsyncClient):
    """검색어 없으면 matched_in=None, match_preview=None."""
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    assert resp.status_code == 201

    resp = await authed_client.get("/api/v1/chat/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    for s in data:
        assert s["matched_in"] is None
        assert s["match_preview"] is None


@pytest.mark.asyncio
async def test_search_excludes_non_matching_sessions(authed_client: AsyncClient, db_session):
    """검색어가 제목에도 메시지에도 없는 세션은 결과에서 제외."""
    # 매칭될 세션
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    sid_match = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid_match}", json={"title": "heap 분석"})

    # 매칭 안 될 세션
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    sid_no_match = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid_no_match}", json={"title": "디스크 점검"})

    resp = await authed_client.get("/api/v1/chat/sessions?q=heap")
    data = resp.json()
    ids = [s["id"] for s in data]
    assert sid_match in ids
    assert sid_no_match not in ids


@pytest.mark.asyncio
async def test_search_title_takes_priority_over_message(authed_client: AsyncClient, db_session):
    """제목과 메시지 모두 매칭될 때 matched_in='title'."""
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    assert resp.status_code == 201
    sid = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid}", json={"title": "heap 분석 세션"})

    # 메시지에도 heap 포함
    msg = ChatMessage(
        session_id=sid,
        role="user",
        content="heap dump를 분석합니다.",
    )
    db_session.add(msg)
    await db_session.commit()

    resp = await authed_client.get("/api/v1/chat/sessions?q=heap")
    data = resp.json()
    matched = [s for s in data if s["id"] == sid]
    assert len(matched) == 1
    # 제목 매칭 우선
    assert matched[0]["matched_in"] == "title"
    assert matched[0]["match_preview"] is None
