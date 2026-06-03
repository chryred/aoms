#!/bin/bash
# systemctl shim — 컨테이너엔 systemd가 없으므로 ssl_deployer의
# `systemctl reload nginx` / `systemctl restart nginx`를 nginx 시그널로 변환.
action="${1:-}"
unit="${2:-}"

case "$unit" in
  nginx|nginx.service)
    case "$action" in
      reload)  exec nginx -s reload ;;
      restart) nginx -s stop 2>/dev/null || true; exec nginx ;;
      status)  exec pgrep -x nginx ;;
      *) echo "systemctl-shim: 미지원 action '$action'" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "systemctl-shim: 미지원 unit '$unit'" >&2
    exit 1
    ;;
esac
