"""Executor별 자격증명/설정 로더.

`chat_executor_configs` 테이블에서 executor 설정을 읽고, `config_schema`에서
`secret: true`로 마킹된 필드는 Fernet으로 복호화해 반환한다.
60초 TTL in-memory 캐시를 두어 빈번한 DB 접근을 피한다.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatExecutorConfig
from services.crypto import decrypt_password, encrypt_password

_CACHE: dict[str, tuple[float, dict[str, Any], list[dict[str, Any]]]] = {}
_CACHE_TTL = 60.0
_LOCK = asyncio.Lock()


def _is_secret_key(schema: list[dict[str, Any]], key: str) -> bool:
    for field in schema:
        if field.get("key") == key and field.get("secret"):
            return True
    return False


async def load_executor_config(db: AsyncSession, executor: str) -> dict[str, Any]:
    """executor config 복호화 형태로 반환. 없으면 빈 dict.

    반환 dict는 평문/복호화 완료 상태. 호출부는 `base_url`/`username`/`password` 등 바로 사용 가능.
    """
    async with _LOCK:
        now = time.monotonic()
        cached = _CACHE.get(executor)
        if cached and now - cached[0] < _CACHE_TTL:
            return dict(cached[1])

    row = (
        await db.execute(select(ChatExecutorConfig).where(ChatExecutorConfig.executor == executor))
    ).scalar_one_or_none()
    if row is None:
        return {}

    schema = row.config_schema or []
    raw = row.config or {}
    resolved: dict[str, Any] = {}
    for key, value in raw.items():
        if _is_secret_key(schema, key) and isinstance(value, str) and value:
            try:
                resolved[key] = decrypt_password(value)
            except Exception:
                resolved[key] = ""
        else:
            resolved[key] = value

    async with _LOCK:
        _CACHE[executor] = (time.monotonic(), dict(resolved), list(schema))
    return resolved


async def save_executor_config(
    db: AsyncSession,
    executor: str,
    incoming: dict[str, Any],
    user_id: int | None,
) -> ChatExecutorConfig:
    """관리자 저장: secret 필드는 암호화해서 config에 저장. "***"는 기존 값 유지."""
    row = (
        await db.execute(select(ChatExecutorConfig).where(ChatExecutorConfig.executor == executor))
    ).scalar_one_or_none()
    if row is None:
        raise ValueError(f"unknown executor: {executor}")

    schema = row.config_schema or []
    existing = dict(row.config or {})
    for field in schema:
        key = field["key"]
        required = field.get("required")
        if key not in incoming:
            if required and key not in existing:
                raise ValueError(f"'{key}' 필드는 필수입니다.")
            continue
        value = incoming[key]
        if field.get("secret"):
            if value == "***" or value == "" or value is None:
                # mask 유지 or 빈값 → 기존 암호문 유지
                continue
            existing[key] = encrypt_password(str(value))
        else:
            existing[key] = value

    row.config = existing
    row.updated_by = user_id
    await db.flush()
    invalidate(executor)
    return row


async def has_required_credentials(db: AsyncSession, executor: str) -> bool:
    """executor의 필수 자격증명이 모두 설정되어 있으면 True. 필수 필드 없으면 항상 True."""
    row = (
        await db.execute(select(ChatExecutorConfig).where(ChatExecutorConfig.executor == executor))
    ).scalar_one_or_none()
    if row is None:
        return False
    schema = row.config_schema or []
    required_keys = [f["key"] for f in schema if f.get("required")]
    if not required_keys:
        return True
    config = row.config or {}
    return all(config.get(k) for k in required_keys)


def invalidate(executor: str | None = None) -> None:
    """캐시 무효화. executor 미지정 시 전체 플러시."""
    if executor is None:
        _CACHE.clear()
    else:
        _CACHE.pop(executor, None)


def masked_config(row: ChatExecutorConfig) -> dict[str, Any]:
    """관리 API 응답용: secret 필드를 '***'로 마스킹한 config dict."""
    schema = row.config_schema or []
    raw = row.config or {}
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if _is_secret_key(schema, key) and value:
            out[key] = "***"
        else:
            out[key] = value
    return out
