from datetime import datetime
from typing import Annotated, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator
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


# ── Dashboard — 인스턴스별 상태 ──────────────────────────────────────────
class InstanceStatusOut(BaseModel):
    """대시보드 시스템 상태 응답의 인스턴스별 상태 항목"""
    instance_role: str                   # Prometheus 레이블 (was1, db1, …)
    server_type: Optional[str] = None   # agent_instances.server_type (web/was/db/middleware/other)
    status: str                          # normal | warning | critical | inactive
    worst_metric: Optional[str] = None  # 상태를 유발한 메트릭 그룹 (예: cpu, memory)


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
# ISP(인터페이스 분리 원칙) — 2-6 리팩터
# AlertHistoryBaseOut: 모든 alert_type에 공통인 필드
# AlertHistoryMetricOut: metric 타입 전용 필드 추가
# AlertHistoryLogOut: log_analysis 타입 전용 필드 추가
# AlertHistoryOut: 하위 호환 슈퍼셋 — 기존 라우트·프론트 JSON 그대로 유지
class AlertHistoryBaseOut(BaseModel):
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
    resolved_at: Optional[UtcDatetime]
    error_message:    Optional[str]   # NULL=성공, 값=LLM/분석 실패 사유
    incident_id: Optional[int]
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class AlertHistoryMetricOut(AlertHistoryBaseOut):
    """metric 알림 전용 — 벡터 유사도 분석 필드 포함."""
    anomaly_type:     Optional[str] = None
    similarity_score: Optional[float] = None
    qdrant_point_id:  Optional[str] = None


class AlertHistoryLogOut(AlertHistoryBaseOut):
    """log_analysis 알림 전용 — 벡터 유사도 분석 필드 포함."""
    anomaly_type:     Optional[str] = None
    similarity_score: Optional[float] = None
    qdrant_point_id:  Optional[str] = None


# 하위 호환 슈퍼셋: 기존 라우트·프론트엔드 JSON 와이어 포맷 변경 없이 유지
# (metric/log_analysis 공통으로 쓰는 라우트, incidents.py 등이 이 타입을 그대로 사용)
class AlertHistoryOut(AlertHistoryBaseOut):
    # Phase 4c: 메트릭·로그 유사도 분석 필드 (타입별 의미 다르나 슈퍼셋으로 노출)
    anomaly_type:     Optional[str] = None
    similarity_score: Optional[float] = None
    qdrant_point_id:  Optional[str] = None


class AcknowledgeRequest(BaseModel):
    acknowledged_by: str


# ── Feedback ───────────────────────────────────────────────────────────
class FeedbackAttachmentOut(BaseModel):
    id: int
    file_path: str
    original_filename: Optional[str] = None
    sort_order: int = 0
    ocr_text: Optional[str] = None
    ocr_status: str = "pending"
    ocr_progress: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class FeedbackCreateRequest(BaseModel):
    error_type: str
    solution: str
    resolver: str
    approver_contact_id: int
    attachment_paths: list[str] = []
    attachment_filenames: list[str] | None = None  # 업로드 시 원본 파일명 (attachment_paths와 같은 순서)


class FeedbackUpdateRequest(BaseModel):
    error_type: str
    solution: str
    resolver: str


class FeedbackOut(BaseModel):
    id: int
    incident_id: int
    error_type: str
    solution: str
    resolver: str
    created_at: UtcDatetime
    status: str = "approved"
    approver_id: Optional[int] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    rejected_at: Optional[datetime] = None
    revision_count: int = 0
    revision_reason: Optional[str] = None
    qdrant_point_id: Optional[str] = None
    attachments: list[FeedbackAttachmentOut] = []

    model_config = {"from_attributes": True}


class FeedbackSearchOut(BaseModel):
    id: int
    incident_id: int
    error_type: str
    solution: str
    resolver: str
    created_at: UtcDatetime
    severity: Optional[str] = None
    alert_type: Optional[str] = None
    title: Optional[str] = None
    system_name: Optional[str] = None
    system_display_name: Optional[str] = None
    status: str = "approved"
    approved_at: Optional[datetime] = None


class FeedbackSearchResponse(BaseModel):
    items: list[FeedbackSearchOut]
    total: int


class FeedbackRejectRequest(BaseModel):
    rejection_reason: str


class FeedbackResubmitRequest(BaseModel):
    error_type: str
    solution: str
    attachment_paths: list[str] = []
    attachment_filenames: list[str] | None = None  # 업로드 시 원본 파일명 (attachment_paths와 같은 순서)
    kept_attachment_ids: list[int] | None = None  # 보존할 기존 첨부 ID. None=모두 보존, []=모두 제거, [...]=명시 ID만 보존
    revision_reason: Optional[str] = None  # 재등록 사유 (선택). 승인자가 변경 의도를 확인하도록 사용.


class FeedbackUploadResponse(BaseModel):
    file_path: str
    original_filename: str


class ApproverContactOut(BaseModel):
    id: int                    # contact.id
    user_id: int
    name: str
    email: str
    teams_upn: Optional[str] = None
    has_webhook: bool          # webhook_url 보유 여부 (URL 자체는 노출 금지)
    model_config = ConfigDict(from_attributes=True)


