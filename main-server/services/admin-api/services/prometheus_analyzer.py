"""
Prometheus 기반 자동 이상 감지 + LLM 분석 + Teams 알림

[분석 단위: host (물리 서버)]
같은 host에 여러 에이전트가 설치된 경우 (계정별 WAS 에이전트):
  - 인프라 메트릭(CPU/메모리/네트워크/디스크): host 내 어느 agent에서 수집하든 통합
  - WAS별 로그/HTTP: system_name 별로 구분 수집
  → LLM이 "이 서버 CPU 급등 + jeussic 로그 에러 동시 발생" 교차 분석 가능

PROMETHEUS_URL 환경변수 설정 시에만 활성화.
PROMETHEUS_ANALYZE_INTERVAL_SECONDS (기본 300)초마다 실행.
"""

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import func, select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import AlertHistory, Contact, IncidentTimeline, LlmAgentConfig, LogAnalysisHistory, MetricExclusion, System, SystemContact, User
from services.adaptive_card_builder import _build_base_card, build_entities, build_mention_text
from services.incident_service import get_or_create_incident
from services.llm_client import call_llm_text, LLM_TYPE
from services.metric_types import MetricType
from services.prompts import (
    _CPU_THRESHOLD,
    _MEM_THRESHOLD,
    _LOG_ERROR_RATE_THRESHOLD,
    _DISK_IO_MS_THRESHOLD,
    _NET_MAX_MBPS,
    _NET_THRESHOLD_PCT,
    _ZOMBIE_COUNT_THRESHOLD,
    build_prometheus_llm_prompt,
)

logger = logging.getLogger(__name__)

_PROMETHEUS_URL    = os.getenv("PROMETHEUS_URL", "").rstrip("/")
_ANALYZE_INTERVAL  = int(os.getenv("PROMETHEUS_ANALYZE_INTERVAL_SECONDS", "300"))
_TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
_LOG_ANALYZER_URL  = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

# ── 임계치 (warning) — prompts.py에서 import ─────────────────────────────────
# _CPU_THRESHOLD, _MEM_THRESHOLD, _LOG_ERROR_RATE_THRESHOLD,
# _DISK_IO_MS_THRESHOLD, _NET_MAX_MBPS, _NET_THRESHOLD_PCT → services/prompts.py

# HTTP 응답 지연 (분석 전용 — 프롬프트에 사용 안 함)
_HTTP_SLOW_THRESHOLD_MS = float(os.getenv("PROM_ALERT_HTTP_SLOW_MS", "3000.0"))

# ── 네트워크 대역폭 ───────────────────────────────────────────────────────────
# Full-duplex NIC: TX / RX 각각 독립 판정. 합산 사용 금지.
_NET_CRITICAL_PCT    = float(os.getenv("PROM_ALERT_NET_CRITICAL_PCT",      "90.0"))   # critical %

# ── 임계치 (critical) ─────────────────────────────────────────────────────────
_CPU_CRITICAL = float(os.getenv("PROM_ALERT_CPU_CRITICAL", "90.0"))
_MEM_CRITICAL = float(os.getenv("PROM_ALERT_MEM_CRITICAL", "90.0"))
# 좀비 critical — alert_rules.yml 의 ZombieProcessCritical(>= 20) 과 같은 값 유지
_ZOMBIE_COUNT_CRITICAL = float(os.getenv("PROM_ALERT_ZOMBIE_CRITICAL", "20.0"))

# ── 쿨다운 (인메모리, 재시작 시 초기화) ──────────────────────────────────────
_COOLDOWN_SECONDS = int(os.getenv("PROM_ALERT_COOLDOWN_SECONDS", "1800"))  # 30분
_host_cooldown: dict[str, datetime] = {}
_KST = timezone(timedelta(hours=9))


def _is_in_cooldown(host: str) -> bool:
    last = _host_cooldown.get(host)
    if not last:
        return False
    return (datetime.now(timezone.utc).replace(tzinfo=None) - last).total_seconds() < _COOLDOWN_SECONDS


def _record_sent(host: str) -> None:
    _host_cooldown[host] = datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_prom_llm_json(text: str) -> dict | None:
    """LLM 응답에서 JSON 블록 추출 — aggregation_processor._parse_llm_json()과 동일 패턴"""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


# ── 데이터 구조 ───────────────────────────────────────────────────────────────

