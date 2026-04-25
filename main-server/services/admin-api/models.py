import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, func
)
from sqlalchemy import JSON as JSONB
from sqlalchemy.orm import relationship
from database import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


class System(Base):
    __tablename__ = "systems"

    id = Column(Integer, primary_key=True)
    system_name = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(200), nullable=False)
    description = Column(Text)
    status = Column(String(20), default="active")
    teams_webhook_url = Column(Text)                   # 시스템별 Teams webhook (없으면 기본값 사용)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class SystemHost(Base):
    __tablename__ = "system_hosts"

    id         = Column(Integer, primary_key=True)
    system_id  = Column(Integer, ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    host_ip    = Column(String(100), nullable=False)
    role_label = Column(String(50))                  # WAS1, WAS2, DB1 등 표시용
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("system_id", "host_ip"),)


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    teams_upn = Column(String(200))                    # Teams mention용 UPN (예: user@company.com)
    webhook_url = Column(Text)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="contact")


class LlmAgentConfig(Base):
    """업무 영역별 LLM agent_code 관리 (DevX OAuth 마이그레이션)"""
    __tablename__ = "llm_agent_configs"

    id          = Column(Integer, primary_key=True)
    area_code   = Column(String(50), unique=True, nullable=False)   # log_analysis, metric_hourly_aggregation, ...
    area_name   = Column(String(200), nullable=False)               # 한국어 표시명
    agent_code  = Column(String(200), nullable=False)               # DevX agent code
    description = Column(Text)
    is_active   = Column(Boolean, default=True, server_default="true")
    created_at  = Column(DateTime, default=func.now(), server_default=func.now())
    updated_at  = Column(DateTime, default=func.now(), onupdate=func.now(), server_default=func.now())


class SystemContact(Base):
    __tablename__ = "system_contacts"

    id = Column(Integer, primary_key=True)
    system_id = Column(Integer, ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(50), default="primary")       # 'primary' | 'secondary'
    notify_channels = Column(String(200), nullable=False)  # 'teams,webhook' (콤마 구분)

    __table_args__ = (
        UniqueConstraint("system_id", "contact_id"),
    )


class Incident(Base):
    """인시던트 라이프사이클 — 관련 알림·분석을 하나의 사건으로 묶어 MTTR 추적"""
    __tablename__ = "incidents"

    id              = Column(Integer, primary_key=True)
    system_id       = Column(Integer, ForeignKey("systems.id"), nullable=True)
    title           = Column(String(500), nullable=False)
    severity        = Column(String(20), nullable=False)        # critical | warning
    status          = Column(String(20), nullable=False, default="open")
    # open | acknowledged | investigating | resolved | closed
    detected_at     = Column(DateTime, nullable=False)
    acknowledged_at = Column(DateTime)
    resolved_at     = Column(DateTime)
    closed_at       = Column(DateTime)
    acknowledged_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    root_cause      = Column(Text)
    resolution      = Column(Text)
    postmortem      = Column(Text)
    alert_count     = Column(Integer, default=1)
    recurrence_of   = Column(Integer, ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    created_at      = Column(DateTime, default=func.now())
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_incidents_system_status", "system_id", "status"),
        Index("idx_incidents_detected", "detected_at"),
    )


class IncidentTimeline(Base):
    """인시던트 이벤트 타임라인 — 상태 변경·알림 추가·댓글 이력"""
    __tablename__ = "incident_timeline"

    id          = Column(Integer, primary_key=True)
    incident_id = Column(Integer, ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    event_type  = Column(String(50), nullable=False)
    # alert_added | analysis_added | status_changed | comment
    description = Column(Text)
    actor_name  = Column(String(200))   # 사용자명 또는 "system"
    created_at  = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_incident_timeline_incident", "incident_id", "created_at"),
    )


