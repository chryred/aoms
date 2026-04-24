from datetime import datetime
from typing import Annotated, Optional
from pydantic import BaseModel, Field, field_validator
from pydantic.functional_serializers import PlainSerializer

# API 응답 datetime: JSON 직렬화 시 'Z' suffix 포함 UTC ISO 8601
UtcDatetime = Annotated[
    datetime,
    PlainSerializer(
        lambda v: v.strftime('%Y-%m-%dT%H:%M:%S') + 'Z',
        return_type=str,
        when_used='json',
    ),
]


# ── System ──────────────────────────────────────────────────────────────
class SystemCreate(BaseModel):
    system_name: str
    display_name: str
    description: Optional[str] = None
    status: str = "active"
    teams_webhook_url: Optional[str] = None


class SystemUpdate(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    teams_webhook_url: Optional[str] = None


class SystemOut(BaseModel):
    id: int
    system_name: str
    display_name: str
    description: Optional[str]
    status: str
    teams_webhook_url: Optional[str]
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}


class SystemBrief(BaseModel):
    id: int
    system_name: str
    display_name: str

    model_config = {"from_attributes": True}


# ── SystemHost ───────────────────────────────────────────────────────────
class SystemHostCreate(BaseModel):
    host_ip: str
    role_label: Optional[str] = None

    @field_validator("host_ip")
    @classmethod
    def strip_host_ip(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("host_ip는 비워둘 수 없습니다.")
        return stripped


class SystemHostOut(BaseModel):
    id: int
    system_id: int
    host_ip: str
    role_label: Optional[str]
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


# ── Contact ──────────────────────────────────────────────────────────────
class ContactCreate(BaseModel):
    user_id: int
    teams_upn: Optional[str] = None
    webhook_url: Optional[str] = None


class ContactUpdate(BaseModel):
    teams_upn: Optional[str] = None
    webhook_url: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    user_id: int
    name: str              # user.name에서 파생
    email: Optional[str]   # user.email에서 파생
    teams_upn: Optional[str]
    webhook_url: Optional[str]
    created_at: UtcDatetime
    systems: list["SystemBrief"] = []

    model_config = {"from_attributes": False}


class ContactWithRoleOut(BaseModel):
    """log-analyzer용: 시스템명으로 담당자 조회 (role 포함)"""
    id: int
    name: str              # user.name에서 파생
    role: str
    teams_upn: Optional[str]
    webhook_url: Optional[str]

    model_config = {"from_attributes": False}


# ── LLM Agent Config ──────────────────────────────────────────────────
class LlmAgentConfigCreate(BaseModel):
    area_code: str
    area_name: str
    agent_code: str
    description: Optional[str] = None
    is_active: bool = True


class LlmAgentConfigUpdate(BaseModel):
    area_name: Optional[str] = None
    agent_code: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class LlmAgentConfigOut(BaseModel):
    id: int
    area_code: str
    area_name: str
    agent_code: str
    description: Optional[str]
    is_active: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime

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
    name: str              # user.name에서 파생
    email: Optional[str]   # user.email에서 파생

    model_config = {"from_attributes": False}


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
    resolved_at: Optional[UtcDatetime]
    error_message:    Optional[str]   # NULL=성공, 값=LLM/분석 실패 사유
    incident_id: Optional[int]
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class AcknowledgeRequest(BaseModel):
    acknowledged_by: str


# ── Feedback ───────────────────────────────────────────────────────────
class FeedbackCreateRequest(BaseModel):
    alert_history_id: int
    error_type: str
    solution: str
    resolver: str


class FeedbackUpdateRequest(BaseModel):
    error_type: str
    solution: str
    resolver: str


class FeedbackOut(BaseModel):
    id: int
    system_id: Optional[int]
    alert_history_id: Optional[int]
    error_type: str
    solution: str
    resolver: str
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class FeedbackSearchOut(BaseModel):
    id: int
    system_id: Optional[int] = None
    alert_history_id: Optional[int] = None
    error_type: str
    solution: str
    resolver: str
    created_at: UtcDatetime
    severity: Optional[str] = None
    alert_type: Optional[str] = None
    title: Optional[str] = None
    system_name: Optional[str] = None
    system_display_name: Optional[str] = None


class FeedbackSearchResponse(BaseModel):
    items: list[FeedbackSearchOut]
    total: int


# ── AlertExclusion ───────────────────────────────────────────────────────
class AlertExclusionItem(BaseModel):
    system_id: int
    instance_role: Optional[str] = None
    template: str
    reason: Optional[str] = None


class AlertExclusionCreate(BaseModel):
    items: list[AlertExclusionItem]
    created_by: Optional[str] = None


class AlertExclusionOut(BaseModel):
    id: int
    system_id: int
    instance_role: Optional[str]
    template: str
    reason: Optional[str]
    created_by: Optional[str]
    created_at: UtcDatetime
    active: bool
    deactivated_by: Optional[str]
    deactivated_at: Optional[UtcDatetime]
    skip_count: int
    last_skipped_at: Optional[UtcDatetime]

    model_config = {"from_attributes": True}


class AlertExclusionDeactivateRequest(BaseModel):
    ids: list[int]
    deactivated_by: Optional[str] = None


class BulkExcludeResult(BaseModel):
    succeeded: list[int]
    failed: list[dict]


class AlertsBulkExcludeRequest(BaseModel):
    alert_ids: list[int]
    reason: Optional[str] = None
    include_instance_role: bool = True
    created_by: Optional[str] = None


# ── LogAnalysis ──────────────────────────────────────────────────────────
class LogAnalysisCreate(BaseModel):
    model_config = {"protected_namespaces": ()}

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
    error_message:     Optional[str]        = None  # LLM/분석 실패 사유 (값 있으면 실패 레코드)
    # 예외 처리용: Prometheus log_error_total.template 라벨 목록
    templates:         Optional[list[str]]  = None
    # OTel trace 상관
    referenced_trace_ids: Optional[list[str]] = None
    trace_summary_text:   Optional[str]       = None


class LogAnalysisOut(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

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
    error_message:    Optional[str]   # NULL=성공, 값=LLM/분석 실패 사유
    created_at: UtcDatetime


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
    created_at: UtcDatetime
    updated_at: UtcDatetime

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
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


# ── 1시간 집계 ─────────────────────────────────────────────────────────────────

class HourlyAggregationCreate(_AggregationBase):
    hour_bucket: datetime
    llm_prediction: Optional[str] = None
    llm_model_used: Optional[str] = None


class HourlyAggregationOut(_AggregationOutBase):
    hour_bucket: UtcDatetime
    llm_prediction: Optional[str]
    llm_model_used: Optional[str]


# ── 1일 집계 ─────────────────────────────────────────────────────────────────

class DailyAggregationCreate(_AggregationBase):
    day_bucket: datetime


class DailyAggregationOut(_AggregationOutBase):
    day_bucket: UtcDatetime


# ── 7일 집계 ─────────────────────────────────────────────────────────────────

class WeeklyAggregationCreate(_AggregationBase):
    week_start: datetime


class WeeklyAggregationOut(_AggregationOutBase):
    week_start: UtcDatetime


# ── 월/분기/반기/연간 집계 ────────────────────────────────────────────────────

class MonthlyAggregationCreate(_AggregationBase):
    period_start: datetime
    period_type: str                        # monthly | quarterly | half_year | annual


class MonthlyAggregationOut(_AggregationOutBase):
    period_start: UtcDatetime
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
    period_start: UtcDatetime
    period_end: UtcDatetime
    sent_at: UtcDatetime
    teams_status: Optional[str]
    llm_summary: Optional[str]
    system_count: Optional[int]

    model_config = {"from_attributes": True}


# ── Agent (수집기 인스턴스) ──────────────────────────────────────────────────

class SSHSessionCreate(BaseModel):
    host: str
    port: int = 22
    username: str
    password: str


class SSHSessionOut(BaseModel):
    session_token: str
    host: str
    port: int
    username: str
    expires_in: int   # 초 단위 (600)


import re as _re

_SAFE_PATH_RE = _re.compile(r'^(~|~/[\w.\-]+(/[\w.\-]+)*|(/[\w.\-]+)+)$')


def _validate_unix_path(v: Optional[str]) -> Optional[str]:
    """쉘 메타문자와 경로 탈출을 차단하는 Unix 경로 검증."""
    if v is None:
        return v
    if not _SAFE_PATH_RE.match(v):
        raise ValueError('경로는 절대 경로여야 하며 특수문자를 포함할 수 없습니다')
    if '..' in v.split('/'):
        raise ValueError('경로에 상위 디렉터리 참조(..)를 사용할 수 없습니다')
    return v


class AgentInstanceCreate(BaseModel):
    system_id: int
    host: str
    agent_type: str = Field(
        pattern="^(alloy|node_exporter|jmx_exporter|synapse_agent|db|otel_javaagent)$"
    )
    install_path: Optional[str] = None   # db 에이전트는 바이너리 없음
    config_path: Optional[str] = None    # db 에이전트는 설정 파일 없음
    port: Optional[int] = None
    pid_file: Optional[str] = None
    label_info: Optional[str] = None   # JSON string
    os_type: Optional[str] = None      # 'linux' | 'windows'
    server_type: Optional[str] = None  # 'web' | 'was' | 'db' | 'middleware' | 'other'
    status: Optional[str] = None       # db 에이전트 등록 시 서버에서 'installed'로 설정

    @field_validator('install_path', 'config_path', 'pid_file', mode='before')
    @classmethod
    def check_path_safety(cls, v):
        return _validate_unix_path(v)


class AgentInstanceUpdate(BaseModel):
    install_path: Optional[str] = None
    config_path: Optional[str] = None
    port: Optional[int] = None
    pid_file: Optional[str] = None
    label_info: Optional[str] = None
    status: Optional[str] = None
    os_type: Optional[str] = None
    server_type: Optional[str] = None

    @field_validator('install_path', 'config_path', 'pid_file', mode='before')
    @classmethod
    def check_path_safety(cls, v):
        return _validate_unix_path(v)


class AgentInstanceOut(BaseModel):
    id: int
    system_id: int
    host: str
    agent_type: str
    install_path: Optional[str]   # db 에이전트는 null
    config_path: Optional[str]    # db 에이전트는 null
    port: Optional[int]
    pid_file: Optional[str]
    label_info: Optional[str]
    os_type: Optional[str]
    server_type: Optional[str]
    status: str
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}


class AgentInstallRequest(BaseModel):
    agent_id: int


class AgentInstallJobOut(BaseModel):
    job_id: str
    agent_id: Optional[int]
    status: str
    logs: Optional[str]
    error: Optional[str]
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}


