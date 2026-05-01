from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Contact, System, SystemContact, User


async def get_system_and_contacts(db: AsyncSession, system_name: str):
    """system_name으로 시스템 + 담당자 목록 조회 (name은 User 테이블에서)"""
    result = await db.execute(
        select(System).where(System.system_name == system_name)
    )
    system = result.scalar_one_or_none()
    if not system:
        return None, []

    contacts_result = await db.execute(
        select(Contact, User.name.label("user_name"), User.email.label("user_email"))
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .join(User, Contact.user_id == User.id)
        .where(SystemContact.system_id == system.id)
    )
    # dict 형태로 변환해 notification.py의 c['name'] 패턴과 호환
    contacts = [
        {"id": c.id, "name": user_name, "email": user_email,
         "teams_upn": c.teams_upn, "webhook_url": c.webhook_url}
        for c, user_name, user_email in contacts_result.all()
    ]
    return system, contacts