@dataclass
class SystemMetrics:
    """host 내 개별 system_name 의 수집 메트릭"""
    system_name: str
    display_name: str = ""
    # 인프라 수집기가 이 system에 붙어 있는 경우에만 값 있음
    cpu_avg: Optional[float] = None
    mem_used_pct: Optional[float] = None
    net_rx_mbps: Optional[float] = None
    net_tx_mbps: Optional[float] = None
    disk_io_ms: Optional[float] = None
    # WAS 로그/HTTP (log=true 인 에이전트)
    log_error_rate: float = 0.0
    log_by_level: dict = field(default_factory=dict)      # level → 건/분
    http_slow: list = field(default_factory=list)          # [{"url": .., "ms": ..}]
    http_req_rate: Optional[float] = None                  # req/분
    # 감지된 이상 설명 (LLM 프롬프트용)
    anomalies: list = field(default_factory=list)
    # 이 이상에 묶인 메트릭 종류 (AlertHistory.metric_types 컬럼 저장용, MetricType enum value)
    matched_metric_types: list = field(default_factory=list)
    # 프로세스 CPU 상위 목록 — [{"name": str, "pid": str, "cpu_pct": float}]
    top_processes: list = field(default_factory=list)
    # 좀비 프로세스 수 (state=Z)
    zombie_count: int = 0
    # 좀비 부모 귀속 — [{"name": str, "pid": str, "count": int}] (상위 3개)
    zombie_parents: list = field(default_factory=list)


@dataclass
class HostContext:
    """물리 서버(host IP) 단위 통합 컨텍스트"""
    host: str
    systems: dict = field(default_factory=dict)   # system_name → SystemMetrics

    def get_or_create(self, system_name: str) -> SystemMetrics:
        if system_name not in self.systems:
            self.systems[system_name] = SystemMetrics(system_name=system_name)
        return self.systems[system_name]

    @property
    def has_anomaly(self) -> bool:
        return any(sm.anomalies for sm in self.systems.values())

    @property
    def infra_cpu(self) -> Optional[tuple[str, float]]:
        for sm in self.systems.values():
            if sm.cpu_avg is not None:
                return (sm.system_name, sm.cpu_avg)
        return None

    @property
    def infra_mem(self) -> Optional[tuple[str, float]]:
        for sm in self.systems.values():
            if sm.mem_used_pct is not None:
                return (sm.system_name, sm.mem_used_pct)
        return None

    @property
    def infra_net(self) -> Optional[tuple[str, float, float]]:
        """(system_name, rx_mbps, tx_mbps) — 없으면 None"""
        for sm in self.systems.values():
            if sm.net_rx_mbps is not None or sm.net_tx_mbps is not None:
                return (sm.system_name, sm.net_rx_mbps or 0.0, sm.net_tx_mbps or 0.0)
        return None

    @property
    def infra_disk(self) -> Optional[tuple[str, float]]:
        for sm in self.systems.values():
            if sm.disk_io_ms is not None:
                return (sm.system_name, sm.disk_io_ms)
        return None


# ── Prometheus 쿼리 ───────────────────────────────────────────────────────────

async def _query_prometheus(promql: str) -> list[dict]:
    """Prometheus instant query → result list"""
    if not _PROMETHEUS_URL:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{_PROMETHEUS_URL}/api/v1/query",
                params={"query": promql},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "success":
                return data["data"]["result"]
    except Exception as e:
        logger.warning("Prometheus query failed: %s — %s", promql, e)
    return []


# ── DB 조회 ───────────────────────────────────────────────────────────────────

async def _fetch_real_error_counts() -> dict[int, float]:
    """최근 10분 log_analysis_history에서 system별 real_error_count 합계 → 건/분 단위 반환.

    Prometheus log_error_total(알림성 포함) 대신 DB에서 알림성 제외 실에러만 집계.
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=10)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                sa_select(
                    LogAnalysisHistory.system_id,
                    func.sum(LogAnalysisHistory.real_error_count).label("total"),
                )
                .where(LogAnalysisHistory.created_at >= cutoff)
                .where(LogAnalysisHistory.real_error_count > 0)
                .group_by(LogAnalysisHistory.system_id)
            )
            return {row.system_id: float(row.total) / 10.0 for row in result}
    except Exception as e:
        logger.warning("real_error_counts DB 조회 실패 (빈 dict 반환): %s", e)
        return {}

# ── 메트릭 예외 매칭 ─────────────────────────────────────────────────────────
# 로그 예외처리(log-analyzer/analyzer.py)와 대칭: cycle 시작 시 활성 규칙을 한 번 로드하고,
# 각 메트릭 push 사이트에서 검사하여 anomaly append 자체를 차단한다.

MetricExclusionRuleMap = dict[tuple[int, Optional[str], str], MetricExclusion]


async def _load_active_metric_exclusions(db: AsyncSession) -> MetricExclusionRuleMap:
    """active=True + (expires_at IS NULL OR expires_at > now()) 인 규칙을 룩업 dict 으로 반환.

    Key: (system_id, host_or_None, metric_type). host=None 은 시스템 전체 와일드카드.
    동일 키 중복 시 created_at 최신 규칙으로 덮음.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        sa_select(MetricExclusion)
        .where(MetricExclusion.active == True)  # noqa: E712
        .where((MetricExclusion.expires_at.is_(None)) | (MetricExclusion.expires_at > now))
        .order_by(MetricExclusion.created_at.asc())
    )
    rules: MetricExclusionRuleMap = {}
    for r in result.scalars().all():
        rules[(r.system_id, r.host, r.metric_type)] = r
    return rules