class AlertHistory(Base):
    __tablename__ = "alert_history"

    id = Column(Integer, primary_key=True)
    system_id = Column(Integer, ForeignKey("systems.id"))
    alert_type = Column(String(50), nullable=False)    # 'metric' | 'log_analysis'
    severity = Column(String(20), nullable=False)      # 'info' | 'warning' | 'critical'
    alertname = Column(String(100))
    title = Column(String(500), nullable=False)
    description = Column(Text)
    instance_role = Column(String(50))                 # 이중화 역할 (was1, was2, db1 ...)
    host = Column(String(100))
    metric_name = Column(String(100))
    metric_value = Column(Float)
    notified_contacts = Column(Text)                   # JSON 문자열
    acknowledged = Column(Boolean, default=False)
    acknowledged_at = Column(DateTime)
    acknowledged_by = Column(String(100))
    escalated = Column(Boolean, default=False)
    # Phase 4c: 메트릭 벡터 유사도 분석 필드
    anomaly_type     = Column(String(20))              # 'new' | 'recurring' | 'related' | 'duplicate'
    similarity_score = Column(Float)
    qdrant_point_id  = Column(String(36))              # UUID
    resolved_at = Column(DateTime)                     # Alertmanager resolved 시 채워짐
    # LLM/분석 실패 이력: NULL=성공, 값=실패 사유 (UI "분석 실패" 뱃지 렌더링 조건)
    error_message    = Column(Text)
    # Phase OTel: 메트릭 알림 ↔ trace 링크 (NULL = OTel 미적용)
    related_trace_ids = Column(JSONB)
    # 인시던트 연결 (NULL = 인시던트 미생성)
    incident_id = Column(Integer, ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    # log_analysis 타입일 때 연결된 log_analysis_history (예외 처리 UI용 templates_json 조회)
    log_analysis_id = Column(Integer, ForeignKey("log_analysis_history.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_alert_history_system", "system_id", "created_at"),
        Index("idx_alert_history_created", "created_at"),
        Index("idx_alert_history_incident", "incident_id"),
    )


class LogAnalysisHistory(Base):
    __tablename__ = "log_analysis_history"

    id = Column(Integer, primary_key=True)
    system_id = Column(Integer, ForeignKey("systems.id"))
    instance_role = Column(String(50))
    log_content = Column(Text, nullable=False)
    analysis_result = Column(Text, nullable=False)
    severity = Column(String(20), nullable=False)
    root_cause = Column(Text)
    recommendation = Column(Text)
    model_used = Column(String(100))
    processing_time = Column(Float)
    alert_sent = Column(Boolean, default=False)
    # Phase 4b: 벡터 유사도 분석 필드
    anomaly_type     = Column(String(20))    # 'new' | 'recurring' | 'related' | 'duplicate'
    similarity_score = Column(Float)
    qdrant_point_id  = Column(String(36))    # UUID
    has_solution     = Column(Boolean, default=False)
    # LLM/분석 실패 이력: NULL=성공, 값=실패 사유 (UI "분析 실패" 뱃지 렌더링 조건)
    error_message    = Column(Text)
    # Phase OTel: 분산 추적 상관 컬럼 (NULL = OTel 미적용)
    referenced_trace_ids = Column(JSONB)
    trace_summary_text   = Column(Text)
    # 인시던트 연결 (NULL = 인시던트 미생성)
    incident_id = Column(Integer, ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True)
    # 예외 처리 (NULL = 정상 분석)
    excluded           = Column(Boolean, default=False, server_default="false")
    exclusion_rule_id  = Column(Integer, ForeignKey("alert_exclusions.id", ondelete="SET NULL"), nullable=True)
    # 개별 template 목록 (Prometheus log_error_total.template 라벨 원본, 예외 처리 UI용)
    templates_json     = Column(JSONB)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_log_analysis_system", "system_id", "created_at"),
        Index("idx_log_analysis_excluded", "excluded", "system_id"),
    )


class AlertFeedback(Base):
    """WF3: n8n 피드백 처리 워크플로우에서 INSERT"""
    __tablename__ = "alert_feedback"

    id               = Column(Integer, primary_key=True)
    system_id        = Column(Integer, ForeignKey("systems.id"), nullable=True)
    alert_history_id = Column(Integer, ForeignKey("alert_history.id"), nullable=True)
    error_type       = Column(String(100), nullable=False)
    solution         = Column(Text, nullable=False)
    resolver         = Column(String(200), nullable=False)
    qdrant_point_id  = Column(String(36), nullable=True)   # 해결책 임베딩 후 저장된 Qdrant point ID
    created_at       = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_alert_feedback_system", "system_id", "created_at"),
    )


