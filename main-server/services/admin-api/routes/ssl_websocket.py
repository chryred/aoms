"""
SSL 배포 로그 실시간 스트리밍
WebSocket: /ws/ssl-deploy/{deploy_id}
"""
import asyncio
import logging
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ssl-websocket"])

# deploy_id → 연결된 WebSocket 집합
_connections: Dict[int, Set[WebSocket]] = {}
# deploy_id → 누적 로그 (뒤늦게 연결한 클라이언트에게 전달)
_log_buffer: Dict[int, list[str]] = {}


def _get_or_create(deploy_id: int):
    if deploy_id not in _connections:
        _connections[deploy_id] = set()
    if deploy_id not in _log_buffer:
        _log_buffer[deploy_id] = []
    return _connections[deploy_id], _log_buffer[deploy_id]


async def broadcast(deploy_id: int, message: str) -> None:
    """배포 진행 로그를 해당 deploy_id 를 구독 중인 모든 클라이언트에게 전송"""
    conns, buf = _get_or_create(deploy_id)
    buf.append(message)
    dead = set()
    for ws in list(conns):
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    conns -= dead


def make_ws_callback(deploy_id: int):
    """배포 서비스에 넘길 async callback 반환"""
    async def _cb(msg: str) -> None:
        await broadcast(deploy_id, msg)
    return _cb


def cleanup(deploy_id: int) -> None:
    _connections.pop(deploy_id, None)
    _log_buffer.pop(deploy_id, None)


@router.websocket("/ws/ssl-deploy/{deploy_id}")
async def ws_ssl_deploy(websocket: WebSocket, deploy_id: int):
    await websocket.accept()
    conns, buf = _get_or_create(deploy_id)
    conns.add(websocket)

    # 이미 쌓인 로그 즉시 전송
    for line in buf:
        try:
            await websocket.send_text(line)
        except Exception:
            conns.discard(websocket)
            return

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        conns.discard(websocket)
