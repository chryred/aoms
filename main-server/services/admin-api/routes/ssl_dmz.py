"""
DMZ 설치 번들 zip 생성/다운로드
GET /api/v1/ssl/dmz/bundle/{server_id}
"""
import io
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import SslServer

router = APIRouter(prefix="/api/v1/ssl/dmz", tags=["ssl-dmz"])

_INSTALL_SH = """\
#!/bin/bash
# DMZ SSL 자동 갱신 설치 스크립트
# 대상 도메인: {domain}
# 생성일: {created_at}
# ※ root 권한으로 실행하세요.

set -e

DOMAIN="{domain}"
ACME_HOME="/root/.acme.sh"
SSL_DIR="{ssl_dir}"
WEBROOT="/var/www/html"

echo "[1/5] acme.sh 설치..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/acme.sh-3.1.1" ]; then
  cd "$SCRIPT_DIR/acme.sh-3.1.1"
  ./acme.sh --install --nocron --home "$ACME_HOME"
  cd "$SCRIPT_DIR"
else
  echo "  acme.sh-3.1.1/ 디렉터리가 없습니다. 수동으로 다운로드 후 재실행하세요."
  echo "  https://github.com/acmesh-official/acme.sh/releases/tag/3.1.1"
  exit 1
fi

echo "[2/5] SSL 디렉터리 생성..."
mkdir -p "$SSL_DIR"

echo "[3/5] reload.sh 배치..."
cp "$SCRIPT_DIR/reload.sh" /usr/local/bin/reload.sh
chmod +x /usr/local/bin/reload.sh

echo "[4/5] 인증서 발급 (Let's Encrypt HTTP-01)..."
"$ACME_HOME/acme.sh" --issue -d "$DOMAIN" \\
  --webroot "$WEBROOT" \\
  --server letsencrypt

echo "[5/5] 인증서 설치 및 cron 등록..."
"$ACME_HOME/acme.sh" --install-cert -d "$DOMAIN" \\
  --fullchain-file "$SSL_DIR/fullchain.cer" \\
  --key-file       "$SSL_DIR/cert.key" \\
  --reloadcmd      "/usr/local/bin/reload.sh"

(crontab -l 2>/dev/null; echo "0 2 * * * $ACME_HOME/acme.sh --cron --home $ACME_HOME >> /var/log/acme-cron.log 2>&1") | crontab -

echo ""
echo "=== 설치 완료 ==="
echo "인증서 경로: $SSL_DIR/fullchain.cer"
echo "키 경로:     $SSL_DIR/cert.key"
echo "자동 갱신:   매일 02:00 cron"
"""

_RELOAD_SH = """\
#!/bin/bash
# nginx reload — 인증서 갱신 후 acme.sh --reloadcmd 으로 자동 실행
nginx -t && systemctl reload nginx
echo "[$(date '+%Y-%m-%d %H:%M:%S')] nginx reloaded" >> /var/log/acme-reload.log
"""

_README = """\
# DMZ SSL 자동 갱신 번들

## 구성 파일
- acme.sh-3.1.1/  : acme.sh 오프라인 설치 패키지 (별도 추가 필요)
- install.sh      : 최초 1회 설치 스크립트
- reload.sh       : 인증서 갱신 후 nginx 재로드 스크립트
- README.md       : 이 파일

## 사전 준비

acme.sh 오프라인 패키지를 이 번들에 포함해야 합니다:
  https://github.com/acmesh-official/acme.sh/releases/tag/3.1.1

  unzip acme.sh-3.1.1.tar.gz
  # 결과 디렉터리를 이 번들의 acme.sh-3.1.1/ 위치에 배치

## 설치 방법

1. DMZ 서버로 번들 전송:
   scp dmz-bundle.zip {account}@{host}:/tmp/

2. 압축 해제:
   unzip /tmp/dmz-bundle.zip -d /tmp/ssl-bundle

3. 설치 실행 (root 필요):
   cd /tmp/ssl-bundle && sudo bash install.sh

## 현황 확인

Synapse-V 포털이 매일 02:00 배치에서 openssl s_client로 인증서 만료일을 확인합니다.
별도 콜백/토큰 없이 포털이 폴링합니다.

## 수동 갱신

/root/.acme.sh/acme.sh --renew -d {domain} --force
"""


@router.get("/bundle/{server_id}")
async def download_dmz_bundle(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")
    if server.web_type != "lets_encrypt_http01":
        raise HTTPException(
            status_code=400,
            detail="DMZ(Let's Encrypt) 서버만 번들 다운로드가 가능합니다.",
        )

    domain = server.domain or server.host
    ssl_dir = server.cert_dir or "/etc/nginx/ssl"
    created_at = datetime.now().strftime("%Y-%m-%d")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "install.sh",
            _INSTALL_SH.format(domain=domain, ssl_dir=ssl_dir, created_at=created_at),
        )
        zf.writestr("reload.sh", _RELOAD_SH)
        zf.writestr(
            "README.md",
            _README.format(domain=domain, host=server.host, account=server.account),
        )
        zf.writestr(
            "acme.sh-3.1.1/.placeholder",
            "# acme.sh-3.1.1 디렉터리 내용을 여기에 추가하세요\n"
            "# https://github.com/acmesh-official/acme.sh/releases/tag/3.1.1\n",
        )
    buf.seek(0)

    safe_domain = domain.replace("*", "wildcard").replace(".", "-")
    filename = f"dmz-bundle-{server_id}-{safe_domain}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
