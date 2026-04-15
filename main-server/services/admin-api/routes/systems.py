from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import System, SystemContact, Contact
from schemas import SystemCreate, SystemUpdate, SystemOut, SystemContactCreate, SystemContactOut, ContactOut, ContactWithRoleOut, SystemContactFullOut

router = APIRouter(prefix="/api/v1/systems", tags=["systems"])


@router.get("", response_model=list[SystemOut])
async def list_systems(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(System).order_by(System.system_name))
    return result.scalars().all()


@router.post("", response_model=SystemOut, status_code=status.HTTP_201_CREATED)
async def create_system(payload: SystemCreate, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    system = System(**payload.model_dump())
    db.add(system)
    await db.commit()
    await db.refresh(system)
    return system


@router.get("/{system_id}", response_model=SystemOut)
async def get_system(system_id: int, db: AsyncSession = Depends(get_db)):
    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    return system


@router.patch("/{system_id}", response_model=SystemOut)
async def update_system(system_id: int, payload: SystemUpdate, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(system, field, value)
    await db.commit()
    await db.refresh(system)
    return system


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system(system_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    await db.delete(system)
    await db.commit()


# ── 시스템별 담당자 ────────────────────────────────────────────────────

@router.get("/name/{system_name}/contacts", response_model=list[ContactWithRoleOut])
async def list_system_contacts_by_name(system_name: str, db: AsyncSession = Depends(get_db)):
    """log-analyzer용: 시스템명으로 담당자 조회 (role + llm_api_key 포함)"""
    result = await db.execute(
        select(Contact, SystemContact.role)
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .join(System, System.id == SystemContact.system_id)
        .where(System.system_name == system_name)
        .order_by(SystemContact.role)  # primary 먼저
    )
    rows = result.all()
    return [
        ContactWithRoleOut(
            id=contact.id,
            name=contact.name,
            role=role,
            teams_upn=contact.teams_upn,
            webhook_url=contact.webhook_url,
            llm_api_key=contact.llm_api_key,
            agent_code=contact.agent_code,
        )
        for contact, role in rows
    ]


@router.get("/{system_id}/contacts", response_model=list[SystemContactFullOut])
async def list_system_contacts(system_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SystemContact, Contact)
        .join(Contact, SystemContact.contact_id == Contact.id)
        .where(SystemContact.system_id == system_id)
    )
    rows = result.all()
    return [SystemContactFullOut.from_orm_row(sc, contact) for sc, contact in rows]


@router.post("/{system_id}/contacts", response_model=SystemContactOut, status_code=status.HTTP_201_CREATED)
async def add_system_contact(
    system_id: int,
    payload: SystemContactCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    if not await db.get(System, system_id):
        raise HTTPException(status_code=404, detail="System not found")
    if not await db.get(Contact, payload.contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    sc = SystemContact(system_id=system_id, **payload.model_dump())
    db.add(sc)
    await db.commit()
    await db.refresh(sc)
    return sc


@router.delete("/{system_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_system_contact(system_id: int, contact_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    result = await db.execute(
        select(SystemContact).where(
            SystemContact.system_id == system_id,
            SystemContact.contact_id == contact_id,
        )
    )
    sc = result.scalar_one_or_none()
    if not sc:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.delete(sc)
    await db.commit()
