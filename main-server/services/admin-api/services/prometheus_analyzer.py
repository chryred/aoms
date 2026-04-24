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
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import AlertHistory, Contact, IncidentTimeline, LlmAgentConfig, LogAnalysisHistory, System, SystemContact
from services.incident_service import get_or_create_incident
from services.llm_client import call_llm_text, LLM_TYPE

logger = logging.getLogger(__name__)

_PROMETHEUS_URL   = os.getenv("PROMETHEUS_URL", "").rstrip("/")
_ANALYZE_INTERVAL = int(os.getenv("PROMETHEUS_ANALYZE_INTERVAL_SECONDS", "300"))
_TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

# ── 임계치 (warning) ──────────────────────────────────────────────────────────
_CPU_THRESHOLD          = float(os.getenv("PROM_ALERT_CPU_THRESHOLD",         "70.0"))
_MEM_THRESHOLD          = float(os.getenv("PROM_ALERT_MEM_THRESHOLD",         "70.0"))
_HTTP_SLOW_THRESHOLD_MS = float(os.getenv("PROM_ALERT_HTTP_SLOW_MS",         "3000.0"))
_LOG_ERROR_RATE_THRESHOLD = float(os.getenv("PROM_ALERT_LOG_ERROR_RATE",       "5.0"))   # 건/분
_DISK_IO_MS_THRESHOLD   = float(os.getenv("PROM_ALERT_DISK_IO_MS",           "200.0"))   # ms

# ── 네트워크 대역폭 ───────────────────────────────────────────────────────────
# Full-duplex NIC: TX / RX 각각 독립 판정. 합산 사용 금지.
_NET_MAX_MBPS        = float(os.getenv("PROM_NET_MAX_MBPS",               "1000.0"))  # NIC 속도 Mbps
_NET_THRESHOLD_PCT   = float(os.getenv("PROM_ALERT_NET_THRESHOLD_PCT",     "70.0"))   # warning %
_NET_CRITICAL_PCT    = float(os.getenv("PROM_ALERT_NET_CRITICAL_PCT",      "90.0"))   # critical %

# ── 임계치 (critical) ─────────────────────────────────────────────────────────
_CPU_CRITICAL = float(os.getenv("PROM_ALERT_CPU_CRITICAL", "90.0"))
_MEM_CRITICAL = float(os.getenv("PROM_ALERT_MEM_CRITICAL", "90.0"))

# ── 쿨다운 (인메모리, 재시작 시 초기화) ──────────────────────────────────────
_COOLDOWN_SECONDS = int(os.getenv("PROM_ALERT_COOLDOWN_SECONDS", "1800"))  # 30분
_host_cooldown: dict[str, datetime] = {}


def _is_in_cooldown(host: str) -> bool:
    last = _host_cooldown.get(host)
    if not last:
        return False
    return (datetime.now(timezone.utc).replace(tzinfo=None) - last).total_seconds() < _COOLDOWN_SECONDS


def _record_sent(host: str) -> None:
    _host_cooldown[host] = datetime.now(timezone.utc).replace(tzinfo=None)


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

async def _get_system_info(db: AsyncSession, system_name: str) -> Optional[dict]:
    """system_name → System + contacts"""
    result = await db.execute(select(System).where(System.system_name == system_name))
    system = result.scalar_one_or_none()
    if not system:
        return None
    contacts_result = await db.execute(
        select(Contact)
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .where(SystemContact.system_id == system.id)
    )
    contacts = contacts_result.scalars().all()
    return {
        "id": system.id,
        "system_name": system.system_name,
        "display_name": system.display_name,
        "teams_webhook_url": system.teams_webhook_url,
        "contacts": [
            {"name": c.name, "teams_upn": c.teams_upn}
            for c in contacts
        ],
    }


# ── 메트릭 수집 → HostContext 구성 ──────────────────────────────────────────

