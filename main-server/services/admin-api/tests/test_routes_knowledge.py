"""Knowledge 라우터 단위 테스트 (V1).

log-analyzer 호출은 AsyncMock으로 패치.
DB: SQLite in-memory (conftest.py 공통 fixture 사용).
"""

from __future__ import annotations

import math
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


# ── 인증 없이 접근 차단 ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_knowledge_requires_auth_upload(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/upload",
        files={"file": ("test.pdf", b"PDF", "application/pdf")},
        data={"system_id": "1"},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_knowledge_requires_auth_operator_note(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/operator-note",
        json={"question": "Q", "answer": "A", "system_id": 1},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_knowledge_requires_auth_feedback(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/feedback",
        json={
            "source_point_id": "abc",
            "source_collection": "log_incidents",
            "correct_answer": "올바른 답",
        },
    )
    assert resp.status_code in (401, 403)


# ── 파일 업로드 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_unsupported_type_rejected(authed_client: AsyncClient):
    # _ALLOWED_MIMES: pdf/docx/xlsx/pptx + text/plain + text/markdown.
    # 명백히 지원 외인 타입(image/png)으로 415 검증.
    resp = await authed_client.post(
        "/api/v1/knowledge/upload",
        files={"file": ("test.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        data={"system_id": "1"},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_upload_pdf_accepted(authed_client: AsyncClient, tmp_path):
    """PDF 업로드 → 202 + job_id 반환. log-analyzer 호출은 mock."""
    with patch(
        "services.knowledge_service.call_embed_document",
        new=AsyncMock(return_value={"point_id": "mock-point"}),
    ):
        with patch("routes.knowledge._DOCS_ROOT", str(tmp_path)):
            resp = await authed_client.post(
                "/api/v1/knowledge/upload",
                files={"file": ("manual.pdf", b"%PDF-1.4 content", "application/pdf")},
                data={"system_id": "1", "tags": "manual,ops"},
            )
    assert resp.status_code == 202
    data = resp.json()
    assert "job_id" in data
    assert data["status"] == "queued"


@pytest.mark.asyncio
async def test_upload_status_not_found(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/knowledge/upload/nonexistent-job/status")
    assert resp.status_code == 404


# ── 운영자 노트 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_operator_note_success(authed_client: AsyncClient):
    """log-analyzer가 point_id 반환하는 경우."""
    with patch(
        "routes.knowledge.knowledge_service.call_operator_note",
        new=AsyncMock(return_value="point-uuid-123"),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/operator-note",
            json={
                "question": "배포 절차가 어떻게 되나요?",
                "answer": "Jenkins → staging → prod 순서로 배포합니다.",
                "system_id": 1,
                "tags": ["배포", "운영"],
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["point_id"] == "point-uuid-123"
    assert data["stored"] is True


@pytest.mark.asyncio
async def test_create_operator_note_log_analyzer_unavailable(authed_client: AsyncClient):
    """log-analyzer 미구현(T2 미완) 시 point_id=null이지만 200 계열 반환."""
    with patch(
        "routes.knowledge.knowledge_service.call_operator_note",
        new=AsyncMock(return_value=None),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/operator-note",
            json={"question": "Q", "answer": "A", "system_id": 1},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["point_id"] is None
    assert data["stored"] is False


@pytest.mark.asyncio
async def test_update_operator_note_success(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_update_operator_note",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.patch(
            "/api/v1/knowledge/operator-note/point-uuid-123",
            json={"question": "Q updated", "answer": "A updated"},
        )
    assert resp.status_code == 200
    assert resp.json()["updated"] is True


@pytest.mark.asyncio
async def test_update_operator_note_log_analyzer_fail(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_update_operator_note",
        new=AsyncMock(return_value=False),
    ):
        resp = await authed_client.patch(
            "/api/v1/knowledge/operator-note/bad-point",
            json={"question": "Q", "answer": "A"},
        )
    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_delete_operator_note_success(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_delete_operator_note",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.delete("/api/v1/knowledge/operator-note/point-uuid-123")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_operator_note_fail(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_delete_operator_note",
        new=AsyncMock(return_value=False),
    ):
        resp = await authed_client.delete("/api/v1/knowledge/operator-note/bad-point")
    assert resp.status_code == 502


# ── 피드백 (오답 교정) ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_feedback_success(authed_client: AsyncClient):
    """knowledge_corrections DB insert + log-analyzer 전파 (mock)."""
    with patch(
        "routes.knowledge.knowledge_service.call_correction",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/feedback",
            json={
                "source_point_id": "qdrant-uuid-abc",
                "source_collection": "log_incidents",
                "question": "OOM 이슈 원인이 뭔가요?",
                "wrong_answer": "CPU 과부하",
                "correct_answer": "힙 메모리 부족으로 인한 OOM",
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["source_point_id"] == "qdrant-uuid-abc"
    assert data["stored"] is True
    assert "id" in data


@pytest.mark.asyncio
async def test_create_feedback_minimal(authed_client: AsyncClient):
    """question/wrong_answer 생략해도 correct_answer만으로 등록 가능."""
    with patch(
        "routes.knowledge.knowledge_service.call_correction",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/feedback",
            json={
                "source_point_id": "point-xyz",
                "source_collection": "metric_baselines",
                "correct_answer": "올바른 정보",
            },
        )
    assert resp.status_code == 201


# ── 질문 분석 ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_frequent_questions_empty(authed_client: AsyncClient):
    """chat_messages가 비어있을 때 빈 clusters 반환."""
    with patch(
        "routes.knowledge.knowledge_service.call_embed_text",
        new=AsyncMock(return_value=None),
    ):
        resp = await authed_client.get("/api/v1/knowledge/questions/frequent?days=7&limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "clusters" in data
    assert isinstance(data["clusters"], list)
    assert data["total_questions"] == 0


# ── 동기화 상태 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sync_status_empty(authed_client: AsyncClient):
    """초기 상태 — 빈 목록 반환."""
    resp = await authed_client.get("/api/v1/knowledge/sync-status")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_sync_status_upsert(authed_client: AsyncClient):
    """동기화 상태 upsert 후 조회."""
    # 최초 생성
    resp = await authed_client.post(
        "/api/v1/knowledge/sync-status",
        json={"source": "jira", "total_synced": 42, "last_error": None},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] is True

    # 조회
    resp = await authed_client.get("/api/v1/knowledge/sync-status?source=jira")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["source"] == "jira"
    assert items[0]["total_synced"] == 42

    # 업데이트 (total_synced 변경)
    resp = await authed_client.post(
        "/api/v1/knowledge/sync-status",
        json={"source": "jira", "total_synced": 100},
    )
    assert resp.status_code == 200

    resp = await authed_client.get("/api/v1/knowledge/sync-status?source=jira")
    items = resp.json()
    assert items[0]["total_synced"] == 100


# ── 강제 재동기화 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_force_sync_jira_returns_202(authed_client: AsyncClient):
    """Jira force sync — 즉시 202 + job_id 반환."""
    with patch("routes.knowledge.asyncio.create_task"):
        resp = await authed_client.post("/api/v1/knowledge/sync/jira/PROJ-123/force")
    assert resp.status_code == 202
    body = resp.json()
    assert "job_id" in body
    assert body["status"] == "pending"


@pytest.mark.asyncio
async def test_force_sync_jira_idempotent(authed_client: AsyncClient):
    """같은 (source, ref_id) 재요청 시 기존 job_id 반환 (duplicate=True)."""
    with patch("routes.knowledge.asyncio.create_task"):
        r1 = await authed_client.post("/api/v1/knowledge/sync/jira/PROJ-DUP/force")
        r2 = await authed_client.post("/api/v1/knowledge/sync/jira/PROJ-DUP/force")
    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r1.json()["job_id"] == r2.json()["job_id"]
    assert r2.json().get("duplicate") is True


@pytest.mark.asyncio
async def test_force_sync_confluence_returns_202(authed_client: AsyncClient):
    """Confluence force sync — 즉시 202 + job_id 반환."""
    with patch("routes.knowledge.asyncio.create_task"):
        resp = await authed_client.post("/api/v1/knowledge/sync/confluence/12345/force")
    assert resp.status_code == 202
    body = resp.json()
    assert "job_id" in body
    assert body["status"] == "pending"


@pytest.mark.asyncio
async def test_get_sync_job_not_found(authed_client: AsyncClient):
    """존재하지 않는 job_id 조회 → 404."""
    resp = await authed_client.get("/api/v1/knowledge/sync/jobs/non-existent-job-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_sync_job_found(authed_client: AsyncClient):
    """생성된 Job을 GET으로 조회할 수 있다."""
    with patch("routes.knowledge.asyncio.create_task"):
        create_resp = await authed_client.post("/api/v1/knowledge/sync/jira/PROJ-GET/force")
    assert create_resp.status_code == 202
    job_id = create_resp.json()["job_id"]

    get_resp = await authed_client.get(f"/api/v1/knowledge/sync/jobs/{job_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["job_id"] == job_id
    assert data["source"] == "jira"
    assert data["ref_id"] == "PROJ-GET"
    assert data["status"] in ("pending", "processing", "done", "failed")


@pytest.mark.asyncio
async def test_list_sync_jobs_admin_only(authed_client: AsyncClient):
    """Job 목록은 admin 전용 — authed_client(admin)는 200 반환."""
    resp = await authed_client.get("/api/v1/knowledge/sync/jobs")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert isinstance(body["items"], list)


# ── cluster_questions_by_cosine 클러스터링 유닛 테스트 ────────────────────────

class TestClusterQuestionsByCosine:
    """services.knowledge_service.cluster_questions_by_cosine 직접 테스트."""

    def _make_items(self, embeddings: list[list[float]], contents: list[str]) -> list[dict]:
        return [
            {
                "content": contents[i],
                "exact_count": 1,
                "last_asked_at": None,
                "avg_rag_score": None,
                "embedding": embeddings[i],
            }
            for i in range(len(embeddings))
        ]

    def _unit_vec(self, d: int, angle_deg: float) -> list[float]:
        """2D에서 각도(degree) 기준 단위벡터. 나머지 차원은 0."""
        import math
        rad = math.radians(angle_deg)
        vec = [0.0] * d
        vec[0] = math.cos(rad)
        vec[1] = math.sin(rad)
        return vec

    def test_threshold_0_80_same_cluster(self):
        """cosine > 0.80 두 벡터는 같은 클러스터에 들어간다."""
        from services.knowledge_service import cluster_questions_by_cosine
        # 각도 차이 36° → cosine ≈ 0.809
        v1 = self._unit_vec(4, 0)
        v2 = self._unit_vec(4, 36)
        items = self._make_items([v1, v2], ["질문A", "질문B"])
        clusters = cluster_questions_by_cosine(items, threshold=0.80)
        assert len(clusters) == 1
        assert len(clusters[0]) == 2

    def test_threshold_0_80_different_cluster(self):
        """cosine < 0.80 두 벡터는 별도 클러스터에 들어간다."""
        from services.knowledge_service import cluster_questions_by_cosine
        # 각도 차이 40° → cosine ≈ 0.766 < 0.80
        v1 = self._unit_vec(4, 0)
        v2 = self._unit_vec(4, 40)
        items = self._make_items([v1, v2], ["질문A", "질문B"])
        clusters = cluster_questions_by_cosine(items, threshold=0.80)
        assert len(clusters) == 2

    def test_threshold_0_85_old_boundary_now_merges(self):
        """구 임계값(0.85) 기준 분리되던 cosine~0.81 쌍이 새 임계값(0.80)에서는 합쳐진다."""
        from services.knowledge_service import cluster_questions_by_cosine
        # 각도 35.9° → cosine ≈ 0.810
        v1 = self._unit_vec(4, 0)
        v2 = self._unit_vec(4, 35.9)
        items = self._make_items([v1, v2], ["DB 연결 실패", "오라클 접속 안 됨"])
        # 0.85 기준: 별도 클러스터
        clusters_old = cluster_questions_by_cosine(items, threshold=0.85)
        assert len(clusters_old) == 2, "0.85 기준에서는 분리되어야 함"
        # 0.80 기준: 같은 클러스터
        clusters_new = cluster_questions_by_cosine(items, threshold=0.80)
        assert len(clusters_new) == 1, "0.80 기준에서는 합쳐져야 함"

    def test_single_item_cluster(self):
        """클러스터 크기 1 — 대표 질문 = 해당 질문 자신."""
        from services.knowledge_service import cluster_questions_by_cosine
        v1 = self._unit_vec(4, 0)
        items = self._make_items([v1], ["유일한 질문"])
        clusters = cluster_questions_by_cosine(items, threshold=0.80)
        assert len(clusters) == 1
        assert clusters[0][0]["content"] == "유일한 질문"

    def test_no_embedding_fallback(self):
        """임베딩 없으면 each item이 독립 클러스터로 반환된다."""
        from services.knowledge_service import cluster_questions_by_cosine
        items = [
            {"content": "질문X", "exact_count": 1, "last_asked_at": None, "avg_rag_score": None, "embedding": None},
            {"content": "질문Y", "exact_count": 1, "last_asked_at": None, "avg_rag_score": None, "embedding": None},
        ]
        clusters = cluster_questions_by_cosine(items, threshold=0.80)
        assert len(clusters) == 2


# ── centroid 대표 질문 선정 테스트 ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_representative_is_centroid_nearest(authed_client: AsyncClient):
    """클러스터 내 centroid 최근접 질문이 representative로 선정되는지 검증.

    fixture:
      - 질문A (0°) — centroid에서 멀리
      - 질문B (10°) — centroid에 가장 가까움 (shorter text, tiebreak)
      - 질문C (20°) — 중간
    클러스터 centroid ≈ 10° 방향 → 질문B가 대표여야 함.
    """
    import math as _math

    def unit_vec(angle_deg: float) -> list[float]:
        rad = _math.radians(angle_deg)
        return [_math.cos(rad), _math.sin(rad), 0.0, 0.0]

    # 세 질문 모두 cosine >= 0.80 (각도 차이 ≤ 37°) → 같은 클러스터
    emb_a = unit_vec(0)
    emb_b = unit_vec(10)
    emb_c = unit_vec(20)

    mock_rows = [
        MagicMock(content="DB 연결 실패가 발생했어요", exact_count=1, last_asked_at=None, avg_rag_score=None),
        MagicMock(content="B", exact_count=1, last_asked_at=None, avg_rag_score=None),  # 짧은 텍스트
        MagicMock(content="오라클 접속 안 됨", exact_count=1, last_asked_at=None, avg_rag_score=None),
    ]

    import routes.knowledge as rk
    rk._FREQ_CACHE_DATA.clear()  # 캐시 오염 방지

    with patch(
        "routes.knowledge.knowledge_service.call_embed_batch",
        new=AsyncMock(return_value=[emb_a, emb_b, emb_c]),
    ):
        with patch(
            "routes.knowledge._build_question_clusters",
            wraps=rk._build_question_clusters,
        ):
            # DB 직접 패치 — SQL 실행 결과를 mock_rows로 대체
            mock_result = MagicMock()
            mock_result.fetchall.return_value = mock_rows

            async def mock_execute(sql, params=None):
                return mock_result

            from sqlalchemy.ext.asyncio import AsyncSession
            with patch.object(AsyncSession, "execute", side_effect=mock_execute):
                resp = await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")

    assert resp.status_code == 200
    data = resp.json()
    clusters = data["clusters"]

    # 모든 벡터가 cosine >= 0.80이므로 1개 클러스터여야 하고, 대표 질문 = centroid 최근접(B)
    assert len(clusters) == 1, f"3개 벡터가 같은 클러스터여야 하나 {len(clusters)}개 클러스터 반환됨"
    assert clusters[0]["representative"] == "B", (
        f"centroid 최근접 질문 'B'가 대표여야 하나, 실제: {clusters[0]['representative']}"
    )


# ── 캐시 TTL 기간별 차등 테스트 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_ttl_7days_is_60s(authed_client: AsyncClient):
    """7일 기간 캐시 TTL이 60초임을 확인."""
    from routes.knowledge import _FREQ_CACHE_TTL_BY_DAYS
    assert _FREQ_CACHE_TTL_BY_DAYS[7] == 60


@pytest.mark.asyncio
async def test_cache_ttl_14days_is_300s(authed_client: AsyncClient):
    """14일 기간 캐시 TTL이 300초임을 확인."""
    from routes.knowledge import _FREQ_CACHE_TTL_BY_DAYS
    assert _FREQ_CACHE_TTL_BY_DAYS[14] == 300


@pytest.mark.asyncio
async def test_cache_ttl_30days_is_900s(authed_client: AsyncClient):
    """30일 기간 캐시 TTL이 900초임을 확인."""
    from routes.knowledge import _FREQ_CACHE_TTL_BY_DAYS
    assert _FREQ_CACHE_TTL_BY_DAYS[30] == 900


@pytest.mark.asyncio
async def test_cache_key_separate_per_days(authed_client: AsyncClient):
    """days=7과 days=14는 독립된 캐시 키를 사용한다."""
    import routes.knowledge as rk
    rk._FREQ_CACHE_DATA.clear()

    build_call_count = 0

    async def fake_build(db, days, unique_limit=200):
        nonlocal build_call_count
        build_call_count += 1
        return []

    with patch("routes.knowledge._build_question_clusters", side_effect=fake_build):
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=14")

    # 두 기간이 별도 캐시 키를 사용하므로 각각 빌드 호출됨
    assert build_call_count == 2, f"캐시 키가 분리되어야 하나 빌드 {build_call_count}회 호출됨"


@pytest.mark.asyncio
async def test_cache_served_within_ttl(authed_client: AsyncClient):
    """캐시 TTL 이내 재요청은 _build_question_clusters 재호출 없이 캐시를 반환한다."""
    import routes.knowledge as rk
    rk._FREQ_CACHE_DATA.clear()

    build_call_count = 0

    async def fake_build(db, days, unique_limit=200):
        nonlocal build_call_count
        build_call_count += 1
        return []

    with patch("routes.knowledge._build_question_clusters", side_effect=fake_build):
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")

    # 두 번째 요청은 캐시 히트이므로 빌드 1회만 호출
    assert build_call_count == 1, f"TTL 이내에는 캐시를 써야 하나 빌드 {build_call_count}회 호출됨"


@pytest.mark.asyncio
async def test_cache_expires_after_ttl(authed_client: AsyncClient):
    """캐시 TTL 만료 후 재요청은 _build_question_clusters를 재호출한다."""
    import routes.knowledge as rk
    rk._FREQ_CACHE_DATA.clear()

    build_call_count = 0

    async def fake_build(db, days, unique_limit=200):
        nonlocal build_call_count
        build_call_count += 1
        return []

    with patch("routes.knowledge._build_question_clusters", side_effect=fake_build):
        # 첫 번째 호출
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")

        # 캐시 타임스탬프를 과거(TTL+1초 전)로 조작하여 만료 시뮬레이션
        rk._FREQ_CACHE_DATA["7:clusters"]["ts"] = time.monotonic() - (60 + 1)

        # 두 번째 호출 — TTL 만료로 재빌드 필요
        await authed_client.get("/api/v1/knowledge/questions/frequent?days=7")

    assert build_call_count == 2, f"TTL 만료 후 재빌드가 호출되어야 하나 빌드 {build_call_count}회 호출됨"
