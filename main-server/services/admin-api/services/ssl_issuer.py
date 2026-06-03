"""
SSL 인증서 발급 — 사설 CA(intermediate) 키로 leaf 인증서 직접 서명 (ADR-019).

중앙(admin-api)에서 발급 → paramiko로 각 서버에 push 배포하는 모델이라
ACME 챌린지(http-01/dns-01)가 불필요하다. intermediate CA 키로 직접 서명하므로
와일드카드(*.shinsegae.com)도 발급 가능하고, acme.sh/socat/포트(8080) 의존이 없다.

- cert_type=wildcard:    *.shinsegae.com → {CERT_BASE}/wildcard/
- cert_type=individual:  {domain}        → {CERT_BASE}/{domain}/

결과물(기존 배포·모니터링 코드와 호환):
  {install_dir}/fullchain.cer  (leaf + intermediate)
  {install_dir}/cert.key       (leaf 개인키, 무암호 PEM)
  {install_dir}/ca.cer         (intermediate)
"""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

logger = logging.getLogger(__name__)

CERT_BASE         = os.getenv("STEP_CA_CERT_DIR", "/app/ssl/certs")
INTERMEDIATE_CERT = os.getenv("STEP_CA_INTERMEDIATE_CERT", "/app/secrets/ssl/intermediate_ca.crt")
INTERMEDIATE_KEY  = os.getenv("STEP_CA_INTERMEDIATE_KEY",  "/app/secrets/ssl/intermediate_ca_key")

_WILDCARD        = "*.shinsegae.com"
_LEAF_VALID_DAYS = 825  # leaf 유효기간 (브라우저 상한 근사)


def _wildcard_domain() -> str:
    return _WILDCARD


def _load_intermediate() -> tuple[x509.Certificate, rsa.RSAPrivateKey]:
    """intermediate CA 인증서 + 무암호 PEM 개인키 로드."""
    cert = x509.load_pem_x509_certificate(Path(INTERMEDIATE_CERT).read_bytes())
    key = serialization.load_pem_private_key(Path(INTERMEDIATE_KEY).read_bytes(), password=None)
    return cert, key


def _sans_for(domain: str) -> list[x509.GeneralName]:
    sans: list[x509.GeneralName] = [x509.DNSName(domain)]
    if domain == _WILDCARD:
        sans.append(x509.DNSName("shinsegae.com"))  # apex 포함
    return sans


def sign_leaf(domain: str, install_dir: str) -> None:
    """
    intermediate CA 키로 leaf 인증서를 직접 서명해 install_dir에 저장.
    부트스트랩(샌드박스 와일드카드 발급)과 issue_or_renew가 공유하는 단일 서명 헬퍼.
    """
    ca_cert, ca_key = _load_intermediate()

    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, domain)]))
        .issuer_name(ca_cert.subject)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=_LEAF_VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(_sans_for(domain)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_encipherment=True, content_commitment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()), critical=False)
        .sign(private_key=ca_key, algorithm=hashes.SHA256())
    )

    install = Path(install_dir)
    install.mkdir(parents=True, exist_ok=True)

    leaf_pem = leaf_cert.public_bytes(serialization.Encoding.PEM)
    ca_pem = ca_cert.public_bytes(serialization.Encoding.PEM)
    key_pem = leaf_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )

    (install / "fullchain.cer").write_bytes(leaf_pem + ca_pem)
    (install / "cert.key").write_bytes(key_pem)
    (install / "ca.cer").write_bytes(ca_pem)


async def issue_or_renew(domain_or_server) -> dict:
    """
    domain_or_server: SslServer 인스턴스 또는 도메인 문자열.
    intermediate CA 키로 직접 서명하여 발급/갱신.
    반환: {"domain", "install_dir", "rc": 0|1, "output"}  (기존 시그니처 호환)
    """
    if isinstance(domain_or_server, str):
        domain = domain_or_server
        cert_type = "wildcard" if domain.startswith("*") else "individual"
    else:
        server = domain_or_server
        cert_type = server.cert_type
        domain = _wildcard_domain() if cert_type == "wildcard" else server.domain

    install_dir = f"{CERT_BASE}/wildcard" if cert_type == "wildcard" else f"{CERT_BASE}/{domain}"

    try:
        # RSA 키 생성 + 파일 IO 블로킹을 이벤트 루프에서 분리
        await asyncio.to_thread(sign_leaf, domain, install_dir)
    except Exception as e:
        logger.warning("직접 서명 발급 실패 (domain=%s): %s", domain, e)
        return {"domain": domain, "install_dir": install_dir, "rc": 1, "output": str(e)}

    msg = f"직접 서명 발급 완료: {domain} → {install_dir}"
    logger.info(msg)
    return {"domain": domain, "install_dir": install_dir, "rc": 0, "output": msg}
