"""
피드백 엔드포인트 (Phase 4c WF3 + 프론트엔드 직접 등록)

- GET /api/v1/feedback/form  — Teams 알림 '해결책 등록' 버튼용 HTML 폼
- POST /api/v1/feedback      — 프론트엔드에서 확인 처리 시 해결책 직접 등록
"""
import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AlertFeedback, AlertHistory
from schemas import FeedbackCreateRequest, FeedbackOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

# n8n Webhook URL — 로컬: http://localhost:5678/webhook/feedback
#                   운영: http://{server-a-ip}:5678/webhook/feedback
N8N_FEEDBACK_WEBHOOK = os.getenv(
    "N8N_WEBHOOK_URL", "http://localhost:5678"
).rstrip("/") + "/webhook/feedback"


@router.get("/form", response_class=HTMLResponse)
async def feedback_form(
    alert_id: int = 0,
    system: str = "",
    point_id: str = "",
):
    """Teams 알림에서 연결되는 해결책 등록 폼"""
    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synapse 해결책 등록</title>
  <style>
    body  {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
             background: #f0f2f5; display: flex; justify-content: center;
             align-items: flex-start; min-height: 100vh; padding: 2rem; margin: 0; }}
    .card {{ background: #fff; border-radius: 8px; padding: 2rem;
             box-shadow: 0 2px 8px rgba(0,0,0,.12); width: 100%; max-width: 560px; }}
    h2    {{ margin: 0 0 1.5rem; font-size: 1.2rem; color: #1a1a2e; }}
    label {{ display: block; margin-bottom: .3rem; font-size: .85rem;
             font-weight: 600; color: #444; }}
    select, textarea, input[type=text] {{
             width: 100%; padding: .6rem .8rem; border: 1px solid #d0d5dd;
             border-radius: 6px; font-size: .9rem; box-sizing: border-box;
             margin-bottom: 1rem; }}
    textarea {{ height: 120px; resize: vertical; }}
    button {{ width: 100%; padding: .75rem; background: #0078d4;
              color: #fff; border: none; border-radius: 6px;
              font-size: 1rem; font-weight: 600; cursor: pointer; }}
    button:hover {{ background: #106ebe; }}
    .badge {{ display: inline-block; background: #e8f4fd; color: #0078d4;
              padding: .2rem .6rem; border-radius: 12px; font-size: .8rem;
              margin-bottom: 1rem; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>🔧 장애 해결책 등록</h2>
    <span class="badge">시스템: {system or '알 수 없음'}</span>
    <form action="{N8N_FEEDBACK_WEBHOOK}" method="POST">
      <input type="hidden" name="alert_id"  value="{alert_id}">
      <input type="hidden" name="system"    value="{system}">
      <input type="hidden" name="point_id"  value="{point_id}">

      <label>장애 유형</label>
      <select name="error_type">
        <option value="DB 연결 오류">DB 연결 오류</option>
        <option value="메모리 부족">메모리 부족</option>
        <option value="디스크 부족">디스크 부족</option>
        <option value="네트워크 오류">네트워크 오류</option>
        <option value="타임아웃">타임아웃</option>
        <option value="애플리케이션 오류">애플리케이션 오류</option>
        <option value="기타">기타</option>
      </select>

      <label>해결 내용</label>
      <textarea name="solution" placeholder="수행한 조치 내용을 구체적으로 기술해 주세요..." required></textarea>

      <label>처리자</label>
      <input type="text" name="resolver" placeholder="이름 또는 사번" required>

      <button type="submit">해결책 등록</button>
    </form>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html)


@router.post("", response_model=FeedbackOut)
async def create_feedback(
    payload: FeedbackCreateRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """프론트엔드에서 알림 확인 시 해결책 직접 등록"""
    alert = await db.get(AlertHistory, payload.alert_history_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    feedback = AlertFeedback(
        system_id=alert.system_id,
        alert_history_id=alert.id,
        error_type=payload.error_type,
        solution=payload.solution,
        resolver=payload.resolver,
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    # Qdrant 해결책 업데이트 (best-effort)
    if alert.qdrant_point_id:
        collection_type = (
            "metric" if alert.alert_type == "metric" else "log"
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{LOG_ANALYZER_URL}/solution/update",
                    json={
                        "point_id": alert.qdrant_point_id,
                        "collection_type": collection_type,
                        "solution": payload.solution,
                        "resolver": payload.resolver,
                    },
                )
        except Exception as exc:
            logger.warning("Qdrant 해결책 업데이트 실패: %s", exc)

    return feedback