class AgentConfigUpload(BaseModel):
    config_content: str   # YAML / .alloy 파일 전체 내용


class AgentStatusOut(BaseModel):
    agent_id: int
    status: str             # running | stopped | unknown
    pid: Optional[int]
    message: str


# ── Incident Lifecycle ───────────────────────────────────────────────────────

class IncidentUpdate(BaseModel):
    status: Optional[str] = None        # acknowledged | investigating | resolved | closed
    root_cause: Optional[str] = None
    resolution: Optional[str] = None
    postmortem: Optional[str] = None


class IncidentOut(BaseModel):
    id: int
    system_id: Optional[int]
    title: str
    severity: str
    status: str
    detected_at: UtcDatetime
    acknowledged_at: Optional[UtcDatetime]
    resolved_at: Optional[UtcDatetime]
    closed_at: Optional[UtcDatetime]
    root_cause: Optional[str]
    resolution: Optional[str]
    postmortem: Optional[str]
    alert_count: int
    recurrence_of: Optional[int]
    mtta_minutes: Optional[int] = None
    mttr_minutes: Optional[int] = None
    system_display_name: Optional[str] = None
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}


class IncidentTimelineItemOut(BaseModel):
    id: int
    incident_id: int
    event_type: str
    description: Optional[str]
    actor_name: Optional[str]
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class IncidentDetailOut(IncidentOut):
    timeline: list[IncidentTimelineItemOut] = []
    alert_history: list["AlertHistoryOut"] = []


