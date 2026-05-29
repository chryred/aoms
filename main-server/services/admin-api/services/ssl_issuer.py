"""
acme.sh subprocess 래퍼 — Step-CA ACME 프로토콜로 인증서 발급/갱신
- cert_type=wildcard: *.shinsegae.com → secrets/certs/wildcard/
- cert_type=individual: {domain} → secrets/certs/{domain}/
"""
import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

ACMESH_PATH = os.getenv("ACMESH_PATH", "/app/acme.sh/acme.sh")
ACME_URL    = os.getenv("STEP_CA_ACME_URL", "http://172.17.0.1:8443/acme/acme/directory")
CA_CERT     = os.getenv("STEP_CA_ROOT_CA", "/app/secrets/ssl/root_ca.crt")
CERT_BASE   = os.getenv("STEP_CA_CERT_DIR", "/app/ssl/certs")


def _wildcard_domain() -> str:
    return "*.shinsegae.com"


async def _run(args: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace")


async def issue_or_renew(domain_or_server) -> dict:
    """
    domain_or_server: SslServer 인스턴스 또는 도메인 문자열.
    acme.sh --issue + --install-cert 실행.
    반환: {"domain": ..., "install_dir": ..., "rc": int, "output": str}
    """
    if isinstance(domain_or_server, str):
        domain = domain_or_server
        cert_type = "wildcard" if domain.startswith("*") else "individual"
    else:
        server = domain_or_server
        cert_type = server.cert_type
        domain = _wildcard_domain() if cert_type == "wildcard" else server.domain

    if cert_type == "wildcard":
        install_dir = f"{CERT_BASE}/wildcard"
    else:
        install_dir = f"{CERT_BASE}/{domain}"

    Path(install_dir).mkdir(parents=True, exist_ok=True)

    issue_args = [
        ACMESH_PATH, "--issue",
        "-d", domain,
        "--server", ACME_URL,
        "--ca-bundle", CA_CERT,
        "--standalone", "--httpport", "8080",
        "--force",
    ]
    rc, out = await _run(issue_args)
    if rc != 0:
        logger.warning("acme.sh --issue failed (rc=%d): %s", rc, out[-500:])
        return {"domain": domain, "install_dir": install_dir, "rc": rc, "output": out}

    install_args = [
        ACMESH_PATH, "--install-cert",
        "-d", domain,
        "--fullchain-file", f"{install_dir}/fullchain.cer",
        "--key-file",       f"{install_dir}/cert.key",
        "--ca-file",        f"{install_dir}/ca.cer",
    ]
    rc2, out2 = await _run(install_args)
    combined = out + "\n" + out2
    if rc2 != 0:
        logger.warning("acme.sh --install-cert failed (rc=%d)", rc2)

    return {"domain": domain, "install_dir": install_dir, "rc": rc2, "output": combined}