# ── Incident Feedback (Wave 2A) ───────────────────────────────────────────
class IncidentStatsOut(BaseModel):
    """GET /api/v1/incidents/stats 응답 — 3카드 통계"""
    total: int
    registrable: int
    completed: int


class IncidentFeedbackPendingOut(BaseModel):
    """GET /api/v1/incidents/feedback/pending 목록 카드용"""
    feedback_id: int
    incident_id: int
    incident_title: str
    system_display_name: Optional[str]
    alert_count: int
    resolver: str
    approver_name: Optional[str]
    created_at: UtcDatetime
    revision_count: int
    status: str  # pending | rejected
    can_approve: bool = False  # admin 또는 지정 승인자 여부


# ── AlertExclusion ───────────────────────────────────────────────────────
class AlertExclusionItem(BaseModel):
    system_id: int
    instance_role: Optional[str] = None
    template: str
    reason: Optional[str] = None
    # 5분 윈도우 내 발생 건수 임계값 (None = 무제한)
    max_count_per_window: Optional[int] = None
    # 자동 만료 시각 (None = 만료 없음). 입력은 UTC naive 또는 ISO 8601 'Z'.
    expires_at: Optional[datetime] = None


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
    max_count_per_window: Optional[int] = None
    expires_at: Optional[UtcDatetime] = None

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
    max_count_per_window: Optional[int] = None
    expires_at: Optional[datetime] = None


class AlertsTemplatesRequest(BaseModel):
    alert_ids: list[int]


class AlertTemplatesOut(BaseModel):
    alert_id: int
    system_id: Optional[int]
    instance_role: Optional[str]
    templates: list[str]


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
    # 예외 처리 count 임계값 검증용: {template: count} 매핑 (5분 윈도우 합계)
    template_counts:   Optional[dict[str, int]] = None
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


# ── SchedulerRunHistory ──────────────────────────────────────────────────────

class SchedulerRunCreate(BaseModel):
    scheduler_type: str
    started_at: datetime
    finished_at: datetime
    status: str                          # ok | error
    error_count: int = 0
    analyzed_count: int = 0
    summary_json: Optional[dict] = None
    error_message: Optional[str] = None


class SchedulerRunOut(BaseModel):
    id: int
    scheduler_type: str
    started_at: UtcDatetime
    finished_at: UtcDatetime
    status: str
    error_count: int
    analyzed_count: int
    summary_json: Optional[dict]
    error_message: Optional[str]
    created_at: UtcDatetime

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
        pattern="^(alloy|node_exporter|jmx_exporter|synapse_agent|db|otel_javaagent|cli)$"
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
    system_id: Optional[int]
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

class IncidentCreate(BaseModel):
    system_id: int
    title: str
    severity: str                        # critical | warning | info
    notes: Optional[str] = None         # 초기 상황 메모 → root_cause에 저장


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    severity: Optional[str] = None      # critical | warning | info
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
    has_approved_feedback: bool = False
    latest_feedback_status: Optional[str] = None  # 가장 최근 피드백의 status (pending/approved/rejected/None)
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
    # status 기반 정적 가이드 — UI 카드 렌더용 (next_action: 한 줄 권장 행동, status_ko: 한국어 라벨, progress_pct: 0-100)
    next_action_meta: Optional[dict] = None


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
    system_ids: list[int] = []
    deleted_at: Optional[UtcDatetime] = None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    # q 검색 시 메시지 본문 매칭 미리보기 (최대 120자, 매칭 부분 ±50자 컨텍스트). 미검색/제목만 매칭이면 None.
    match_preview: Optional[str] = None
    # 매칭이 메시지에서 발생했는지 (제목 매칭과 구분)
    matched_in: Optional[str] = None  # 'title' | 'message' | None

    model_config = {"from_attributes": True}


class ChatSessionPatchIn(BaseModel):
    title: Optional[str] = None
    system_ids: Optional[list[int]] = None


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
    # V1 RAG: federated search 품질 추적
    rag_top1_score: Optional[float] = None
    rag_sources_count: Optional[int] = None
    system_id: Optional[int] = None
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class ScreenContext(BaseModel):
    screen: str | None = None        # 'dashboard', 'incidents', 'systems', 'reports', 'knowledge', 'alerts'
    screen_label: str | None = None   # 사람이 읽는 한국어 라벨
    system_id: str | None = None
    incident_id: str | None = None


class ChatSendIn(BaseModel):
    content: str
    attachment_keys: list[str] = []
    screen_context: ScreenContext | None = None  # 현재 사용자 화면 컨텍스트 (옵셔널)


# ── V1 Knowledge RAG ─────────────────────────────────────────────────────────

class KnowledgeCorrectionCreate(BaseModel):
    source_point_id:   str
    source_collection: str
    question:          Optional[str] = None
    wrong_answer:      Optional[str] = None
    correct_answer:    str


class KnowledgeCorrectionOut(BaseModel):
    id:                int
    source_point_id:   str
    source_collection: str
    question:          Optional[str]
    wrong_answer:      Optional[str]
    correct_answer:    str
    user_id:           Optional[int]
    created_at:        UtcDatetime

    model_config = {"from_attributes": True}


class KnowledgeSyncStatusOut(BaseModel):
    source:        str
    last_sync_at:  Optional[UtcDatetime]
    total_synced:  int
    last_error:    Optional[str]
    updated_at:    UtcDatetime

    model_config = {"from_attributes": True}
