from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/v1/alert-exclusions", tags=["alert-exclusions"])

_GONE = JSONResponse(
    status_code=410,
    content={"detail": "alert_exclusions 기능이 폐기되었습니다. Qdrant semantic similarity가 알림 분류를 담당합니다."},
)


@router.post("")
async def create_exclusions():
    return _GONE


@router.get("")
async def list_exclusions():
    return _GONE


@router.patch("/deactivate")
async def deactivate_exclusions():
    return _GONE
