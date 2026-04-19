from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import Contact, SystemContact, System, User
from schemas import ContactCreate, ContactUpdate, ContactOut, SystemBrief

router = APIRouter(prefix="/api/v1/contacts", tags=["contacts"])


def _to_contact_out(contact: Contact, user: User, systems: list[SystemBrief] | None = None) -> ContactOut:
    return ContactOut(
        id=contact.id,
        user_id=contact.user_id,
        name=user.name,
        email=user.email,
        teams_upn=contact.teams_upn,
        webhook_url=contact.webhook_url,
        created_at=contact.created_at,
        systems=systems or [],
    )


@router.get("", response_model=list[ContactOut])
async def list_contacts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Contact, User)
        .join(User, Contact.user_id == User.id)
        .order_by(User.name)
    )
    rows = result.all()

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

    return [_to_contact_out(contact, user, contact_systems.get(contact.id, [])) for contact, user in rows]


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(payload: ContactCreate, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    # user 존재 확인
    user = await db.get(User, payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    # 중복 등록 방지
    dup = await db.execute(select(Contact).where(Contact.user_id == payload.user_id))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 담당자로 등록된 사용자입니다")

    contact = Contact(
        user_id=payload.user_id,
        teams_upn=payload.teams_upn,
        webhook_url=payload.webhook_url,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return _to_contact_out(contact, user)


@router.get("/{contact_id}", response_model=ContactOut)
async def get_contact(contact_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Contact, User)
        .join(User, Contact.user_id == User.id)
        .where(Contact.id == contact_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact, user = row
    return _to_contact_out(contact, user)


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(contact_id: int, payload: ContactUpdate, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    result = await db.execute(
        select(Contact, User)
        .join(User, Contact.user_id == User.id)
        .where(Contact.id == contact_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact, user = row

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value == "":
            value = None
        setattr(contact, field, value)

    await db.commit()
    await db.refresh(contact)
    return _to_contact_out(contact, user)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(contact_id: int, db: AsyncSession = Depends(get_db), _user=Depends(get_current_user)):
    contact = await db.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.delete(contact)
    await db.commit()