async def _load_system_name_map(db: AsyncSession) -> dict[str, int]:
    """system_name → system_id 매핑 (push 사이트가 system_name 공간이므로 cycle 1회 로드)."""
    result = await db.execute(sa_select(System.id, System.system_name))
    return {row.system_name: row.id for row in result.all()}


def _check_metric_exclusion(
    rules: MetricExclusionRuleMap,
    system_id: int,
    host: str,
    metric_type: str,
    value: float,
    default_threshold: float,
) -> tuple[bool, float, Optional[MetricExclusion]]:
    """메트릭 예외 매칭 검사.

    룩업 우선순위: (system_id, host, metric_type) 정확매치 → (system_id, None, metric_type) 와일드카드.

    반환: (excluded, effective_threshold, matched_rule)
      - 매칭 없음: (False, default_threshold, None) — 정상 분석 진행
      - 매칭 + override_threshold IS NULL: (True, default_threshold, rule) — 완전 차단
      - 매칭 + override_threshold = X: value <= X 이면 (True, X, rule), value > X 이면 (False, X, rule)
        (override 적용 후에도 임계치 초과 시 정상 알림. title 에는 override 값으로 표기됨)
    """
    rule = rules.get((system_id, host, metric_type)) or rules.get((system_id, None, metric_type))
    if rule is None:
        return False, default_threshold, None

    if rule.override_threshold is None:
        # 완전 차단
        return True, default_threshold, rule

    # 임계치 오버라이드
    override = float(rule.override_threshold)
    if value <= override:
        return True, override, rule
    return False, override, rule


async def _get_system_info(db: AsyncSession, system_name: str) -> Optional[dict]:
    """system_name → System + contacts"""
    result = await db.execute(sa_select(System).where(System.system_name == system_name))
    system = result.scalar_one_or_none()
    if not system:
        return None
    contacts_result = await db.execute(
        sa_select(Contact, User.name)
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .join(User, User.id == Contact.user_id)
        .where(SystemContact.system_id == system.id)
    )
    contacts = contacts_result.all()
    return {
        "id": system.id,
        "system_name": system.system_name,
        "display_name": system.display_name,
        "teams_webhook_url": system.teams_webhook_url,
        "contacts": [
            {"name": user_name, "teams_upn": c.teams_upn}
            for c, user_name in contacts
        ],
    }


# ── 메트릭 수집 → HostContext 구성 ──────────────────────────────────────────

