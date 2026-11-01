"""APM 화면 구성(대시보드 레이아웃) CRUD — 사용자별 저장 + 관리자 지정 공유 기본 화면(최초 조회 시 복사)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, require_admin
from database import get_db
from models import ApmDashboard, User
from schemas import ApmDashboardIn, ApmDashboardOut

router = APIRouter(prefix="/api/v1/apm/dashboards", tags=["apm-dashboards"])


async def _get_owned(db: AsyncSession, dashboard_id: int, user: User) -> ApmDashboard:
    dash = await db.get(ApmDashboard, dashboard_id)
    if dash is None:
        raise HTTPException(status_code=404, detail="화면을 찾을 수 없습니다")
    if dash.owner_user_id != user.id:
        raise HTTPException(status_code=403, detail="본인의 화면만 수정할 수 있습니다")
    return dash


def _layout_json(body: ApmDashboardIn) -> list:
    return [item.model_dump(exclude_none=True) for item in body.layout]


@router.get("", response_model=list[ApmDashboardOut])
async def list_dashboards(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = select(ApmDashboard).where(
        ApmDashboard.owner_user_id == user.id
    ).order_by(ApmDashboard.id)
    mine = (await db.execute(stmt)).scalars().all()
    if mine:
        return mine

    shared = (await db.execute(
        select(ApmDashboard).where(ApmDashboard.is_shared_default.is_(True)).limit(1)
    )).scalar_one_or_none()
    if shared is None:
        return []
    copy = ApmDashboard(
        owner_user_id=user.id, name=shared.name, layout=shared.layout,
        filters=shared.filters, is_shared_default=False,
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return [copy]


@router.post("", response_model=ApmDashboardOut, status_code=201)
async def create_dashboard(
    body: ApmDashboardIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    dash = ApmDashboard(
        owner_user_id=user.id, name=body.name, layout=_layout_json(body),
        filters=body.filters, is_shared_default=False,
    )
    db.add(dash)
    await db.commit()
    await db.refresh(dash)
    return dash


@router.put("/{dashboard_id}", response_model=ApmDashboardOut)
async def update_dashboard(
    dashboard_id: int, body: ApmDashboardIn,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    dash = await _get_owned(db, dashboard_id, user)
    dash.name = body.name
    dash.layout = _layout_json(body)
    dash.filters = body.filters
    await db.commit()
    await db.refresh(dash)
    return dash


@router.delete("/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    dash = await _get_owned(db, dashboard_id, user)
    await db.delete(dash)
    await db.commit()


@router.post("/{dashboard_id}/share-default", response_model=ApmDashboardOut)
async def share_default(
    dashboard_id: int, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin),
):
    dash = await db.get(ApmDashboard, dashboard_id)
    if dash is None:
        raise HTTPException(status_code=404, detail="화면을 찾을 수 없습니다")
    await db.execute(
        update(ApmDashboard).where(ApmDashboard.is_shared_default.is_(True)).values(is_shared_default=False)
    )
    dash.is_shared_default = True
    await db.commit()
    await db.refresh(dash)
    return dash
