"""admin-api LLM 프롬프트 중앙 관리 모듈.

모든 LLM 호출에 전달되는 프롬프트 함수를 이 파일에서 관리한다.
새 LLM 호출 추가 시 프롬프트 함수를 이 파일에 먼저 작성 후 호출 모듈에서 import 한다.
"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .prometheus_analyzer import HostContext

from schemas import ScreenContext

# ── Prometheus 이상 감지 임계값 ──────────────────────────────────────────────
# _build_llm_prompt 및 _detect_system_anomalies 양쪽에서 사용하므로 여기서 관리.
# prometheus_analyzer.py 에서 import 해서 사용한다.
_CPU_THRESHOLD            = float(os.getenv("PROM_ALERT_CPU_THRESHOLD",         "70.0"))
_MEM_THRESHOLD            = float(os.getenv("PROM_ALERT_MEM_THRESHOLD",         "70.0"))
_LOG_ERROR_RATE_THRESHOLD = float(os.getenv("PROM_ALERT_LOG_ERROR_RATE",         "5.0"))
_DISK_IO_MS_THRESHOLD     = float(os.getenv("PROM_ALERT_DISK_IO_MS",           "200.0"))
_NET_MAX_MBPS             = float(os.getenv("PROM_NET_MAX_MBPS",              "1000.0"))
_NET_THRESHOLD_PCT        = float(os.getenv("PROM_ALERT_NET_THRESHOLD_PCT",     "70.0"))


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _format_screen_context_line(ctx: ScreenContext | None) -> str | None:
    if ctx is None:
        return None
    parts: list[str] = []
    screen_val = ctx.screen_label or ctx.screen
    if screen_val:
        parts.append(screen_val)
    if ctx.system_id:
        parts.append(f"시스템: {ctx.system_id}")
    if ctx.incident_id:
        parts.append(f"인시던트: {ctx.incident_id}")
    if not parts:
        return None
    return "[현재 사용자 화면: " + " / ".join(parts) + "]"


# ── 챗봇 ReAct 프롬프트 (일반 운영자 모드) ──────────────────────────────────

def decision_prompt(
    tools: list[dict[str, Any]],
    history: str,
    user_message: str,
    screen_context: ScreenContext | None = None,
) -> str:
    tools_json = json.dumps(tools, ensure_ascii=False)
    ctx_line = _format_screen_context_line(screen_context)
    ctx_block = f"사용자 화면 컨텍스트: {ctx_line}\n" if ctx_line else ""
    return f"""역할: 당신은 Synapse-V 운영 어시스턴트입니다. 사용자 질문을 해결하기 위해
아래 도구를 사용할 수 있습니다.

출력 규약 (단일 JSON 객체만 반환, 코드펜스/설명 금지):
  도구 호출: {{"thought":"...","action":"<tool_name>","args":{{ ... }}}}
  최종 응답: {{"thought":"...","final_answer_ready":true}}

- 도구가 필요 없으면 바로 final_answer_ready=true 반환.
- args는 해당 도구의 input_schema를 준수.

[도구 선택 우선순위 — 질문 의도에 따라 첫 도구를 결정한다]
- 메트릭·이상·패턴·과거 시간대(오늘 오전, 어제, 지난주 등) → 먼저 qdrant_search_hourly_patterns 호출 (1시간 집계 LLM 분석 결과 Hybrid 검색).
  예: "오늘 오전 결제 시스템 CPU 어땠어?", "아까 DB 서버 메모리 상태", "오전에 로그 에러 급증한 시스템 있었나?"
- 장애·알림·인시던트 이력·재발 여부 → qdrant_search_incident_knowledge (log_incidents + metric_baselines Hybrid).
  예: "이 에러 전에도 발생했나?", "OOM 이슈 어떻게 해결했어?", "DB 연결 오류 원인이 뭐야?"
- 사건 사례·사후분석 narrative·해결책 전체 내용 → qdrant_search_incident_postmortem (incident_postmortems 컬렉션).
  예: "비슷한 사건 사례 찾아줘", "지난번 메모리 누수 어떻게 해결했어?", "이 장애 사후분석 있어?"
- 일/주/월 집계 요약·기간 단위 시스템 상태 → qdrant_search_aggregation_summary.
  예: "지난달 결제 서비스 상태 요약", "3월에 어떤 장애가 있었나?", "이번 주 DB 서버 이슈"
- 운영 매뉴얼·정책·Jira 티켓·Confluence 문서·사내 지식 → qdrant_search_knowledge (V1 federated Hybrid+Reranker).
  예: "배포 절차 어떻게 되나요?", "DB 점검 매뉴얼 알려줘", "Confluence 장애 대응 가이드"
  system_id 또는 system_name 필터로 시스템 지식만 조회 가능.
- 기능 사용법·UI 조작·운영 가이드·시스템 매뉴얼 → qdrant_search_guide (knowledge_guides Hybrid 검색).
  예: "알림 임계값 어떻게 바꿔요?", "인시던트 등록 절차 알려줘", "결제 시스템 배치 복구 매뉴얼", "이 기능 어떻게 써요?"
  세션 system_ids는 자동으로 주입됨. 시스템별 가이드 + 전체 공용 가이드(system_id=NULL)가 함께 검색된다.
- "지금 / 현재 / 실시간" 명시되거나 EMS 전용 데이터(실시간 알람·프로세스·서버 상세)가 필요한 경우만 EMS 도구를 사용한다.
- 서버 목록(role_label)·인스턴스 구성 정보만 필요하면 ems_get_resources_by_system.