async def _build_host_contexts() -> dict[str, HostContext]:
    """Prometheus에서 전체 메트릭을 host 기준으로 집계하여 HostContext 맵 반환"""
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
        sm.cpu_avg = val
        if val > _CPU_THRESHOLD:
            sm.anomalies.append(f"CPU 평균 {val:.1f}% (임계치 {_CPU_THRESHOLD}%)")

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
        sm.mem_used_pct = val
        if val > _MEM_THRESHOLD:
            sm.anomalies.append(f"메모리 사용률 {val:.1f}% (임계치 {_MEM_THRESHOLD}%)")

    # 3. 로그 에러 rate — 레벨별 (5분 평균, 건/분)
    log_results = await _query_prometheus(
        "sum by (host, system_name, display_name, level)"
        " (rate(log_error_total[5m])) * 60"
    )
    for r in log_results:
        host  = r["metric"].get("host", "")
        sn    = r["metric"].get("system_name", "unknown")
        dn    = r["metric"].get("display_name", sn)
        level = r["metric"].get("level", "UNKNOWN")
        val   = float(r["value"][1])
        if not host:
            continue
        sm = _get_host(host).get_or_create(sn)
        sm.display_name = sm.display_name or dn
        sm.log_by_level[level] = sm.log_by_level.get(level, 0.0) + val
        sm.log_error_rate += val

    for hc in hosts.values():
        for sm in hc.systems.values():
            if sm.log_error_rate > _LOG_ERROR_RATE_THRESHOLD:
                level_detail = ", ".join(
                    f"{lv} {rate:.1f}건/분"
                    for lv, rate in sorted(sm.log_by_level.items(), key=lambda x: -x[1])
                )
                sm.anomalies.append(
                    f"로그 에러 {sm.log_error_rate:.1f}건/분 급증"
                    f" ({level_detail}, 임계치 {_LOG_ERROR_RATE_THRESHOLD}건/분)"
                )

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
        sm.http_slow.append({"url": url, "ms": val})
        sm.anomalies.append(f"HTTP 지연 {url} {val:.0f}ms (임계치 {_HTTP_SLOW_THRESHOLD_MS}ms)")

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
        sm.net_rx_mbps = val
        if val > _net_threshold_mbps:
            sm.anomalies.append(
                f"네트워크 RX {val:.1f} MB/s"
                f" (대역폭 {val / (_NET_MAX_MBPS / 8) * 100:.0f}%,"
                f" 임계 {_NET_THRESHOLD_PCT}%)"
            )

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
        sm.net_tx_mbps = val
        if val > _net_threshold_mbps:
            sm.anomalies.append(
                f"네트워크 TX {val:.1f} MB/s"
                f" (대역폭 {val / (_NET_MAX_MBPS / 8) * 100:.0f}%,"
                f" 임계 {_NET_THRESHOLD_PCT}%)"
            )

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
        sm.disk_io_ms = val
        if val > _DISK_IO_MS_THRESHOLD:
            sm.anomalies.append(f"디스크 I/O {val:.0f}ms (임계치 {_DISK_IO_MS_THRESHOLD}ms)")

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
        if sm.net_rx_mbps is not None and sm.net_rx_mbps > _net_critical_mbps:
            return "critical"
        if sm.net_tx_mbps is not None and sm.net_tx_mbps > _net_critical_mbps:
            return "critical"
    return "warning"


# ── LLM 프롬프트 구성 ─────────────────────────────────────────────────────────