async def _build_host_contexts(
    exclusion_rules: Optional[MetricExclusionRuleMap] = None,
    system_name_to_id: Optional[dict[str, int]] = None,
    matched_rule_ids: Optional[set[int]] = None,
) -> dict[str, HostContext]:
    """Prometheus에서 전체 메트릭을 host 기준으로 집계하여 HostContext 맵 반환.

    exclusion_rules / system_name_to_id 가 제공되면 push 사이트에서 메트릭 예외 검사 수행:
      - 완전 차단 매칭 시: raw 메트릭 필드(sm.cpu_avg 등) 미할당 + anomaly skip
        → _calc_severity / AlertHistory INSERT 모두 영향 없음
      - 임계치 오버라이드 매칭 시: override 값 기준으로 재비교
    매칭된 규칙 id 는 matched_rule_ids 에 누적 (cycle 끝 일괄 skip_count 갱신용).
    """
    rules = exclusion_rules or {}
    name_map = system_name_to_id or {}
    matched_ids = matched_rule_ids if matched_rule_ids is not None else set()

    def _excluded(host: str, system_name: str, metric_type: str, value: float, default_thr: float) -> tuple[bool, float]:
        """매칭 후 (excluded, effective_threshold) 반환. system_id 미해결 시 정상 진행."""
        if not rules:
            return False, default_thr
        sid = name_map.get(system_name)
        if sid is None:
            return False, default_thr
        excluded, eff_thr, rule = _check_metric_exclusion(
            rules, sid, host, metric_type, value, default_thr
        )
        if rule is not None:
            matched_ids.add(rule.id)
        return excluded, eff_thr

    hosts: dict[str, HostContext] = {}

    def _get_host(host: str) -> HostContext:
        if host not in hosts:
            hosts[host] = HostContext(host=host)
        return hosts[host]

    # 1. CPU (total 코어만 — host + system_name 기준)
    cpu_results = await _query_prometheus(
        'avg by (host, system_name, display_name) (cpu_usage_percent{core="total"})'
    )
    for r in cpu_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = dn
        excluded, eff_thr = _excluded(host, sn, MetricType.CPU.value, val, _CPU_THRESHOLD)
        if excluded:
            # 완전 차단 또는 override 미만 → raw 필드도 비할당 (severity 계산 부작용 방지)
            continue
        sm.cpu_avg = val
        if val > eff_thr:
            sm.anomalies.append(f"CPU 평균 {val:.1f}% (임계치 {eff_thr:g}%)")
            sm.matched_metric_types.append(MetricType.CPU.value)

    # 2. 메모리 사용률
    mem_results = await _query_prometheus(
        "(avg by (host, system_name, display_name) (memory_used_bytes{type=\"used\"})"
        " / avg by (host, system_name, display_name) (memory_used_bytes{type=\"total\"})) * 100"
    )
    for r in mem_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        excluded, eff_thr = _excluded(host, sn, MetricType.MEMORY.value, val, _MEM_THRESHOLD)
        if excluded:
            continue
        sm.mem_used_pct = val
        if val > eff_thr:
            sm.anomalies.append(f"메모리 사용률 {val:.1f}% (임계치 {eff_thr:g}%)")
            sm.matched_metric_types.append(MetricType.MEMORY.value)

    # 3. 실에러 로그 rate — log_analysis_history DB 기반 (알림성 제외, 건/분)
    # Prometheus log_error_total은 알림성 포함 원시값 → 정확한 실에러만 반영하기 위해 DB 전환
    real_error_by_system_id = await _fetch_real_error_counts()
    # system_id → system_name 역방향 매핑
    name_map_local = system_name_to_id or {}
    system_id_to_name = {v: k for k, v in name_map_local.items()}
    for sys_id, rate_per_min in real_error_by_system_id.items():
        sn = system_id_to_name.get(sys_id)
        if not sn:
            continue
        # hosts 딕셔너리에서 해당 system_name을 포함하는 host 찾기
        for hc in hosts.values():
            if sn in hc.systems:
                sm = hc.systems[sn]
                sm.log_error_rate += rate_per_min
                sm.log_by_level["실에러"] = rate_per_min
                break

    # 4. HTTP 응답 지연
    http_results = await _query_prometheus(
        f"avg by (host, system_name, display_name, url_pattern)"
        f" (http_request_duration_ms) > {_HTTP_SLOW_THRESHOLD_MS}"
    )
    for r in http_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        url  = r["metric"].get("url_pattern", "?")
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        # HTTP 지연 쿼리는 Prometheus 측에서 _HTTP_SLOW_THRESHOLD_MS 가 이미 적용된 결과만 반환됨.
        # 따라서 V1 메트릭 예외는 "완전 차단"만 지원. override_threshold 는 무시 (효과 없음).
        excluded, _eff = _excluded(host, sn, MetricType.HTTP_LATENCY.value, val, _HTTP_SLOW_THRESHOLD_MS)
        if excluded:
            continue
        sm.http_slow.append({"url": url, "ms": val})
        sm.anomalies.append(f"HTTP 지연 {url} {val:.0f}ms (임계치 {_HTTP_SLOW_THRESHOLD_MS}ms)")
        sm.matched_metric_types.append(MetricType.HTTP_LATENCY.value)

    # 5. 네트워크 RX (MB/s) — Full-duplex TX/RX 각각 독립 판정
    _net_threshold_mbps = _NET_MAX_MBPS / 8 * _NET_THRESHOLD_PCT / 100
    net_rx_results = await _query_prometheus(
        'avg by (host, system_name, display_name)'
        ' (rate(network_bytes_total{direction="rx"}[5m])) / 1048576'
    )
    for r in net_rx_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        excluded, eff_thr = _excluded(host, sn, MetricType.NETWORK_RX.value, val, _net_threshold_mbps)
        if excluded:
            continue
        sm.net_rx_mbps = val
        if val > eff_thr:
            sm.anomalies.append(
                f"네트워크 RX {val:.1f} MB/s"
                f" (대역폭 {val / (_NET_MAX_MBPS / 8) * 100:.0f}%,"
                f" 임계 {eff_thr:.1f} MB/s)"
            )
            sm.matched_metric_types.append(MetricType.NETWORK_RX.value)

    # 6. 네트워크 TX (MB/s)
    net_tx_results = await _query_prometheus(
        'avg by (host, system_name, display_name)'
        ' (rate(network_bytes_total{direction="tx"}[5m])) / 1048576'
    )
    for r in net_tx_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        excluded, eff_thr = _excluded(host, sn, MetricType.NETWORK_TX.value, val, _net_threshold_mbps)
        if excluded:
            continue
        sm.net_tx_mbps = val
        if val > eff_thr:
            sm.anomalies.append(
                f"네트워크 TX {val:.1f} MB/s"
                f" (대역폭 {val / (_NET_MAX_MBPS / 8) * 100:.0f}%,"
                f" 임계 {eff_thr:.1f} MB/s)"
            )
            sm.matched_metric_types.append(MetricType.NETWORK_TX.value)

    # 7. 디스크 I/O 응답시간 (ms)
    disk_io_results = await _query_prometheus(
        'avg by (host, system_name, display_name) (disk_io_time_ms)'
    )
    for r in disk_io_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        excluded, eff_thr = _excluded(host, sn, MetricType.DISK_IO.value, val, _DISK_IO_MS_THRESHOLD)
        if excluded:
            continue
        sm.disk_io_ms = val
        if val > eff_thr:
            sm.anomalies.append(f"디스크 I/O {val:.0f}ms (임계치 {eff_thr:g}ms)")
            sm.matched_metric_types.append(MetricType.DISK_IO.value)

    # 8. HTTP 요청 수 (req/분) — 이상 감지는 run_analysis_cycle()에서 이전 주기 비교
    http_req_results = await _query_prometheus(
        'sum by (host, system_name, display_name)'
        ' (rate(http_requests_total[5m])) * 60'
    )
    for r in http_req_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        sm.http_req_rate = val

    # 9. 프로세스 CPU 상위 목록 (서비스 매핑 포함, 상위 5개 / system 기준)
    proc_cpu_results = await _query_prometheus(
        'max by (host, system_name, process, pid, service_display)'
        ' (process_cpu_percent)'
    )
    proc_by_host_sys: dict[tuple, list] = {}
    for r in proc_cpu_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        val  = float(r["value"][1])
        if not host or val < 1.0:
            continue
        key = (host, sn)
        if key not in proc_by_host_sys:
            proc_by_host_sys[key] = []
        proc_by_host_sys[key].append({
            "name":    r["metric"].get("service_display") or r["metric"].get("process", "?"),
            "pid":     r["metric"].get("pid", ""),
            "cpu_pct": val,
        })
    for (host, sn), procs in proc_by_host_sys.items():
        if host not in hosts or sn not in hosts[host].systems:
            continue
        hosts[host].systems[sn].top_processes = sorted(
            procs, key=lambda x: x["cpu_pct"], reverse=True
        )[:5]

    # 10. 좀비 프로세스 수 (state=Z)
    #  (1) process_zombie_count 는 호스트 전역 값 — 동일 host 에 에이전트가 복수면 같은 값을
    #      중복 보고한다. sum 금지, max 집계 필수 (process_cpu_percent 와 동일 패턴).
    #  (2) 임계치가 0이라 개수로 오탐을 막을 수 없다. alert_rules 의 for:5m 과 같은
    #      지속 조건을 PromQL 로 직접 건다 — 좌변은 현재값, 우변은 최근 5분 내내
    #      좀비가 있었는지 여부. 에이전트가 좀비 0 도 매 주기 emit 하므로 게이트가 성립한다.
    zombie_results = await _query_prometheus(
        '(max by (host, system_name, display_name) (process_zombie_count))'
        ' and '
        '(min_over_time('
        '(max by (host, system_name, display_name) (process_zombie_count))[5m:1m]'
        ') > 0)'
    )
    for r in zombie_results:
        host = r["metric"].get("host", "")
        sn   = r["metric"].get("system_name", "unknown")
        dn   = r["metric"].get("display_name", sn)
        val  = int(float(r["value"][1]))
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        excluded, eff_thr = _excluded(host, sn, MetricType.ZOMBIE.value, val, _ZOMBIE_COUNT_THRESHOLD)
        if excluded:
            continue
        sm.zombie_count = val
        if val > eff_thr:
            # eff_thr 기본 0 → 5분 이상 지속된 좀비는 1개부터 이상으로 승격.
            # 시스템별 override_threshold 가 설정된 경우에만 그 값이 쓰인다.
            sm.anomalies.append(f"좀비 프로세스 {val}개 (5분 이상 미회수)")
            sm.matched_metric_types.append(MetricType.ZOMBIE.value)

    # 11. 좀비 부모 귀속 (좀비가 있을 때만 시계열 존재 — 구버전 에이전트는 빈 결과)
    zparent_results = await _query_prometheus(
        'max by (host, system_name, parent_process, parent_pid, service_display)'
        ' (process_zombie_by_parent)'
    )
    zparents_by_key: dict[tuple, list] = {}
    for r in zparent_results:
        m    = r["metric"]
        host = m.get("host", "")
        sn   = m.get("system_name", "unknown")
        if not host:
            continue
        zparents_by_key.setdefault((host, sn), []).append({
            "name":  m.get("service_display") or m.get("parent_process", "?"),
            "pid":   m.get("parent_pid", ""),
            "count": int(float(r["value"][1])),
        })
    for (host, sn), plist in zparents_by_key.items():
        if host not in hosts or sn not in hosts[host].systems:
            continue
        hosts[host].systems[sn].zombie_parents = sorted(
            plist, key=lambda x: x["count"], reverse=True
        )[:3]

    return hosts


