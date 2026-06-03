"""
Root CA 공개 엔드포인트 (인증 불필요)
GET /api/v1/ssl/root-ca/download  → shinsegae-inc-root-ca.crt 다운로드
GET /api/v1/ssl/root-ca/info      → CA 이름, 만료일, fingerprint
"""
import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/v1/ssl/root-ca", tags=["ssl-root-ca"])

ROOT_CA_PATH = os.getenv("STEP_CA_ROOT_CA", "/app/secrets/ssl/root_ca.crt")


@router.get("/download")
async def download_root_ca():
    path = Path(ROOT_CA_PATH)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Root CA 파일을 찾을 수 없습니다.")
    return FileResponse(
        path=str(path),
        media_type="application/x-x509-ca-cert",
        filename="shinsegae-inc-root-ca.crt",
    )


@router.get("/info")
async def get_root_ca_info():
    path = Path(ROOT_CA_PATH)
    if not path.exists():
        return {"available": False}

    async def _parse():
        proc = await asyncio.create_subprocess_exec(
            "openssl", "x509", "-noout",
            "-subject", "-enddate", "-fingerprint", "-sha256",
            "-in", str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        return stdout.decode(errors="replace")

    try:
        out = await _parse()
        info: dict = {"available": True}
        for line in out.splitlines():
            if line.startswith("subject="):
                info["subject"] = line.split("=", 1)[1].strip()
            elif line.startswith("notAfter="):
                info["not_after"] = line.split("=", 1)[1].strip()
            elif "Fingerprint=" in line:
                info["fingerprint_sha256"] = line.split("=", 1)[1].strip()
        return info
    except Exception as e:
        return {"available": True, "error": str(e)}
