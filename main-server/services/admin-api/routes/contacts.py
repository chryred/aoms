from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Contact, SystemContact, System
from schemas import ContactCreate, ContactUpdate, ContactOut, SystemBrief

router = APIRouter(prefix="/api/v1/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactOut])
async def list_contacts(db: AsyncSession = Depends(get_db)):
    # 담당자 목록 조회
    result = await db.execute(select(Contact).order_by(Contact.name))
    contacts = result.scalars().all()

    # 모든 시스템-담당자 연결 + 시스템 정보 일괄 조회
    sc_result = await db.execute(
        select(SystemContact.contact_id, System.id, System.system_name, System.display_name)
        .join(System, SystemContact.system_id == System.id)
    )
    contact_systems: dict[int, list[SystemBrief]] = {}
    for contact_id, sys_id, system_name, display_name in sc_result.all():
        if contact_id not in contact_systems:
            contact_systems[contact_id] = []
        contact_systems[contact_id].append(
            SystemBrief(id=sys_id, system_name=system_name, display_name=display_name)
        )

    # ContactOut에 systems 주입
    out = []
    for c in contacts:
        co = ContactOut.model_validate(c)
        co.systems = contact_systems.get(c.id, [])
        out.append(co)
    return out


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(payload: ContactCreate, db: AsyncSession = Depends(get_db)):
    contact = Contact(**payload.model_dump())
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.get("/{contact_id}", response_model=ContactOut)
async def get_contact(contact_id: int, db: AsyncSession = Depends(get_db)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(contact_id: int, payload: ContactUpdate, db: AsyncSession = Depends(get_db)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(contact, field, value)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(contact_id: int, db: AsyncSession = Depends(get_db)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.delete(contact)
    await db.commit()