# ── 심각도 판정 ───────────────────────────────────────────────────────────────

def _calc_severity(hc: HostContext) -> str:
    """이상 수치 기준으로 critical / warning 판정"""
    _net_critical_mbps = _NET_MAX_MBPS / 8 * _NET_CRITICAL_PCT / 100
    for sm in hc.systems.values():
        if sm.cpu_avg is not None and sm.cpu_avg > _CPU_CRITICAL:
            return "critical"
        if sm.mem_used_pct is not None and sm.mem_used_pct > _MEM_CRITICAL:
            return "critical"
        if sm.zombie_count >= _ZOMBIE_COUNT_CRITICAL:
            return "critical"
        if sm.net_rx_mbps is not None and sm.net_rx_mbps > _net_critical_mbps:
            return "critical"
        if sm.net_tx_mbps is not None and sm.net_tx_mbps > _net_critical_mbps:
            return "critical"
    return "warning"


# ── Teams 알림 전송 ───────────────────────────────────────────────────────────

async def _notify_host(hc: HostContext, analysis: str, severity: str, db: AsyncSession) -> None:
    """host 내 이상 시스템의 담당자에게 통합 알림 발송"""
    anomalous_systems = [sn for sn, sm in hc.systems.items() if sm.anomalies]

    all_contacts: list[dict] = []
    webhook_url = ""
    system_labels: list[str] = []

    for sn in anomalous_systems:
        info = await _get_system_info(db, sn)
        if not info:
            continue
        system_labels.append(
            f"{info['display_name'] or sn} ({sn})" if info.get("display_name") else sn
        )
        if not webhook_url:
            webhook_url = info["teams_webhook_url"] or ""
        seen_names = {c["name"] for c in all_contacts}
        for c in info["contacts"]:
            if c["name"] not in seen_names:
                all_contacts.append(c)
                seen_names.add(c["name"])

    webhook_url = webhook_url or _TEAMS_WEBHOOK_URL
    if not webhook_url:
        logger.info("Teams webhook URL 없음 — host %s 분석 결과만 로깅:\n%s", hc.host, analysis)
        return

    # LLM JSON 파싱
    parsed = _parse_prom_llm_json(analysis)
    if parsed:
        anomaly_item     = parsed.get("anomaly_item", "-")
        root_cause       = parsed.get("root_cause", "-")
        immediate_action = parsed.get("immediate_action", "-")
    else:
        anomaly_item     = "분석 참조"
        root_cause       = analysis[:200]
        immediate_action = "-"

    systems_value = ", ".join(system_labels) or "알 수 없음"
    title = f"[{hc.host}] {'🔴' if severity == 'critical' else '🟡'} 이상 감지 — {', '.join(s.split(' (')[0] for s in system_labels)}"

    facts = [
        {"title": "호스트",     "value": hc.host},
        {"title": "관련 시스템", "value": systems_value},
        {"title": "이상 항목",  "value": anomaly_item},
        {"title": "원인 분석",  "value": root_cause},
        {"title": "즉시 조치",  "value": immediate_action},
        {"title": "감지 시각",  "value": datetime.now(_KST).strftime("%Y-%m-%d %H:%M KST")},
    ]

    mention_text = build_mention_text(all_contacts)
    body_extra: list[dict] = []
    if mention_text:
        body_extra.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

    card = _build_base_card(
        alert_type_label="인프라 자동 분석 · 5분주기 (쿨다운 30분)",
        title=title,
        severity_color="Attention" if severity == "critical" else "Warning",
        facts=facts,
        body_extra=body_extra,
        actions=[],
        entities=build_entities(all_contacts),
        summary=title,
    )

    # 비동기 발송(fire-and-forget + 세마포어 상한) — 느린/죽은 웹훅이 메트릭 분석 루프를 막지 않게.
    from services.notification import spawn_teams_send

    async def _send_metric_card():
        async with httpx.AsyncClient(timeout=1.0) as client:   # 발송 1초 타임아웃 (죽은 웹훅 빠른 정리)
            resp = await client.post(webhook_url, json=card)
            if not (200 <= resp.status_code < 300):   # 200(구커넥터)·202(Workflows) 모두 성공
                logger.warning("Teams webhook responded %s for host %s", resp.status_code, hc.host)
            else:
                logger.info("Teams 알림 발송 완료 — host=%s systems=%s severity=%s", hc.host, anomalous_systems, severity)

    spawn_teams_send(_send_metric_card(), label=f"metric/{hc.host}")


