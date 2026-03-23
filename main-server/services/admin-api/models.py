from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, func
)
from database import Base


class System(Base):
    __tablename__ = "systems"

    id = Column(Integer, primary_key=True)
    system_name = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(200), nullable=False)
    description = Column(Text)
    host = Column(String(200), nullable=False)
    os_type = Column(String(20), nullable=False)       # 'linux' | 'windows'
    system_type = Column(String(50), nullable=False)   # 'web' | 'was' | 'db' | 'middleware'
    status = Column(String(20), default="active")
    teams_webhook_url = Column(Text)                   # 시스템별 Teams webhook (없으면 기본값 사용)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    email = Column(String(200))
    teams_upn = Column(String(200))                    # Teams mention용 UPN (예: user@company.com)
    webhook_url = Column(Text)
    llm_api_key = Column(Text)                         # 담당자별 LLM API key (비용 분리 청구용)
    agent_code = Column(String(100))                   # 담당자별 LLM Agent code
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


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
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_alert_history_system", "system_id", "created_at"),
        Index("idx_alert_history_created", "created_at"),
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
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_log_analysis_system", "system_id", "created_at"),
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
