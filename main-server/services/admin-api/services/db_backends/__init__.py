"""
DB 수집기 백엔드 레지스트리 (Strategy + Registry 패턴)

agent_type = "db"인 에이전트의 db_type 필드에 따라 적절한 백엔드를 디스패치한다.
새 DB 타입 추가 시: 백엔드 모듈 구현 + BACKENDS dict에 등록.
"""

from __future__ import annotations

from typing import Protocol

# ── 상수 ──────────────────────────────────────────────────────────────────────

DB_AGENT_TYPE = "db"

DB_TYPE_PORTS: dict[str, int] = {
    "oracle": 1521,
    "postgresql": 5432,
    "mssql": 1433,
    "mysql": 3306,
}

DB_TYPES = frozenset(DB_TYPE_PORTS.keys())


# ── Protocol ──────────────────────────────────────────────────────────────────

class DBBackend(Protocol):
    """각 DB 백엔드가 구현해야 하는 인터페이스."""

    def test_connection(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> None:
        """연결 테스트. 실패 시 예외 발생."""
        ...

    def collect_sync(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> dict[str, float]:
        """동기 메트릭 수집. {메트릭명: float} 반환."""
        ...


# ── 백엔드 레지스트리 ────────────────────────────────────────────────────────

from services.db_backends.oracle import OracleBackend      # noqa: E402
from services.db_backends.postgres import PostgresBackend   # noqa: E402
from services.db_backends.mssql import MSSQLBackend         # noqa: E402
from services.db_backends.mysql import MySQLBackend         # noqa: E402

BACKENDS: dict[str, DBBackend] = {
    "oracle": OracleBackend(),
    "postgresql": PostgresBackend(),
    "mssql": MSSQLBackend(),
    "mysql": MySQLBackend(),
}


def get_db_identifier_key(db_type: str) -> str:
    """db_type에 따른 label_info 내 연결 식별자 키 반환."""
    return "service_name" if db_type == "oracle" else "database"
