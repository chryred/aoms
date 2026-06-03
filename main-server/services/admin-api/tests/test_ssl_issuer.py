"""ssl_issuer 직접 서명 발급 테스트 (ADR-019).

DB 불필요. fixture에서 throwaway intermediate CA를 cryptography로 생성하고
env를 주입한 뒤 ssl_issuer 모듈 상수를 reload 한다.
"""
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID


def _make_ca(tmp_path: Path) -> tuple[Path, Path]:
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Intermediate CA")])
    now = datetime.now(timezone.utc)
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    cert_p = tmp_path / "intermediate_ca.crt"
    key_p = tmp_path / "intermediate_ca_key"
    cert_p.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    key_p.write_bytes(
        ca_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return cert_p, key_p


@pytest.fixture
def issuer(tmp_path, monkeypatch):
    cert_p, key_p = _make_ca(tmp_path)
    cert_base = tmp_path / "certs"
    monkeypatch.setenv("STEP_CA_INTERMEDIATE_CERT", str(cert_p))
    monkeypatch.setenv("STEP_CA_INTERMEDIATE_KEY", str(key_p))
    monkeypatch.setenv("STEP_CA_CERT_DIR", str(cert_base))
    from services import ssl_issuer

    importlib.reload(ssl_issuer)  # 모듈 상수(CERT_BASE/INTERMEDIATE_*) 재평가
    return ssl_issuer, cert_base, cert_p


async def test_issue_wildcard_writes_files(issuer):
    ssl_issuer, cert_base, _ = issuer
    res = await ssl_issuer.issue_or_renew("*.shinsegae.com")
    assert res["rc"] == 0
    wd = cert_base / "wildcard"
    assert (wd / "fullchain.cer").exists()
    assert (wd / "cert.key").exists()
    assert (wd / "ca.cer").exists()


async def test_wildcard_san_includes_apex(issuer):
    ssl_issuer, cert_base, _ = issuer
    await ssl_issuer.issue_or_renew("*.shinsegae.com")
    leaf = x509.load_pem_x509_certificate((cert_base / "wildcard" / "fullchain.cer").read_bytes())
    sans = leaf.extensions.get_extension_for_class(
        x509.SubjectAlternativeName
    ).value.get_values_for_type(x509.DNSName)
    assert "*.shinsegae.com" in sans
    assert "shinsegae.com" in sans


async def test_leaf_signed_by_intermediate(issuer):
    ssl_issuer, cert_base, cert_p = issuer
    await ssl_issuer.issue_or_renew("*.shinsegae.com")
    ca = x509.load_pem_x509_certificate(cert_p.read_bytes())
    leaf = x509.load_pem_x509_certificate((cert_base / "wildcard" / "fullchain.cer").read_bytes())
    assert leaf.issuer == ca.subject
    # CA 공개키로 leaf 서명 검증 (예외 없으면 유효)
    ca.public_key().verify(
        leaf.signature,
        leaf.tbs_certificate_bytes,
        padding.PKCS1v15(),
        leaf.signature_hash_algorithm,
    )


async def test_fullchain_contains_intermediate(issuer):
    ssl_issuer, cert_base, cert_p = issuer
    await ssl_issuer.issue_or_renew("*.shinsegae.com")
    fullchain = (cert_base / "wildcard" / "fullchain.cer").read_bytes()
    # leaf + intermediate 2개의 인증서 블록
    assert fullchain.count(b"BEGIN CERTIFICATE") == 2


async def test_individual_domain_dir(issuer):
    ssl_issuer, cert_base, _ = issuer
    res = await ssl_issuer.issue_or_renew("crm.shinsegae.com")
    assert res["rc"] == 0
    assert (cert_base / "crm.shinsegae.com" / "fullchain.cer").exists()
    leaf = x509.load_pem_x509_certificate(
        (cert_base / "crm.shinsegae.com" / "fullchain.cer").read_bytes()
    )
    sans = leaf.extensions.get_extension_for_class(
        x509.SubjectAlternativeName
    ).value.get_values_for_type(x509.DNSName)
    assert sans == ["crm.shinsegae.com"]  # 개별 도메인은 apex 미포함


async def test_missing_ca_returns_error(tmp_path, monkeypatch):
    monkeypatch.setenv("STEP_CA_INTERMEDIATE_CERT", str(tmp_path / "nope.crt"))
    monkeypatch.setenv("STEP_CA_INTERMEDIATE_KEY", str(tmp_path / "nope.key"))
    monkeypatch.setenv("STEP_CA_CERT_DIR", str(tmp_path / "certs"))
    from services import ssl_issuer

    importlib.reload(ssl_issuer)
    res = await ssl_issuer.issue_or_renew("*.shinsegae.com")
    assert res["rc"] == 1