def _build_llm_prompt(hc: HostContext, system_infos: dict[str, dict]) -> str:
    """host 전체 컨텍스트를 포함한 LLM 프롬프트 생성"""
    lines = [f"[물리 서버: {hc.host}]", ""]

    # 인프라 메트릭
    infra_lines = []
    if hc.infra_cpu:
        sn, val = hc.infra_cpu
        dn = hc.systems[sn].display_name or sn
        flag = " ⚠️ 임계치 초과" if val > _CPU_THRESHOLD else ""
        infra_lines.append(f"  CPU 평균: {val:.1f}%{flag} (수집: {dn})")
    if hc.infra_mem:
        sn, val = hc.infra_mem
        dn = hc.systems[sn].display_name or sn
        flag = " ⚠️ 임계치 초과" if val > _MEM_THRESHOLD else ""
        infra_lines.append(f"  메모리 사용률: {val:.1f}%{flag} (수집: {dn})")
    if hc.infra_net:
        sn, rx, tx = hc.infra_net
        net_max_mbps = _NET_MAX_MBPS / 8
        rx_pct = rx / net_max_mbps * 100
        tx_pct = tx / net_max_mbps * 100
        _net_thr = _net_threshold_mbps = _NET_MAX_MBPS / 8 * _NET_THRESHOLD_PCT / 100
        rx_flag = " ⚠️" if rx > _net_thr else ""
        tx_flag = " ⚠️" if tx > _net_thr else ""
        infra_lines.append(
            f"  네트워크: RX {rx:.1f} MB/s ({rx_pct:.0f}%){rx_flag}"
            f" / TX {tx:.1f} MB/s ({tx_pct:.0f}%){tx_flag}"
        )
    if hc.infra_disk:
        sn, val = hc.infra_disk
        flag = " ⚠️ 임계치 초과" if val > _DISK_IO_MS_THRESHOLD else ""
        infra_lines.append(f"  디스크 I/O: {val:.0f}ms{flag}")

    if infra_lines:
        lines.append("[인프라 메트릭]")
        lines.extend(infra_lines)
        lines.append("")

    # 시스템별 현황
    lines.append("[시스템별 현황]")
    for sn, sm in hc.systems.items():
        dn = sm.display_name or sn
        label = f"{dn} ({sn})"
        status_parts = []
        if sm.http_req_rate is not None:
            status_parts.append(f"HTTP 요청 {sm.http_req_rate:.0f}건/분")
        if sm.log_error_rate > 0:
            level_str = " / ".join(
                f"{lv} {r:.1f}건/분"
                for lv, r in sorted(sm.log_by_level.items(), key=lambda x: -x[1])
            )
            flag = " ⚠️" if sm.log_error_rate > _LOG_ERROR_RATE_THRESHOLD else ""
            status_parts.append(f"로그 에러 {sm.log_error_rate:.1f}건/분{flag} ({level_str})")
        if sm.http_slow:
            for h in sm.http_slow:
                status_parts.append(f"HTTP 지연 {h['url']} {h['ms']:.0f}ms ⚠️")
        if not status_parts:
            status_parts.append("정상")
        lines.append(f"  {label}: {' | '.join(status_parts)}")
    lines.append("")

    # 분석 요청
    anomalous_systems = [
        f"{sm.display_name or sn} ({sn})"
        for sn, sm in hc.systems.items()
        if sm.anomalies
    ]
    lines.append(
        "위 현황을 종합하여 다음을 분석하세요 (한국어, 5문장 이내):\n"
        "1. 인프라 자원(CPU/메모리/네트워크/디스크)과 각 시스템 로그 에러의 연관성\n"
        "2. 어느 시스템이 자원 부하의 원인일 가능성이 높은지\n"
        "3. 운영팀이 즉시 확인해야 할 조치사항"
    )
    if anomalous_systems:
        lines.append(f"\n이상 감지 시스템: {', '.join(anomalous_systems)}")

    return "\n".join(lines)


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
        system_labels.append(info["display_name"] or sn)
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

    severity_color = "Attention" if severity == "critical" else "Warning"
    title = f"[{hc.host}] {'🔴' if severity == 'critical' else '🟡'} 이상 감지 — {', '.join(system_labels)}"
    mention_str = ""
    if all_contacts:
        mention_str = " ".join(
            f"<at>{c['teams_upn']}</at>"
            for c in all_contacts
            if c.get("teams_upn")
        )

    card = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": title,
                            "weight": "Bolder",
                            "size": "Medium",
                            "color": severity_color,
                            "wrap": True,
                        },
                        {
                            "type": "TextBlock",
                            "text": analysis,
                            "wrap": True,
                            "size": "Small",
                        },
                        *(
                            [{"type": "TextBlock", "text": mention_str, "wrap": True}]
                            if mention_str else []
                        ),
                        {
                            "type": "TextBlock",
                            "text": f"감지 시각: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                            "size": "Small",
                            "isSubtle": True,
                        },
                    ],
                },
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=card)
            if resp.status_code != 200:
                logger.warning("Teams webhook responded %s for host %s", resp.status_code, hc.host)
            else:
                logger.info("Teams 알림 발송 완료 — host=%s systems=%s severity=%s", hc.host, anomalous_systems, severity)
    except Exception as e:
        logger.warning("Teams send failed for host %s: %s", hc.host, e)


# ── 분석 사이클 ───────────────────────────────────────────────────────────────

async def run_analysis_cycle() -> None:
    """host 기준 메트릭 이상 감지 + 교차 분석 + Teams 알림 1 사이클"""
    if not _PROMETHEUS_URL:
        return

    hosts = await _build_host_contexts()
    anomalous_hosts = {h: hc for h, hc in hosts.items() if hc.has_anomaly}

    if not anomalous_hosts:
        return

    async with AsyncSessionLocal() as db:
        # 업무영역별 agent_code 조회 (한 번만)
        _cfg_result = await db.execute(
            select(LlmAgentConfig.agent_code)
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

            prompt = _build_llm_prompt(hc, system_infos)
            logger.info("Anomaly detected — host=%s severity=%s systems=%s", host, severity, list(hc.systems.keys()))

            analysis: Optional[str] = None
            llm_error: Optional[str] = None
            try:
                analysis = await call_llm_text(prompt, max_tokens=400, agent_code=infra_agent_code)
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

                anomaly_title = f"[prometheus_analyzer] {', '.join(sm.anomalies[:2])}"

                # ① AlertHistory (인시던트 그루핑 포함)
                history = AlertHistory(
                    system_id=info["id"],
                    alert_type="metric",
                    severity=severity,
                    alertname="prometheus_analyzer_anomaly",
                    title=anomaly_title,
                    description=analysis[:500],
                    instance_role="prometheus_analyzer",
                    host=host,
                    anomaly_type="new",
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
                    description=f"[{severity.upper()}] prometheus_analyzer: {', '.join(sm.anomalies)}",
                    actor_name="prometheus_analyzer",
                ))

                # ② LogAnalysisHistory (LLM 분석 내용)
                db.add(LogAnalysisHistory(
                    system_id=info["id"],
                    instance_role="prometheus_analyzer",
                    log_content=analysis[:10000],
                    analysis_result=analysis,
                    severity=severity,
                    root_cause="LLM 분석 실패 — 이상 목록만 나열" if llm_error else analysis[:500],
                    recommendation="",
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