class AlertCooldown(Base):
    __tablename__ = "alert_cooldown"

    id = Column(Integer, primary_key=True)
    system_id = Column(Integer, ForeignKey("systems.id"))
    alert_key = Column(String(500), nullable=False)    # "{system_name}:{instance_role}:{alertname}:{severity}"
    last_sent_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("system_id", "alert_key"),
        Index("idx_alert_cooldown_lookup", "system_id", "alert_key"),
    )


class AlertExclusion(Base):
    """에러 알림 예외 처리 규칙 — 동일 template이 수집되어도 알림/인시던트/LLM 분석 생략"""
    __tablename__ = "alert_exclusions"

    id                   = Column(Integer, primary_key=True)
    system_id            = Column(Integer, ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    instance_role        = Column(String(50), nullable=True)   # NULL = 해당 시스템 전체 role에 적용
    template             = Column(Text, nullable=False)        # synapse_agent 정규화 template 라벨 원본
    reason               = Column(Text)
    created_by           = Column(String(100))
    created_at           = Column(DateTime, default=func.now())
    active               = Column(Boolean, default=True, server_default="true")
    deactivated_by       = Column(String(100))
    deactivated_at       = Column(DateTime)
    skip_count           = Column(Integer, default=0, server_default="0")
    last_skipped_at      = Column(DateTime)
    # 5분 윈도우 내 발생 건수 임계값 (NULL = 무제한, 모든 count에 대해 예외 적용)
    max_count_per_window = Column(Integer)
    # 자동 만료 시각 (NULL = 만료 없음). UTC naive — Lazy 검증 (매칭 시점에 비교)
    expires_at           = Column(DateTime)

    __table_args__ = (
        Index("idx_alert_exclusions_active_system", "system_id", "active"),
        Index("idx_alert_exclusions_expires_at", "expires_at"),
    )


# ── Phase 5: 계층적 집계 & 장애 예방 ────────────────────────────────────────

class SystemCollectorConfig(Base):
    """수집기 유연 레지스트리 — 시스템별로 어떤 exporter의 어떤 metric_group을 집계할지 등록"""
    __tablename__ = "system_collector_config"

    id             = Column(Integer, primary_key=True)
    system_id      = Column(Integer, ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    collector_type = Column(String(50), nullable=False)   # node_exporter | jmx_exporter | db_exporter | custom
    metric_group   = Column(String(100), nullable=False)  # cpu | memory | disk | network | jvm_heap | thread_pool | ...
    enabled        = Column(Boolean, default=True)
    prometheus_job = Column(String(200))                  # Prometheus job label (쿼리 범위 한정)
    custom_config  = Column(Text)                         # JSON 형태 파라미터 (선택)
    created_at     = Column(DateTime, default=func.now())
    updated_at     = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("system_id", "collector_type", "metric_group"),
        Index("idx_collector_config_system", "system_id", "collector_type"),
    )


class MetricHourlyAggregation(Base):
    """1시간 단위 메트릭 집계 — WF6이 매 시간 Prometheus 쿼리 후 저장"""
    __tablename__ = "metric_hourly_aggregations"

    id             = Column(Integer, primary_key=True)
    system_id      = Column(Integer, ForeignKey("systems.id"), nullable=False)
    hour_bucket    = Column(DateTime, nullable=False)     # 시간 단위 truncate (UTC)
    collector_type = Column(String(50), nullable=False)
    metric_group   = Column(String(100), nullable=False)
    metrics_json   = Column(Text, nullable=False)         # JSON: avg/max/min/p95 등 집계값
    # LLM 분석 (이상 감지 시에만 채워짐)
    llm_summary    = Column(Text)
    llm_severity   = Column(String(20))                   # normal | warning | critical
    llm_trend      = Column(Text)                         # 추세 설명 (1문장)
    llm_prediction = Column(Text)                         # 임계치 도달 예측 ("3.2시간 후 85% 도달 예상")
    llm_model_used = Column(String(100))
    qdrant_point_id = Column(String(36))                  # metric_hourly_patterns 컬렉션 UUID
    created_at     = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("system_id", "hour_bucket", "collector_type", "metric_group"),
        Index("idx_hourly_agg_system_time", "system_id", "hour_bucket"),
        Index("idx_hourly_agg_severity", "llm_severity", "hour_bucket"),
    )


