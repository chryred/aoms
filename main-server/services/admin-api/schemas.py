from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


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
    llm_api_key: Optional[str] = None
    agent_code: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    teams_upn: Optional[str] = None
    webhook_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    agent_code: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    name: str
    email: Optional[str]
    teams_upn: Optional[str]
    webhook_url: Optional[str]
    llm_api_key: Optional[str]
    agent_code: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("llm_api_key", mode="before")
    @classmethod
    def mask_api_key(cls, v: Optional[str]) -> Optional[str]:
        if v is None or len(v) <= 6:
            return v
        return v[:6] + "***"


class ContactWithRoleOut(BaseModel):
    """log-analyzer의 LLM 설정 조회용 (role + llm_api_key + agent_code 포함)"""
    id: int
    name: str
    role: str
    teams_upn: Optional[str]
    webhook_url: Optional[str]
    llm_api_key: Optional[str]
    agent_code: Optional[str]

    model_config = {"from_attributes": True}


# ── SystemContact ────────────────────────────────────────────────────────
class SystemContactCreate(BaseModel):
    contact_id: int
    role: str = "primary"
    notify_channels: str | list[str] = "teams"  # 콤마 구분 문자열 또는 배열

    @field_validator("notify_channels", mode="before")
    @classmethod
    def coerce_channels(cls, v: object) -> str:
        if isinstance(v, list):
            return ",".join(v)
        return str(v)


class SystemContactOut(BaseModel):
    id: int
    system_id: int
    contact_id: int
    role: str
    notify_channels: str

    model_config = {"from_attributes": True}


class ContactSummaryOut(BaseModel):
    id: int
    name: str
    email: Optional[str]

    model_config = {"from_attributes": True}


class SystemContactFullOut(BaseModel):
    """프론트엔드 SystemContactPanel용 — contact 중첩 + notify_channels 배열 반환"""
    id: int
    system_id: int
    contact_id: int
    role: str
    notify_channels: list[str]
    contact: ContactSummaryOut

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_row(cls, sc: object, contact: object) -> "SystemContactFullOut":
        channels = getattr(sc, "notify_channels", "teams")
        return cls(
            id=sc.id,
            system_id=sc.system_id,
            contact_id=sc.contact_id,
            role=sc.role,
            notify_channels=[ch.strip() for ch in channels.split(",") if ch.strip()],
            contact=ContactSummaryOut.model_validate(contact),
        )


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
    # Phase 4c: 메트릭 벡터 유사도 분석 필드
    anomaly_type:     Optional[str]
    similarity_score: Optional[float]
    qdrant_point_id:  Optional[str]
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
    # Phase 4b: 벡터 유사도 필드
    anomaly_type:      Optional[str]        = None  # 'new'|'recurring'|'related'|'duplicate'
    similarity_score:  Optional[float]      = None
    qdrant_point_id:   Optional[str]        = None
    has_solution:      Optional[bool]       = None
    similar_incidents: Optional[list[dict]] = None  # Teams 알림용 (DB 저장 안 함)


class LogAnalysisOut(BaseModel):
    id: int
    system_id: Optional[int]
    instance_role: Optional[str]
    severity: str
    root_cause: Optional[str]
    recommendation: Optional[str]
    model_used: Optional[str]
    alert_sent: bool
    # Phase 4b: 벡터 유사도 필드
    anomaly_type:     Optional[str]
    similarity_score: Optional[float]
    has_solution:     Optional[bool]
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


# ── Phase 5: 계층적 집계 스키마 ─────────────────────────────────────────────

class CollectorConfigCreate(BaseModel):
    system_id: int
    collector_type: str                     # node_exporter | jmx_exporter | db_exporter | custom
    metric_group: str                       # cpu | memory | disk | jvm_heap | ...
    enabled: bool = True
    prometheus_job: Optional[str] = None
    custom_config: Optional[str] = None    # JSON string


class CollectorConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    prometheus_job: Optional[str] = None
    custom_config: Optional[str] = None


class CollectorConfigOut(BaseModel):
    id: int
    system_id: int
    collector_type: str
    metric_group: str
    enabled: bool
    prometheus_job: Optional[str]
    custom_config: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── 집계 공통 LLM 필드 믹스인 ─────────────────────────────────────────────────

class _AggregationBase(BaseModel):
    """Hourly/Daily/Weekly/Monthly 집계 스키마 공통 필드"""
    system_id: int
    collector_type: str
    metric_group: str
    metrics_json: str                       # JSON string
    llm_summary: Optional[str] = None
    llm_severity: Optional[str] = None     # normal | warning | critical
    llm_trend: Optional[str] = None
    qdrant_point_id: Optional[str] = None


class _AggregationOutBase(_AggregationBase):
    """집계 Out 스키마 공통 필드 (id, created_at 포함)"""
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── 1시간 집계 ─────────────────────────────────────────────────────────────────

class HourlyAggregationCreate(_AggregationBase):
    hour_bucket: datetime
    llm_prediction: Optional[str] = None
    llm_model_used: Optional[str] = None


class HourlyAggregationOut(_AggregationOutBase):
    hour_bucket: datetime
    llm_prediction: Optional[str]
    llm_model_used: Optional[str]


# ── 1일 집계 ─────────────────────────────────────────────────────────────────

class DailyAggregationCreate(_AggregationBase):
    day_bucket: datetime


class DailyAggregationOut(_AggregationOutBase):
    day_bucket: datetime


# ── 7일 집계 ─────────────────────────────────────────────────────────────────

class WeeklyAggregationCreate(_AggregationBase):
    week_start: datetime


class WeeklyAggregationOut(_AggregationOutBase):
    week_start: datetime


# ── 월/분기/반기/연간 집계 ────────────────────────────────────────────────────

class MonthlyAggregationCreate(_AggregationBase):
    period_start: datetime
    period_type: str                        # monthly | quarterly | half_year | annual


class MonthlyAggregationOut(_AggregationOutBase):
    period_start: datetime
    period_type: str


class ReportHistoryCreate(BaseModel):
    report_type: str                        # daily | weekly | monthly | quarterly | half_year | annual
    period_start: datetime
    period_end: datetime
    teams_status: str = "sent"              # sent | failed
    llm_summary: Optional[str] = None
    system_count: Optional[int] = None


class ReportHistoryOut(BaseModel):
    id: int
    report_type: str
    period_start: datetime
    period_end: datetime
    sent_at: datetime
    teams_status: Optional[str]
    llm_summary: Optional[str]
    system_count: Optional[int]

    model_config = {"from_attributes": True}


# ── 설치 가이드 스키마 ─────────────────────────────────────────────────────────

class DownloadOption(BaseModel):
    label: str              # "Java 17+" / "Linux amd64"
    filename: str           # 스크립트가 기대하는 파일명
    download_url: str       # GitHub releases URL
    note: Optional[str] = None


class RequiredFile(BaseModel):
    filename: str           # 스크립트와 같은 디렉토리에 위치해야 하는 파일명
    description: str
    download_options: list[DownloadOption]


class InstallGuideOut(BaseModel):
    collector_type: str
    system_name: str
    host: str
    install_command: str            # 복사하여 실행할 install-agents.sh 명령어
    required_files: list[RequiredFile]
    prometheus_scrape_snippet: str  # prometheus.yml scrape_configs에 추가할 YAML 스니펫
    jvm_args: Optional[str] = None  # JMX 전용: JEUS JVM 옵션에 추가할 문자열


class CollectorStatusOut(BaseModel):
    status: str             # "up" | "down" | "unknown"
    last_scrape: Optional[str] = None
