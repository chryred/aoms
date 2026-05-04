"""
대시보드 통합 API
- 전체 시스템 상태 종합 조회
- 시스템별 상세 정보 조회 (활성 알림, 로그분석, 권장조치, 예방 패턴)
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import (
    AgentInstance,
    AlertHistory,
    Contact,
    LogAnalysisHistory,
    MetricHourlyAggregation,
    System,
    SystemContact,
    User,
)

logger = logging.getLogger(__name__)
_PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "").rstrip("/")

_OCCURRENCE_RE = re.compile(r"^\[(\d+)x\]")


def _parse_occurrence_count(log_content: str | None) -> int | None:
    if not log_content:
        return None
    m = _OCCURRENCE_RE.match(log_content)
    return int(m.group(1)) if m else None

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
        self.live_metric_severity: Optional[str] = None  # Prometheus 라이브 판정
        self.live_metric_reasons: list[str] = []
        self.instances: list[dict] = []      # 인스턴스별 상태 (InstanceStatusOut 직렬화용 dict)


# ==================== 헬퍼 ====================

async def _query_live_metric_status(
    system_name: str,
    db: AsyncSession,
    system_id: int,
) -> tuple[Optional[str], list[str], list[dict]]:
    """Prometheus live-summary로 시스템 메트릭 상태 판정 (max_over_time[5m])

    Returns: (severity, reasons, instances)
      - severity: None | "warning" | "critical"
      - reasons: 사람이 읽을 수 있는 판정 사유 목록
      - instances: 인스턴스별 상태 dict 목록 (InstanceStatusOut 구조)
    """
    if not _PROMETHEUS_URL:
        return None, [], []

    from routes.aggregations import PCT_PROMQL, METRIC_THRESHOLDS

    # agent_instances에서 collector_type을 derive
    result = await db.execute(
        select(AgentInstance.agent_type)
        .where(AgentInstance.system_id == system_id)
        .where(AgentInstance.status.in_(["running", "installed"]))
    )
    agent_types = {row[0] for row in result.fetchall()}
    collector_types: set[str] = set()
    if "synapse_agent" in agent_types:
        collector_types.add("synapse_agent")
    if "db" in agent_types:
        collector_types.add("db_exporter")
    if not collector_types:
        collector_types = {"synapse_agent"}  # 기본값

    # instance_role → server_type 매핑 구축 (DB 조회 1회)
    inst_result = await db.execute(
        select(AgentInstance.label_info, AgentInstance.server_type)
        .where(AgentInstance.system_id == system_id)
        .where(AgentInstance.status.in_(["running", "installed"]))
    )
    role_to_server_type: dict[str, Optional[str]] = {}
    for label_info_raw, server_type in inst_result.fetchall():
        if not label_info_raw:
            continue
        try:
            label_info = json.loads(label_info_raw) if isinstance(label_info_raw, str) else label_info_raw
            role = label_info.get("instance_role")
            if role:
                role_to_server_type[role] = server_type
        except (json.JSONDecodeError, AttributeError):
            pass

    worst: Optional[str] = None
    reasons: list[str] = []
    # instance_role → {"status": ..., "worst_metric": ...}
    inst_status: dict[str, dict] = {}

    GROUP_LABELS = {
        "cpu": "CPU", "memory": "메모리",
        "db_connections": "DB 커넥션", "db_cache": "DB 캐시",
    }

    # per-instance PromQL 키 매핑 (RANGE_PROMQL_MAP의 *_by_inst 키 사용)
    INST_PROMQL_KEYS: dict[str, dict[str, str]] = {
        "synapse_agent": {
            "cpu":    "cpu_max_by_inst",
            "memory": "mem_max_by_inst",
        },
        "db_exporter": {
            "db_connections": "conn_max_by_inst",
            "db_cache":       "cache_min_by_inst",
        },
    }

    from routes.aggregations import RANGE_PROMQL_MAP

    async with httpx.AsyncClient(timeout=5.0) as client:
        for ct in collector_types:
            thresholds = METRIC_THRESHOLDS.get(ct, {})
            promql_map = PCT_PROMQL.get(ct, {})
            range_map = RANGE_PROMQL_MAP.get(ct, {})

            for group, thresh in thresholds.items():
                # ── 1) 시스템 전체 판정 (PCT_PROMQL) ─────────────────────
                query = promql_map.get(group)
                if not query:
                    continue
                try:
                    resp = await client.get(
                        f"{_PROMETHEUS_URL}/api/v1/query",
                        params={"query": query.format(sn=system_name)},
                    )
                    data = resp.json().get("data", {}).get("result", [])
                    if not data:
                        continue
                    value = float(data[0]["value"][1])
                except Exception:
                    continue

                direction = thresh.get("direction", 1)
                if direction == 1:  # high_bad
                    if value > thresh["critical"]:
                        severity = "critical"
                    elif value > thresh["warning"]:
                        severity = "warning"
                    else:
                        severity = None
                else:  # low_bad (lower is worse)
                    if value < thresh["warning"]:
                        severity = "critical"
                    elif value < thresh["critical"]:
                        severity = "warning"
                    else:
                        severity = None

                if severity:
                    label = GROUP_LABELS.get(group, group)
                    reasons.append(f"{label} {value:.0f}%")
                    if severity == "critical":
                        worst = "critical"
                    elif worst != "critical":
                        worst = "warning"

                # ── 2) 인스턴스별 판정 (RANGE_PROMQL_MAP *_by_inst) ──────
                inst_key = INST_PROMQL_KEYS.get(ct, {}).get(group)
                if not inst_key:
                    continue
                # 해당 group의 metric_group 디렉토리에서 쿼리 찾기
                group_map = range_map.get(group, {})
                inst_query_tpl = group_map.get(inst_key)
                if not inst_query_tpl:
                    continue
                try:
                    inst_resp = await client.get(
                        f"{_PROMETHEUS_URL}/api/v1/query",
                        params={"query": inst_query_tpl.format(sn=system_name)},
                    )
                    inst_data = inst_resp.json().get("data", {}).get("result", [])
                except Exception:
                    continue

                for series in inst_data:
                    role = series.get("metric", {}).get("instance_role")
                    if not role:
                        continue
                    try:
                        inst_val = float(series["value"][1])
                    except (KeyError, ValueError, TypeError):
                        continue

                    # 인스턴스 단위 심각도 판정
                    if direction == 1:
                        if inst_val > thresh["critical"]:
                            inst_sev = "critical"
                        elif inst_val > thresh["warning"]:
                            inst_sev = "warning"
                        else:
                            inst_sev = "normal"
                    else:
                        if inst_val < thresh["warning"]:
                            inst_sev = "critical"
                        elif inst_val < thresh["critical"]:
                            inst_sev = "warning"
                        else:
                            inst_sev = "normal"

                    prev = inst_status.get(role, {"status": "normal", "worst_metric": None})
                    # worst-wins: critical > warning > normal
                    if inst_sev == "critical" or (inst_sev == "warning" and prev["status"] != "critical"):
                        inst_status[role] = {"status": inst_sev, "worst_metric": group}
                    elif role not in inst_status:
                        inst_status[role] = {"status": "normal", "worst_metric": None}

    # inactive 인스턴스 추가 (Prometheus 데이터가 없는 agent_instances)
    for role in role_to_server_type:
        if role not in inst_status:
            inst_status[role] = {"status": "inactive", "worst_metric": None}

    # instances 직렬화 (InstanceStatusOut 구조)
    instances = [
        {
            "instance_role": role,
            "server_type":   role_to_server_type.get(role),
            "status":        info["status"],
            "worst_metric":  info["worst_metric"],
        }
        for role, info in sorted(inst_status.items())
    ]

    return worst, reasons, instances

async def _get_system_health(
    db: AsyncSession, system_id: int, system_name: str = "",
) -> _SystemHealth:
    """시스템 상태 종합 판정

    판정 기준 (worst-wins):
      1. Prometheus 라이브 메트릭 (avg_over_time[5m]) — 임계치 기반
      2. 최근 10분 메트릭 알림 critical/warning
      3. 최근 10분 로그분석 LLM 결과 critical/warning
      4. 예방 패턴 (MetricHourlyAggregation.llm_prediction)
    """
    health = _SystemHealth()
    ten_minutes_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
    eight_hours_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=8)

    # 1. 메트릭 알림 (최근 10분, 미복구분만)
    # resolved_at IS NOT NULL 인 row 는 Alertmanager resolved 가 도착해 원본이 복구된 상태
    # (alerts.py 가 별도 row 를 만들지 않고 원본 row 의 resolved_at 을 업데이트) — 상태 격상 대상 아님
    result = await db.execute(
        select(AlertHistory).where(
            and_(
                AlertHistory.system_id == system_id,
                AlertHistory.alert_type == "metric",
                AlertHistory.created_at >= ten_minutes_ago,
                AlertHistory.resolved_at.is_(None),
            )
        )
    )
    recent_alerts = result.scalars().all()

    critical_count = sum(1 for a in recent_alerts if a.severity == "critical")
    warning_count  = sum(1 for a in recent_alerts if a.severity == "warning")
    health.metric_alerts_count = critical_count + warning_count

    # 2. 로그분석 (최근 10분)
    result = await db.execute(
        select(LogAnalysisHistory).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.created_at >= ten_minutes_ago,
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

    # 4. Prometheus 라이브 메트릭 판정 (max_over_time[5m])
    if system_name:
        try:
            live_sev, live_reasons, live_instances = await _query_live_metric_status(
                system_name, db, system_id,
            )
            health.live_metric_severity = live_sev
            health.live_metric_reasons = live_reasons
            health.instances = live_instances
        except Exception as exc:
            logger.warning("라이브 메트릭 조회 실패 (system_id=%s): %s", system_id, exc)

    # 최종 상태 판정 (worst-wins: 라이브 메트릭 + 알림 + 로그분석)
    reasons: list[str] = []

    is_critical = (
        critical_count > 0
        or health.log_analysis_severity == "critical"
        or health.live_metric_severity == "critical"
    )
    is_warning = (
        warning_count > 0
        or health.log_analysis_severity == "warning"
        or health.live_metric_severity == "warning"
    )

    if is_critical:
        health.status = "critical"
        if health.live_metric_severity == "critical":
            reasons.extend(health.live_metric_reasons)
        if critical_count > 0:
            reasons.append(f"수집 알림 {critical_count}개")
        if health.log_analysis_severity == "critical":
            reasons.append("로그 이상 감지")

    elif is_warning:
        health.status = "warning"
        if health.live_metric_severity == "warning":
            reasons.extend(health.live_metric_reasons)
        if warning_count > 0:
            reasons.append(f"수집 알림 {warning_count}개")
        if health.log_analysis_severity == "warning":
            reasons.append("로그 이상 경고")

    elif health.proactive_count > 0:
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
        "total_log_critical": 0,
        "total_log_warning":  0,
        "last_updated":       datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }

    # 로그분석 통계 (전체 시스템, 최근 10분)
    _ten_min_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
    _log_stat_result = await db.execute(
        select(LogAnalysisHistory).where(
            LogAnalysisHistory.created_at >= _ten_min_ago
        )
    )
    _log_stat_rows = _log_stat_result.scalars().all()
    summary["total_log_critical"] = sum(1 for r in _log_stat_rows if r.severity == "critical")
    summary["total_log_warning"]  = sum(1 for r in _log_stat_rows if r.severity == "warning")

    # OTel gating: installed/running otel_javaagent 보유 system_id 집합 (한 번에 조회)
    otel_result = await db.execute(
        text(
            "SELECT DISTINCT system_id FROM agent_instances"
            " WHERE agent_type='otel_javaagent' AND status IN ('running', 'installed')"
        )
    )
    otel_system_ids = {row[0] for row in otel_result.fetchall()}

    for sys in systems:
        health = await _get_system_health(db, sys.id, sys.system_name)

        system_list.append({
            "system_id":      sys.id,
            "display_name":   sys.display_name,
            "system_name":    sys.system_name,
            "status":         health.status,
            "reason":         health.reason,
            "proactive_count": health.proactive_count,
            "has_otel":       sys.id in otel_system_ids,
            "instances":      health.instances,
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
      metric_alerts    : 최근 10분 활성 메트릭 알림
      log_analysis     : 최근 10분 로그분석 결과 (5건)
      proactive_alerts : 최근 8h 예방적 패턴 (llm_prediction 있는 항목)
      contacts         : 담당자 목록
    """
    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    ten_minutes_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
    thirty_min_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30)
    eight_hours_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=8)

    # 1. 활성 알림 (최근 10분, 미복구분만) — 메트릭 알림
    result = await db.execute(
        select(AlertHistory).where(
            and_(
                AlertHistory.system_id == system_id,
                AlertHistory.alert_type == "metric",
                AlertHistory.created_at >= ten_minutes_ago,
                AlertHistory.resolved_at.is_(None),
            )
        ).order_by(desc(AlertHistory.created_at))
    )
    metric_alerts = result.scalars().all()

    # 1-b. 로그 분석 알림 (최근 10분, critical/warning 건만, 예외 처리된 항목 제외)
    result = await db.execute(
        select(LogAnalysisHistory).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.severity.in_(["critical", "warning"]),
                LogAnalysisHistory.alert_sent == True,
                LogAnalysisHistory.created_at >= ten_minutes_ago,
                LogAnalysisHistory.excluded == False,
            )
        ).order_by(desc(LogAnalysisHistory.created_at))
    )
    log_alerts = result.scalars().all()

    # 2. 최근 로그분석 결과 (최근 10분, 5건, 예외 처리된 항목 제외)
    result = await db.execute(
        select(LogAnalysisHistory).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.created_at >= ten_minutes_ago,
                LogAnalysisHistory.excluded == False,
            )
        ).order_by(desc(LogAnalysisHistory.created_at)).limit(5)
    )
    log_analyses = result.scalars().all()

    # 2-b. 최근 30분 로그분석 건수
    result_30m = await db.execute(
        select(func.count(LogAnalysisHistory.id)).where(
            and_(
                LogAnalysisHistory.system_id == system_id,
                LogAnalysisHistory.created_at >= thirty_min_ago,
                LogAnalysisHistory.excluded == False,
            )
        )
    )
    thirty_min_count = result_30m.scalar() or 0

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
        result = await db.execute(
            select(Contact, User.name.label("user_name"), User.email.label("user_email"))
            .join(User, Contact.user_id == User.id)
            .where(Contact.id == sc.contact_id)
        )
        row = result.one_or_none()
        if row:
            contact, user_name, user_email = row
            contacts.append({
                "id":         contact.id,
                "name":       user_name,
                "teams_upn":  contact.teams_upn,
                "email":      user_email,
                "role":       sc.role,
            })

    # 5. 인스턴스별 상태 (Prometheus 라이브 판정)
    instances: list[dict] = []
    if system.system_name:
        try:
            _, _, instances = await _query_live_metric_status(
                system.system_name, db, system_id,
            )
        except Exception as exc:
            logger.warning("상세 페이지 인스턴스 상태 조회 실패 (system_id=%s): %s", system_id, exc)

    return {
        "system_id":    system.id,
        "display_name": system.display_name,
        "system_name":  system.system_name,

        "metric_alerts": sorted(
            [
                {
                    "id":            a.id,
                    "alert_type":    "metric",
                    "alertname":     a.alertname,
                    "title":         a.title,
                    "severity":      a.severity,
                    "value":         a.metric_value,
                    "created_at":    a.created_at.isoformat() + "Z",
                    "instance_role": a.instance_role,
                }
                for a in metric_alerts
            ] + [
                {
                    "id":               a.id,
                    "alert_type":       "log_analysis",
                    "alertname":        (a.log_content or "")[:80],
                    "title":            (a.log_content or "")[:80],
                    "severity":         a.severity,
                    "value":            None,
                    "created_at":       a.created_at.isoformat() + "Z",
                    "instance_role":    a.instance_role,
                    "occurrence_count": _parse_occurrence_count(a.log_content),
                }
                for a in log_alerts
            ],
            key=lambda x: x["created_at"],
            reverse=True,
        ),

        "log_analysis": {
            "latest_count":    len(log_analyses),
            "critical_count":  sum(1 for a in log_analyses if a.severity == "critical"),
            "warning_count":   sum(1 for a in log_analyses if a.severity == "warning"),
            "thirty_min_count": thirty_min_count,
            "incidents": [
                {
                    "id":              a.id,
                    "log_message":     (a.log_content or "")[:500],
                    "analysis_result": (a.analysis_result or "")[:300],
                    "severity":        a.severity,
                    "anomaly_type":    a.anomaly_type,
                    "recommendation":  a.recommendation,
                    "created_at":      a.created_at.isoformat() + "Z",
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
                "hour_bucket":    p.hour_bucket.isoformat() + "Z",
                "llm_severity":   p.llm_severity,
                "llm_trend":      p.llm_trend,
                "llm_prediction": p.llm_prediction,
            }
            for p in proactive_rows
        ],

        "contacts":     contacts,
        "instances":    instances,
        "last_updated": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }
