"""범용 대칭키 암호화 유틸 (Fernet).

`ENCRYPTION_KEY` 환경변수를 사용해 DB 수집기 자격증명, 챗봇 executor 자격증명 등
다양한 도메인에서 공통으로 쓰는 평문 → 암호문 / 암호문 → 평문 변환을 제공한다.
"""

import os

from cryptography.fernet import Fernet


def _require_key() -> str:
    key = os.environ.get("ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. "
            "Fernet 키 생성: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return key


def encrypt_password(plain: str) -> str:
    """평문 문자열을 Fernet으로 암호화해 문자열로 반환."""
    return Fernet(_require_key().encode()).encrypt(plain.encode()).decode()


def decrypt_password(encrypted: str) -> str:
    """Fernet 암호문 문자열을 복호화해 평문 반환."""
    return Fernet(_require_key().encode()).decrypt(encrypted.encode()).decode()
