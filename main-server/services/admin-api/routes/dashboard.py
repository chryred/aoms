"""
대시보드 통합 API
- 전체 시스템 상태 종합 조회
- 시스템별 상세 정보 조회 (활성 알림, 로그분석, 권장조치, 예방 패턴)
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import (
    AlertHistory,
    Contact,
    LogAnalysisHistory,
    MetricHourlyAggregation,
    System,
    SystemContact,
)

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


# ==================== 내부 VO ====================

class _SystemHealth:
    """_get_system_health() 반환용 내부 객체"""
    def __init__(self):
        self.status: str = "normal"          # normal | warning | critical
        self.reason: str = "모니터링 정상"
        self.metric_alerts_count: int = 0
        self.log_analysis_severity: Optional[str] = None
        self.proactive_count: int = 0        # 예방 패턴 감지 건수


# ==================== 헬퍼 ====================

async def _get_system_health(db: AsyncSession, system_id: int) -> _SystemHealth:
    """시스템 상태 종합 판정

    판정 기준 (우선순위):
      1. 최근 1h 메트릭 알림 critical/warning
      2. 최근 1h 로그분석 LLM 결과 critical/warning
      3. 예방 패턴 (MetricHourlyAggregation.llm_prediction)
    """
    health = _SystemHealth()
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    eight_hours_ago = datetime.utcnow() - timedelta(hours=8)

    # 1. 메트릭 알림 (최근 1시간)
    result = await db.execute(
        select(AlertHistory).where(
            and_(
                AlertHistory.system_id == system_id,
                AlertHistory.alert_type == "metric",
                AlertHistory.created_at >= one_hour_ago,
            )
        )
    )
    recent_alerts = result.scalars().all()

    critical_count = sum(1 for a in recent_alerts if a.severity == "critical")
    warning_count  = sum(1 for a in recent_alerts if a.severity == "warning")
    health.metric_alerts_count = critical_count + warning_count

    # 2. 로그분석 (최근 1시간)
    result = await db.execute(
        select(LogAnalysisHistory).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.created_at >= one_hour_ago,
            )
        ).order_by(desc(LogAnalysisHistory.created_at)).limit(5)
    )
    log_results = result.scalars().all()

    if log_results:
        severities = [r.severity for r in log_results]
        if "critical" in severities:
            health.log_analysis_severity = "critical"
        elif "warning" in severities:
            health.log_analysis_severity = "warning"

    # 3. 예방적 패턴 감지 (최근 8시간 집계 중 llm_prediction 존재)
    result = await db.execute(
        select(MetricHourlyAggregation).where(
            and_(
                MetricHourlyAggregation.system_id == system_id,
                MetricHourlyAggregation.llm_prediction.isnot(None),
                MetricHourlyAggregation.llm_severity.in_(["warning", "critical"]),
                MetricHourlyAggregation.hour_bucket >= eight_hours_ago,
            )
        ).order_by(desc(MetricHourlyAggregation.hour_bucket)).limit(5)
    )
    proactive_rows = result.scalars().all()
    health.proactive_count = len(proactive_rows)

    # 최종 상태 판정
    reasons: list[str] = []

    if critical_count > 0 or health.log_analysis_severity == "critical":
        health.status = "critical"
        if critical_count > 0:
            reasons.append(f"메트릭 알림 {critical_count}개")
        if health.log_analysis_severity == "critical":
            reasons.append("로그 이상 감지")

    elif warning_count > 0 or health.log_analysis_severity == "warning":
        health.status = "warning"
        if warning_count > 0:
            reasons.append(f"메트릭 알림 {warning_count}개")
        if health.log_analysis_severity == "warning":
            reasons.append("로그 이상 경고")

    elif health.proactive_count > 0:
        # 현재는 정상이지만 예방 패턴 감지 시 proactive 표시
        health.status = "normal"
        reasons.append(f"예방 패턴 {health.proactive_count}건 감지")

    health.reason = " / ".join(reasons) if reasons else "모니터링 정상"
    return health


# ==================== 엔드포인트 ====================

@router.get("/system-health")
async def get_dashboard_health(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """전체 시스템 상태 종합 — 대시보드 메인 데이터

    응답:
      summary  : 전체 통계 (critical/warning/normal 집계, 총 알림 수)
      systems  : 시스템별 상태 목록 (카드형 UI용)
    """
    result = await db.execute(
        select(System).where(System.status == "active").order_by(System.display_name)
    )
    systems = result.scalars().all()

    system_list = []
    summary = {
        "total_systems":      0,
        "critical_systems":   0,
        "warning_systems":    0,
        "normal_systems":     0,
        "proactive_systems":  0,   # 예방 패턴 감지된 시스템 수
        "total_metric_alerts": 0,
        "last_updated":       datetime.utcnow().isoformat(),
    }

    for sys in systems:
        health = await _get_system_health(db, sys.id)

        system_list.append({
            "system_id":      sys.id,
            "display_name":   sys.display_name,
            "system_name":    sys.system_name,
            "status":         health.status,
            "reason":         health.reason,
            "system_type":    sys.system_type,
            "os_type":        sys.os_type,
            "proactive_count": health.proactive_count,
        })

        summary["total_systems"] += 1
        summary["total_metric_alerts"] += health.metric_alerts_count

        if health.status == "critical":
            summary["critical_systems"] += 1
        elif health.status == "warning":
            summary["warning_systems"] += 1
        else:
            summary["normal_systems"] += 1

        if health.proactive_count > 0:
            summary["proactive_systems"] += 1

    return {"summary": summary, "systems": system_list}


@router.get("/systems/{system_id}/detailed")
async def get_system_detail_health(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """시스템 상세 정보 — 상세 페이지 전용

    포함 데이터:
      metric_alerts    : 최근 1h 활성 메트릭 알림
      log_analysis     : 최근 1h 로그분석 결과 (5건)
      proactive_alerts : 최근 8h 예방적 패턴 (llm_prediction 있는 항목)
      contacts         : 담당자 목록
    """
    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    one_hour_ago   = datetime.utcnow() - timedelta(hours=1)
    eight_hours_ago = datetime.utcnow() - timedelta(hours=8)

    # 1. 활성 메트릭 알림 (최근 1h)
    result = await db.execute(
        select(AlertHistory).where(
            and_(
                AlertHistory.system_id == system_id,
                AlertHistory.alert_type == "metric",
                AlertHistory.created_at >= one_hour_ago,
            )
        ).order_by(desc(AlertHistory.created_at))
    )
    metric_alerts = result.scalars().all()

    # 2. 최근 로그분석 결과 (최근 1h, 5건)
    result = await db.execute(
        select(LogAnalysisHistory).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.created_at >= one_hour_ago,
            )
        ).order_by(desc(LogAnalysisHistory.created_at)).limit(5)
    )
    log_analyses = result.scalars().all()

    # 3. 예방적 패턴 (최근 8h, llm_prediction 있는 항목)
    result = await db.execute(
        select(MetricHourlyAggregation).where(
            and_(
                MetricHourlyAggregation.system_id == system_id,
                MetricHourlyAggregation.llm_prediction.isnot(None),
                MetricHourlyAggregation.llm_severity.in_(["warning", "critical"]),
                MetricHourlyAggregation.hour_bucket >= eight_hours_ago,
            )
        ).order_by(desc(MetricHourlyAggregation.hour_bucket)).limit(5)
    )
    proactive_rows = result.scalars().all()

    # 4. 담당자
    result = await db.execute(
        select(SystemContact).where(SystemContact.system_id == system_id)
    )
    system_contacts = result.scalars().all()

    contacts = []
    for sc in system_contacts:
        contact = await db.get(Contact, sc.contact_id)
        if contact:
            contacts.append({
                "id":         contact.id,
                "name":       contact.name,
                "teams_upn":  contact.teams_upn,
                "email":      contact.email,
                "role":       sc.role,
            })

    return {
        "system_id":    system.id,
        "display_name": system.display_name,
        "system_name":  system.system_name,
        "system_type":  system.system_type,

        "metric_alerts": [
            {
                "id":          a.id,
                "alertname":   a.alertname,
                "severity":    a.severity,
                "value":       a.metric_value,
                "created_at":  a.created_at.isoformat(),
            }
            for a in metric_alerts
        ],

        "log_analysis": {
            "latest_count":   len(log_analyses),
            "critical_count": sum(1 for a in log_analyses if a.severity == "critical"),
            "warning_count":  sum(1 for a in log_analyses if a.severity == "warning"),
            "incidents": [
                {
                    "id":              a.id,
                    "log_message":     (a.log_content or "")[:500],
                    "analysis_result": (a.analysis_result or "")[:300],
                    "severity":        a.severity,
                    "anomaly_type":    a.anomaly_type,
                    "recommendation":  a.recommendation,
                    "created_at":      a.created_at.isoformat(),
                }
                for a in log_analyses
            ],
        },

        # 예방적 패턴 — llm_prediction + llm_trend 기반
        "proactive_alerts": [
            {
                "id":             p.id,
                "collector_type": p.collector_type,
                "metric_group":   p.metric_group,
                "hour_bucket":    p.hour_bucket.isoformat(),
                "llm_severity":   p.llm_severity,
                "llm_trend":      p.llm_trend,
                "llm_prediction": p.llm_prediction,
            }
            for p in proactive_rows
        ],

        "contacts":     contacts,
        "last_updated": datetime.utcnow().isoformat(),
    }