class IncidentCommentCreate(BaseModel):
    comment: str


class IncidentAiAnalyzeOut(BaseModel):
    """/ai-analyze 응답 — LLM이 자동 작성한 근본원인/조치/사후분석"""
    root_cause: str
    resolution: str
    postmortem: str


# ── Incident Report ──────────────────────────────────────────────────────────

class IncidentReportOut(BaseModel):
    report: str


# ── Chatbot ─────────────────────────────────────────────────────────────────

class ChatToolOut(BaseModel):
    name: str
    display_name: str
    description: str
    executor: str
    input_schema: dict
    is_enabled: bool

    model_config = {"from_attributes": True}


class ChatToolUpdate(BaseModel):
    is_enabled: bool


class ChatExecutorConfigOut(BaseModel):
    executor: str
    config: dict                 # secret 필드는 "***"로 마스킹됨
    config_schema: list[dict]
    updated_at: Optional[UtcDatetime] = None


class ChatExecutorConfigUpdate(BaseModel):
    config: dict


class ChatExecutorTestRequest(BaseModel):
    config: Optional[dict] = None


class ChatExecutorTestResult(BaseModel):
    ok: bool
    message: Optional[str] = None


class ChatSessionOut(BaseModel):
    id: str
    title: str
    area_code: str
    created_at: UtcDatetime
    updated_at: UtcDatetime

    model_config = {"from_attributes": True}


class ChatAttachmentOut(BaseModel):
    key: str
    mime: str
    size: int
    width: Optional[int] = None
    height: Optional[int] = None


class ChatMessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    thought: Optional[str] = None
    tool_name: Optional[str] = None
    tool_args: Optional[dict] = None
    tool_result: Optional[dict] = None
    attachments: list[dict] = []
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class ChatSendIn(BaseModel):
    content: str
    attachment_keys: list[str] = []
