"""
WebSocket 실시간 알림 스트리밍
- 클라이언트가 연결하면 이후 발생하는 알림을 실시간으로 푸시
- Alertmanager 또는 log-analyzer에서 알림 발생 시 모든 연결 클라이언트에게 브로드캐스트
"""

import asyncio
import json
from datetime import datetime
from typing import Set
from fastapi import WebSocketException, APIRouter, WebSocketDisconnect, WebSocket, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..auth import get_current_user
from ..models import AlertHistory, System, Contact

router = APIRouter(prefix="/api/v1", tags=["websocket"])

# 활성 WebSocket 연결 관리
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        """모든 연결된 클라이언트에게 메시지 브로드캐스트"""
        dead_connections = set()

        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # 연결이 끊긴 경우 목록에서 제거
                dead_connections.add(connection)

        # 죽은 연결 정리
        for connection in dead_connections:
            self.disconnect(connection)

    async def broadcast_alert_fired(self, alert_data: dict):
        """알림 발생 이벤트 브로드캐스트"""
        message = {
            "type": "alert_fired",
            "timestamp": datetime.utcnow().isoformat(),
            "data": alert_data,
        }
        await self.broadcast(message)

    async def broadcast_alert_resolved(self, alert_data: dict):
        """알림 해제 이벤트 브로드캐스트"""
        message = {
            "type": "alert_resolved",
            "timestamp": datetime.utcnow().isoformat(),
            "data": alert_data,
        }
        await self.broadcast(message)

    async def broadcast_log_analysis(self, analysis_data: dict):
        """로그분석 완료 이벤트 브로드캐스트"""
        message = {
            "type": "log_analysis_complete",
            "timestamp": datetime.utcnow().isoformat(),
            "data": analysis_data,
        }
        await self.broadcast(message)


# 전역 인스턴스
manager = ConnectionManager()


# ==================== WebSocket 엔드포인트 ====================

@router.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """
    대시보드 실시간 알림 스트리밍

    메시지 형식:
    {
        "type": "alert_fired" | "alert_resolved" | "log_analysis_complete",
        "timestamp": "2026-04-11T...",
        "data": { ... }
    }
    """
    await manager.connect(websocket)

    try:
        while True:
            # 클라이언트로부터 수신 (heartbeat나 ping 등)
            data = await websocket.receive_text()
            # ping-pong 형식로 응답 (활성 유지)
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        manager.disconnect(websocket)
        raise


# ==================== 알림 발생 시 WebSocket 브로드캐스트 호출 ====================
# (alerts.py 및 analysis.py에서 호출)

async def notify_alert_fired(alert_data: dict):
    """메트릭 알림 발생 시 WebSocket으로 브로드캐스트"""
    await manager.broadcast_alert_fired(alert_data)


async def notify_alert_resolved(alert_data: dict):
    """메트릭 알림 해제 시 WebSocket으로 브로드캐스트"""
    await manager.broadcast_alert_resolved(alert_data)


async def notify_log_analysis(analysis_data: dict):
    """로그분석 완료 시 WebSocket으로 브로드캐스트"""
    await manager.broadcast_log_analysis(analysis_data)