class MetricDailyAggregation(Base):
    """1일 단위 집계 — WF7이 매일 07:30에 전일 hourly 데이터를 요약"""
    __tablename__ = "metric_daily_aggregations"

    id             = Column(Integer, primary_key=True)
    system_id      = Column(Integer, ForeignKey("systems.id"), nullable=False)
    day_bucket     = Column(DateTime, nullable=False)     # 날짜 단위 truncate (UTC)
    collector_type = Column(String(50), nullable=False)
    metric_group   = Column(String(100), nullable=False)
    metrics_json   = Column(Text, nullable=False)         # 일간 통계 (peak_hour, anomaly_hours 등 포함)
    llm_summary    = Column(Text)
    llm_severity   = Column(String(20))
    llm_trend      = Column(Text)
    qdrant_point_id = Column(String(36))
    created_at     = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("system_id", "day_bucket", "collector_type", "metric_group"),
        Index("idx_daily_agg_system_time", "system_id", "day_bucket"),
    )


class MetricWeeklyAggregation(Base):
    """7일 단위 집계 — WF8이 매주 월요일 08:00에 전주 daily 데이터를 요약"""
    __tablename__ = "metric_weekly_aggregations"

    id             = Column(Integer, primary_key=True)
    system_id      = Column(Integer, ForeignKey("systems.id"), nullable=False)
    week_start     = Column(DateTime, nullable=False)     # 해당 주 월요일 00:00 UTC
    collector_type = Column(String(50), nullable=False)
    metric_group   = Column(String(100), nullable=False)
    metrics_json   = Column(Text, nullable=False)
    llm_summary    = Column(Text)
    llm_severity   = Column(String(20))
    llm_trend      = Column(Text)
    qdrant_point_id = Column(String(36))
    created_at     = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("system_id", "week_start", "collector_type", "metric_group"),
        Index("idx_weekly_agg_system_time", "system_id", "week_start"),
    )


class MetricMonthlyAggregation(Base):
    """월/분기/반기/연간 집계 — period_type으로 구분 (단일 테이블)"""
    __tablename__ = "metric_monthly_aggregations"

    id             = Column(Integer, primary_key=True)
    system_id      = Column(Integer, ForeignKey("systems.id"), nullable=False)
    period_start   = Column(DateTime, nullable=False)     # 해당 기간 시작일
    period_type    = Column(String(20), nullable=False)   # monthly | quarterly | half_year | annual
    collector_type = Column(String(50), nullable=False)
    metric_group   = Column(String(100), nullable=False)
    metrics_json   = Column(Text, nullable=False)
    llm_summary    = Column(Text)
    llm_severity   = Column(String(20))
    llm_trend      = Column(Text)
    qdrant_point_id = Column(String(36))
    created_at     = Column(DateTime, default=func.now())

    __table_args__ = (
        UniqueConstraint("system_id", "period_start", "period_type", "collector_type", "metric_group"),
        Index("idx_monthly_agg_system_time", "system_id", "period_start", "period_type"),
    )


class AggregationReportHistory(Base):
    """Teams로 발송된 집계 리포트 이력 — 중복 발송 방지 및 이력 조회"""
    __tablename__ = "aggregation_report_history"

    id           = Column(Integer, primary_key=True)
    report_type  = Column(String(20), nullable=False)   # daily | weekly | monthly | quarterly | half_year | annual
    period_start = Column(DateTime, nullable=False)
    period_end   = Column(DateTime, nullable=False)
    sent_at      = Column(DateTime, default=func.now())
    teams_status = Column(String(20))                   # sent | failed
    llm_summary  = Column(Text)
    system_count = Column(Integer)

    __table_args__ = (
        UniqueConstraint("report_type", "period_start"),
        Index("idx_report_history_type_time", "report_type", "period_start"),
    )


