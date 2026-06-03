#!/usr/bin/env python3
"""
SSL 샌드박스용 사설 CA 생성 (root + intermediate) — cryptography 전용 (ADR-019).

smallstep/step-ca 이미지는 intermediate 키를 비밀번호로 암호화해 저장하므로
admin-api의 cryptography 직접 서명(무암호 PEM 로드)과 호환되지 않는다.
그래서 CA 생성도 cryptography로 통일하여 무암호 PEM 키를 만든다.

생성물 (out_dir):
  root_ca.crt          root CA 인증서 (클라이언트 신뢰 앵커)
  root_ca_key          root CA 개인키 (무암호 PEM — 샌드박스 전용)
  intermediate_ca.crt  intermediate CA 인증서
  intermediate_ca_key  intermediate CA 개인키 (무암호 PEM — ssl_issuer가 로드)

사용: ./venv/bin/python scripts/ssl_ca_gen.py <out_dir>
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

_ROOT_DAYS = 3650
_INT_DAYS = 1825


def _key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=4096)


def _write_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)

    # ── root CA (self-signed) ──────────────────────────────────────────────
    root_key = _key()
    root_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Shinsegae-inc Root CA")])
    root_cert = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=_ROOT_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, key_encipherment=False, content_commitment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(root_key.public_key()), critical=False)
        .sign(private_key=root_key, algorithm=hashes.SHA256())
    )

    # ── intermediate CA (root 서명) ────────────────────────────────────────
    int_key = _key()
    int_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Shinsegae-inc Intermediate CA")])
    int_cert = (
        x509.CertificateBuilder()
        .subject_name(int_name)
        .issuer_name(root_cert.subject)
        .public_key(int_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=_INT_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False, key_encipherment=False, content_commitment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=True,
                crl_sign=True, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(int_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()), critical=False)
        .sign(private_key=root_key, algorithm=hashes.SHA256())
    )

    (out / "root_ca.crt").write_bytes(root_cert.public_bytes(serialization.Encoding.PEM))
    _write_key(out / "root_ca_key", root_key)
    (out / "intermediate_ca.crt").write_bytes(int_cert.public_bytes(serialization.Encoding.PEM))
    _write_key(out / "intermediate_ca_key", int_key)

    print(f"CA 생성 완료: {out}/{{root_ca.crt,root_ca_key,intermediate_ca.crt,intermediate_ca_key}}")


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    dirs = [a for a in args if not a.startswith("--")]

    if not dirs:
        print("사용: python scripts/ssl_ca_gen.py <out_dir> [--force]", file=sys.stderr)
        print("  --force  기존 CA가 있어도 덮어쓰기 (위험 — 기 배포 인증서 체인 깨짐)", file=sys.stderr)
        sys.exit(1)

    out_dir = dirs[0]
    guard = Path(out_dir) / "intermediate_ca_key"
    if guard.exists() and not force:
        print(f"ERROR: CA가 이미 존재합니다 → {guard}", file=sys.stderr)
        print("  기존 CA를 재사용하세요. 새로 생성하려면 --force 옵션을 사용하세요.", file=sys.stderr)
        print("  경고: --force 는 기 배포된 모든 인증서의 체인을 깨뜨립니다.", file=sys.stderr)
        sys.exit(2)

    if force and guard.exists():
        print("WARNING: --force 지정됨. 기존 CA를 덮어씁니다.", file=sys.stderr)

    main(out_dir)