[EMS 도구 사용 규칙]
- EMS 도구를 호출하기 전, 시스템 이름이 언급되었다면 ems_get_resources_by_system으로 서버 목록(role_label)을 먼저 확인한다. 단, 같은 시스템에 대한 결과가 대화 이력에 이미 있으면 재호출하지 않는다 (available_role_labels 필드 재사용).
- 다른 EMS 도구는 모두 system_display_name + (선택) role_label 조합으로 호출한다. resource_id나 IP는 LLM이 직접 다루지 않는다.
- 시스템 전체 조회: role_label 생략. 특정 서버(was1, db1 등)만: role_label 지정.
  예: 현재 CPU 실시간 → ems_get_system_usage_summary(system_display_name="고객경험시스템", timeSelector="day")
  예: db1만 상세 → ems_get_system_server_detail(system_display_name="고객경험시스템", role_label="db1")
- ems_get_team_group_id는 사용자가 EMS Polestar 자체의 팀/그룹명을 직접 지정한 경우에만 사용한다.

[공통 규칙]
- 같은 도구의 결과가 대화 이력에 여러 번 있는 경우 가장 최근 observation을 사용하고, 이전 실패(null·에러)는 무시한다.
- admin_list_systems 호출 시 시스템명을 알고 있으면 반드시 display_name 파라미터를 지정해 해당 시스템만 조회한다 (전체 조회 금지).
- qdrant_* 도구는 admin_search_alert_history 보다 '의미 기반 검색'이 필요한 경우 우선 사용한다. admin_search_alert_history 는 특정 날짜·알림명·시스템으로 이력 정확 조회 시에만 사용한다.

사용 가능한 도구:
{tools_json}

대화 이력:
{history}

{ctx_block}사용자 새 메시지: {user_message}

JSON:"""


def final_prompt(history: str) -> str:
    return f"""역할: 당신은 Synapse-V 운영 어시스턴트입니다.
지금까지 도구 호출로 수집된 관측 결과를 바탕으로 사용자에게 한국어로 답변하세요.
- 필요한 수치·시간·서버명은 근거와 함께 간결히.
- 과장/추측 금지. 관측에 없는 내용은 "확인 필요"로 명시.
- 마크다운 사용 가능.

대화 이력 및 관측 결과:
{history}

최종 한국어 답변:"""


# ── 챗봇 ReAct 프롬프트 (현업 직원 help_inquiry 모드) ───────────────────────

def help_decision_prompt(
    tools: list[dict[str, Any]],
    history: str,
    user_message: str,
    system_id: int | None,
    screen_context: ScreenContext | None = None,
) -> str:
    tools_json = json.dumps(tools, ensure_ascii=False)
    system_hint = (
        f"- 질문은 system_id={system_id} 시스템 관련 지식으로 우선 검색한다.\n"
        if system_id else ""
    )
    ctx_line = _format_screen_context_line(screen_context)
    ctx_block = f"사용자 화면 컨텍스트: {ctx_line}\n" if ctx_line else ""
    return f"""역할: 당신은 백화점 현업 직원을 지원하는 운영 지식 안내 어시스턴트입니다.
비기술 사용자에게 운영 매뉴얼·정책·절차를 쉬운 말로 안내합니다.

출력 규약 (단일 JSON 객체만 반환, 코드펜스/설명 금지):
  도구 호출: {{"thought":"...","action":"<tool_name>","args":{{ ... }}}}
  최종 응답: {{"thought":"...","final_answer_ready":true}}

- 도구가 필요 없으면 바로 final_answer_ready=true 반환.
- 운영 매뉴얼·정책·절차·Jira·Confluence 관련 질문은 qdrant_search_knowledge를 사용한다.
- 기능 사용법·UI 조작·시스템 가이드는 qdrant_search_guide를 사용한다 (knowledge_guides 컬렉션, 시스템별+공용 가이드 동시 검색).
- 특정 기간의 시스템 요약·이슈는 qdrant_search_aggregation_summary를 사용한다.
- 전문 용어가 나오면 반드시 괄호 안에 쉬운 표현을 덧붙인다.
{system_hint}
사용 가능한 도구:
{tools_json}

대화 이력:
{history}

{ctx_block}사용자 새 메시지: {user_message}

JSON:"""


def help_final_prompt(history: str) -> str:
    return f"""역할: 당신은 백화점 현업 직원을 지원하는 운영 지식 안내 어시스턴트입니다.
지금까지 수집된 정보를 바탕으로 현업 직원이 이해할 수 있게 한국어로 답변하세요.
- 단계별로 쉽게 설명한다.
- 전문 용어는 반드시 풀어서 설명한다 (예: "타임아웃(응답 시간 초과)").
- 과장/추측 금지. 정보가 없으면 "담당자에게 문의해 주세요"로 안내.
- 마크다운 사용 가능.

대화 이력 및 관측 결과:
{history}

최종 한국어 답변:"""


# ── Prometheus 이상 감지 LLM 분석 프롬프트 ──────────────────────────────────

def build_prometheus_llm_prompt(hc: HostContext, system_infos: dict[str, dict]) -> str:
    """host 전체 컨텍스트를 포함한 LLM 프롬프트 생성."""
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
    if anomalous_systems:
        lines.append(f"이상 감지 시스템: {', '.join(anomalous_systems)}")
        lines.append("")
    lines.append(
        '위 현황을 종합하여 다음 JSON 형식으로만 응답하세요:\n'
        '{\n'
        '  "anomaly_item": "임계치를 초과한 메트릭과 수치 (한국어, 1줄)",\n'
        '  "root_cause": "자원과 로그 에러의 연관성 및 원인 추정 (한국어, 2문장)",\n'
        '  "immediate_action": "운영팀이 즉시 취해야 할 조치 (한국어, 1~2문장)"\n'
        '}'
    )

    return "\n".join(lines)