# ── 분석 사이클 ───────────────────────────────────────────────────────────────

async def run_analysis_cycle() -> None:
    """host 기준 메트릭 이상 감지 + 교차 분석 + Teams 알림 1 사이클"""
    if not _PROMETHEUS_URL:
        return

    # 메트릭 예외 규칙은 cycle 시작 시 한 번만 로드 (로그 예외처리와 대칭)
    async with AsyncSessionLocal() as _rules_db:
        exclusion_rules = await _load_active_metric_exclusions(_rules_db)
        system_name_to_id = await _load_system_name_map(_rules_db)

    matched_rule_ids: set[int] = set()
    hosts = await _build_host_contexts(
        exclusion_rules=exclusion_rules,
        system_name_to_id=system_name_to_id,
        matched_rule_ids=matched_rule_ids,
    )
    anomalous_hosts = {h: hc for h, hc in hosts.items() if hc.has_anomaly}

    # 매칭된 예외 규칙은 anomaly 발생 여부와 무관하게 skip_count 누적 (감사용)
    if matched_rule_ids:
        async with AsyncSessionLocal() as _skip_db:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            for rid in matched_rule_ids:
                rule = await _skip_db.get(MetricExclusion, rid)
                if rule is None:
                    continue
                rule.skip_count = (rule.skip_count or 0) + 1
                rule.last_skipped_at = now
            await _skip_db.commit()

    if not anomalous_hosts:
        return

    async with AsyncSessionLocal() as db:
        # 업무영역별 agent_code 조회 (한 번만)
        _cfg_result = await db.execute(
            sa_select(LlmAgentConfig.agent_code)
            .where(LlmAgentConfig.area_code == "infra_analysis", LlmAgentConfig.is_active == True)
        )
        infra_agent_code = _cfg_result.scalar_one_or_none() or ""

        for host, hc in anomalous_hosts.items():
            # 쿨다운 체크 — 30분 이내 이미 발송한 host 스킵
            if _is_in_cooldown(host):
                logger.debug("prometheus_analyzer 쿨다운 중 — host=%s", host)
                continue

            severity = _calc_severity(hc)

            # LLM 분석
            system_infos: dict[str, dict] = {}
            for sn in hc.systems:
                info = await _get_system_info(db, sn)
                if info:
                    system_infos[sn] = info

            # 과거 해결책 조회 (best-effort — 역방향 업데이트로 incident_id 연결된 경우에만 유효)
            solution_ctx = ""
            for sn, sm in hc.systems.items():
                if not sm.anomalies or not sm.matched_metric_types:
                    continue
                try:
                    async with httpx.AsyncClient(timeout=5.0) as _hc:
                        sim_resp = await _hc.post(
                            f"{_LOG_ANALYZER_URL}/metric/similarity",
                            json={
                                "system_name":   sn,
                                "instance_role": "prometheus_analyzer",
                                "alertname":     "prometheus_analyzer_anomaly",
                                "labels": {
                                    "metric_name": ",".join(sm.matched_metric_types),
                                    "severity":    severity,
                                },
                                "annotations": {},
                            },
                        )
                    if sim_resp.status_code == 200:
                        sim_data = sim_resp.json()
                        incident_ids = [
                            r["payload"].get("incident_id")
                            for r in sim_data.get("top_results", [])
                            if r["payload"].get("incident_id") is not None
                        ]
                        if incident_ids:
                            async with httpx.AsyncClient(timeout=5.0) as _hc:
                                pm_resp = await _hc.get(
                                    f"{_LOG_ANALYZER_URL}/incident-postmortem/by-incident/{incident_ids[0]}",
                                )
                            if pm_resp.status_code == 200 and pm_resp.json():
                                sol = (pm_resp.json().get("solution") or "").strip()
                                if sol:
                                    solution_ctx = f"과거 유사 장애 해결책 (참고용):\n- {sol[:200]}"
                                    break
                except Exception as exc:
                    logger.debug("메트릭 해결책 조회 실패 (분석 계속): %s", exc)

            prompt = build_prometheus_llm_prompt(hc, system_infos, solution_ctx=solution_ctx)
            logger.info("Anomaly detected — host=%s severity=%s systems=%s", host, severity, list(hc.systems.keys()))

            analysis: Optional[str] = None
            llm_error: Optional[str] = None
            try:
                analysis = await call_llm_text(prompt, max_tokens=500, agent_code=infra_agent_code)
                if not analysis:
                    llm_error = "LLM empty response"
            except Exception as e:
                llm_error = f"{type(e).__name__}: {str(e)[:300]}"
                logger.warning("LLM call failed for host %s: %s", host, e)

            if not analysis:
                lines = [f"[{host}] 다음 이상이 감지되었습니다. 즉시 확인하세요."]
                for sn, sm in hc.systems.items():
                    if sm.anomalies:
                        dn = sm.display_name or sn
                        for a in sm.anomalies:
                            lines.append(f"- {dn} ({sn}): {a}")
                analysis = "\n".join(lines)

            await _notify_host(hc, analysis, severity, db)
            _record_sent(host)

            # 이상 시스템별 AlertHistory + LogAnalysisHistory 저장
            for sn, sm in hc.systems.items():
                if not sm.anomalies:
                    continue
                info = system_infos.get(sn)
                if not info:
                    continue

                anomaly_title = f"[메트릭분석] {', '.join(sm.anomalies[:2])}"
                parsed_analysis = _parse_prom_llm_json(analysis) if analysis else None
                stored_description = (
                    json.dumps({
                        "anomaly_item": parsed_analysis.get("anomaly_item", ""),
                        "root_cause": parsed_analysis.get("root_cause", ""),
                        "recommendation": parsed_analysis.get("immediate_action", ""),
                    }, ensure_ascii=False)
                    if parsed_analysis else analysis[:500]
                )
                stored_root_cause = (
                    parsed_analysis.get("root_cause", analysis[:500])
                    if parsed_analysis
                    else ("LLM 분석 실패 — 이상 목록만 나열" if llm_error else analysis[:500])
                )

                # 중복 제거 (CPU+CPU 같은 케이스 방지) — 등장 순서 유지
                metric_types_list: list[str] = []
                for mt in sm.matched_metric_types:
                    if mt not in metric_types_list:
                        metric_types_list.append(mt)

                # ① AlertHistory (인시던트 그루핑 포함)
                history = AlertHistory(
                    system_id=info["id"],
                    alert_type="metric",
                    severity=severity,
                    alertname="prometheus_analyzer_anomaly",
                    title=anomaly_title,
                    description=stored_description,
                    instance_role="prometheus_analyzer",
                    host=host,
                    anomaly_type="new",
                    metric_types=metric_types_list or None,
                )
                db.add(history)
                await db.flush()

                incident = await get_or_create_incident(
                    db, info["id"], title=anomaly_title, severity=severity
                )
                history.incident_id = incident.id
                db.add(IncidentTimeline(
                    incident_id=incident.id,
                    event_type="alert_added",
                    description=f"[{severity.upper()}] 메트릭분석: {', '.join(sm.anomalies)}",
                    actor_name="prometheus_analyzer",
                ))

                # ② LogAnalysisHistory (LLM 분석 내용)
                db.add(LogAnalysisHistory(
                    system_id=info["id"],
                    instance_role="prometheus_analyzer",
                    log_content=analysis[:10000],
                    analysis_result=analysis,
                    severity=severity,
                    root_cause=stored_root_cause,
                    recommendation=parsed_analysis.get("immediate_action", "") if parsed_analysis else "",
                    error_message=llm_error,
                    model_used=LLM_TYPE,
                    incident_id=incident.id,
                ))

            await db.commit()


async def run_prometheus_analyzer_loop() -> None:
    """백그라운드 루프 — lifespan에서 asyncio.create_task로 실행"""
    if not _PROMETHEUS_URL:
        logger.info("PROMETHEUS_URL 미설정 — prometheus_analyzer 비활성화")
        return

    logger.info(
        "prometheus_analyzer 시작 (interval=%ds, cpu_thr=%.0f%%, mem_thr=%.0f%%, net_max=%.0fMbps, cooldown=%ds)",
        _ANALYZE_INTERVAL, _CPU_THRESHOLD, _MEM_THRESHOLD, _NET_MAX_MBPS, _COOLDOWN_SECONDS,
    )
    while True:
        try:
            await run_analysis_cycle()
        except Exception as e:
            logger.error("prometheus_analyzer cycle error: %s", e, exc_info=True)
        await asyncio.sleep(_ANALYZE_INTERVAL)