class AgentInstance(Base):
    """설치된 수집기 인스턴스 메타정보 (계정 정보는 저장하지 않음)"""
    __tablename__ = "agent_instances"

    id           = Column(Integer, primary_key=True)
    system_id    = Column(Integer, ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    host         = Column(String(200), nullable=False)          # 서버 IP
    agent_type   = Column(String(50), nullable=False)           # synapse_agent | db | otel_javaagent | cli
    install_path = Column(String(500), nullable=True)           # 바이너리 경로 (db 에이전트는 NULL)
    config_path  = Column(String(500), nullable=True)           # 설정파일 경로 (db 에이전트는 NULL)
    port         = Column(Integer)                              # 메트릭 노출 포트
    os_type      = Column(String(20))                            # 'linux' | 'windows' — 에이전트 설치 서버 OS
    server_type  = Column(String(50))                           # 'web' | 'was' | 'db' | 'middleware' | 'other' — 서버 역할
    pid_file     = Column(String(500))                          # PID 파일 경로 (systemd 없으므로)
    label_info   = Column(Text)                                 # JSON: system_name, instance_role 등
    status       = Column(String(20), default="unknown")        # installed | running | stopped | unknown
    created_at   = Column(DateTime, default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_agent_instances_system", "system_id", "agent_type"),
        Index("idx_agent_instances_host", "host"),
    )


class AgentInstallJob(Base):
    """비동기 설치 Job 이력 (완료/실패 로그 보존용)"""
    __tablename__ = "agent_install_jobs"

    id           = Column(Integer, primary_key=True)
    job_id       = Column(String(36), unique=True, nullable=False)   # UUID
    agent_id     = Column(Integer, ForeignKey("agent_instances.id", ondelete="SET NULL"), nullable=True)
    status       = Column(String(20), default="pending")             # pending | running | done | failed
    logs         = Column(Text)                                      # 진행 로그 (누적 텍스트)
    error        = Column(Text)
    created_at   = Column(DateTime, default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_install_jobs_job_id", "job_id"),
    )


class User(Base):
    """프론트엔드 인증 사용자 — role: admin | operator"""
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True)
    email         = Column(String(200), unique=True, nullable=False, index=True)
    password_hash = Column(String(200), nullable=False)
    name          = Column(String(100), nullable=False)
    role          = Column(String(20), nullable=False, default="operator")
    is_active     = Column(Boolean, nullable=False, default=True)
    is_approved   = Column(Boolean, nullable=False, default=False)
    created_at    = Column(DateTime, nullable=False, default=func.now())

    contact = relationship("Contact", back_populates="user", uselist=False)


# ── Chatbot (ReAct) ────────────────────────────────────────────────────

class ChatTool(Base):
    """챗봇이 ReAct 루프에서 호출할 수 있는 도구 레지스트리."""
    __tablename__ = "chat_tools"

    name         = Column(String(100), primary_key=True)
    display_name = Column(String(200), nullable=False)
    description  = Column(Text, nullable=False)
    input_schema = Column(JSONB, nullable=False, default=dict, server_default="{}")
    executor     = Column(String(20), nullable=False)   # 'ems' | 'admin' | 'log_analyzer'
    is_enabled   = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at   = Column(DateTime, default=func.now(), server_default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now(), server_default=func.now())


class ChatExecutorConfig(Base):
    """Executor별 자격증명/설정 — secret 필드는 Fernet 암호문 문자열로 저장."""
    __tablename__ = "chat_executor_configs"

    executor      = Column(String(20), primary_key=True)
    config        = Column(JSONB, nullable=False, default=dict)
    config_schema = Column(JSONB, nullable=False, default=list)
    updated_by    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())


class ChatSession(Base):
    """사용자 챗봇 세션. 닫아도 대화 유지."""
    __tablename__ = "chat_sessions"

    id         = Column(String(36), primary_key=True, default=_uuid_str)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title      = Column(String(200), nullable=False, default="새 대화")
    area_code  = Column(String(50), nullable=False, default="chat_assistant")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_chat_sessions_user", "user_id", "updated_at"),
    )


class ChatMessage(Base):
    """세션 내 메시지. role ∈ user|assistant|tool."""
    __tablename__ = "chat_messages"

    id          = Column(String(36), primary_key=True, default=_uuid_str)
    session_id  = Column(String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role        = Column(String(20), nullable=False)
    content     = Column(Text, nullable=False, default="")
    thought     = Column(Text)
    tool_name   = Column(String(100))
    tool_args   = Column(JSONB)
    tool_result = Column(JSONB)
    attachments = Column(JSONB, nullable=False, default=list)   # [{type,key,mime,size,w,h}]
    created_at  = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_chat_messages_session", "session_id", "created_at"),
    )
