from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ── System ──────────────────────────────────────────────────────────────
class SystemCreate(BaseModel):
    system_name: str
    display_name: str
    description: Optional[str] = None
    host: str
    os_type: str = Field(pattern="^(linux|windows)$")
    system_type: str = Field(pattern="^(web|was|db|middleware|other)$")
    status: str = "active"
    teams_webhook_url: Optional[str] = None


class SystemUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    host: Optional[str] = None
    os_type: Optional[str] = None
    system_type: Optional[str] = None
    status: Optional[str] = None
    teams_webhook_url: Optional[str] = None


class SystemOut(BaseModel):
    id: int
    system_name: str
    display_name: str
    description: Optional[str]
    host: str
    os_type: str
    system_type: str
    status: str
    teams_webhook_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Contact ──────────────────────────────────────────────────────────────
class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    teams_upn: Optional[str] = None
    webhook_url: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    teams_upn: Optional[str] = None
    webhook_url: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    name: str
    email: Optional[str]
    teams_upn: Optional[str]
    webhook_url: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ── SystemContact ────────────────────────────────────────────────────────
class SystemContactCreate(BaseModel):
    contact_id: int
    role: str = "primary"
    notify_channels: str = "teams"  # 콤마 구분 예: "teams,webhook"


class SystemContactOut(BaseModel):
    id: int
    system_id: int
    contact_id: int
    role: str
    notify_channels: str

    model_config = {"from_attributes": True}


# ── AlertHistory ─────────────────────────────────────────────────────────
class AlertHistoryOut(BaseModel):
    id: int
    system_id: Optional[int]
    alert_type: str
    severity: str
    alertname: Optional[str]
    title: str
    description: Optional[str]
    instance_role: Optional[str]
    host: Optional[str]
    acknowledged: bool
    escalated: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AcknowledgeRequest(BaseModel):
    acknowledged_by: str


# ── LogAnalysis ──────────────────────────────────────────────────────────
class LogAnalysisCreate(BaseModel):
    system_id: int
    instance_role: Optional[str] = None
    log_content: str
    analysis_result: str
    severity: str
    root_cause: Optional[str] = None
    recommendation: Optional[str] = None
    model_used: Optional[str] = None
    processing_time: Optional[float] = None


class LogAnalysisOut(BaseModel):
    id: int
    system_id: Optional[int]
    instance_role: Optional[str]
    severity: str
    root_cause: Optional[str]
    recommendation: Optional[str]
    model_used: Optional[str]
    alert_sent: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Alertmanager Webhook ──────────────────────────────────────────────────
class AlertmanagerAlert(BaseModel):
    labels: dict
    annotations: dict = {}
    status: str = "firing"
    startsAt: Optional[str] = None
    endsAt: Optional[str] = None


class AlertmanagerPayload(BaseModel):
    version: str = "4"
    groupKey: Optional[str] = None
    status: str = "firing"
    receiver: str = ""
    groupLabels: dict = {}
    commonLabels: dict = {}
    commonAnnotations: dict = {}
    alerts: list[AlertmanagerAlert] = []
