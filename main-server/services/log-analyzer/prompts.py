"""log-analyzer LLM 프롬프트 중앙 관리 모듈.

모든 LLM 호출에 전달되는 프롬프트 함수를 이 파일에서 관리한다.
새 LLM 호출 추가 시 프롬프트 함수를 이 파일에 먼저 작성 후 호출 모듈에서 import 한다.
"""


# ── 로그 분석 프롬프트 (vector_client.py) ────────────────────────────────────

def build_enhanced_prompt(
    log_content: str,
    system_name: str,
    instance_role: str,
    anomaly_info: dict,
    trace_context: str = "",
    trace_tier: str = "5min",
    postmortems: list[dict] | None = None,
) -> str:
    """유사 이력 + 해결책을 포함한 강화 프롬프트 생성.

    토큰 예산: 4,000 토큰 이내 (log_content 3,000자 기본 + 컨텍스트 1,000자)
    trace_context가 있으면 log_content를 tier별로 축소하고 trace 섹션 삽입.

    postmortems: Wave 1B — incident_postmortems에서 가져온 postmortem list.
      각 항목: {"solution": str, "root_cause": str, ...} (payload 필드)
      제공 시 "검증된 해결책" 섹션을 postmortem.solution으로 렌더링.
      None이면 기존 payload.resolution 폴백 동작 유지.
    """
    log_limit_map = {"5min": 2600, "hourly": 2700, "daily": 2800}
    log_limit = log_limit_map.get(trace_tier, 3000) if trace_context else 3000
    similar      = anomaly_info.get("top_results", [])
    anomaly_type = anomaly_info["type"]
    score        = anomaly_info.get("score", 0.0)

    if similar:
        history_lines = []
        for i, r in enumerate(similar[:3], 1):
            p = r["payload"]
            history_lines.append(
                f"[이력{i}] 관련도:{r['score']:.3f} "
                f"심각도:{p.get('severity', '?')} "
                f"패턴:{p.get('log_pattern', '')[:150]}"
            )
        history_ctx = "\n".join(history_lines)
    else:
        history_ctx = "없음"

    if postmortems:
        # Wave 1B: incident_postmortems 서사 기반 해결책
        sol_lines = []
        for pm in postmortems[:2]:
            sol_text = (pm.get("solution") or "").strip()
            if sol_text:
                sol_lines.append(f"- 해결: {sol_text[:200]}")
        solution_ctx = "\n".join(sol_lines) if sol_lines else "등록된 해결책 없음"
    else:
        # 기존 폴백: payload.resolution
        solutions = [r for r in similar if r["payload"].get("resolution")]
        if solutions:
            sol_lines = []
            for s in solutions[:2]:
                p = s["payload"]
                sol_lines.append(
                    f"- 해결: {p['resolution'][:200]}\n"
                    f"  처리자: {p.get('resolver', '미기재')}"
                )
            solution_ctx = "\n".join(sol_lines)
        else:
            solution_ctx = "등록된 해결책 없음"

    type_label = {
        "new":       "신규 이상 (유사 사례 없음)",
        "recurring": f"반복 이상 (RRF {score:.3f})",
        "related":   f"유사 이상 (RRF {score:.3f})",
        "duplicate": f"중복 이상 (RRF {score:.3f})",
    }.get(anomaly_type, "미분류")

    trace_section = ""
    if trace_context:
        trace_section = f"\n=== 분산 추적 요약 ({trace_tier}) ===\n{trace_context}\n"

    return f"""=== 현재 이상 분류: {type_label} ===
시스템: {system_name} / {instance_role}
{trace_section}
{log_content[:log_limit]}

=== 과거 유사 장애 이력 (상위 3건) ===
{history_ctx}

=== 검증된 해결책 ===
{solution_ctx}

위 정보를 바탕으로 반드시 아래 JSON 형식으로만 응답하세요. 추가 설명 없이 JSON만 출력하세요.

작성 규칙(가독성):
- root_cause: 한국어. 핵심 원인 한 줄 요약 + 근거 1~2줄. 각 문장은 줄바꿈(\\n)으로 구분. 마크다운(**, -, #) 사용 금지.
- recommendation: 한국어. 번호 목록 형식으로 작성하되 각 항목을 반드시 줄바꿈(\\n)으로 구분. 예:
  "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ..."
  한 줄에 모든 항목을 이어 쓰지 말 것. 항목 내부는 한 문장으로 간결하게.
- analysis_type: 로그가 여러 [log_type] 섹션으로 구분되어 있을 때만 작성. 단일 원인에서 연쇄된 경우 "cascade", 서로 독립된 이상인 경우 "independent". 단일 섹션이면 생략.

심각도 판단 추가 규칙 (is_notification 분류):
ERROR 레벨이더라도 아래 조건을 **모두** 만족하면 severity=info, is_notification=true로 분류한다.
1. 스택트레이스가 없다 (at com., at org., Caused by: 패턴 없음)
   ※ 예외 클래스명만 있고 스택트레이스 없는 경우 → 메시지 내용으로 판단
2. DB·API·메시지큐 등 외부 시스템 연결 실패가 아니다
3. 메시지 내용이 상태 통보·비즈니스 규칙 거부·정상 종료 중 하나다
   (예: 미사용/미설정/만료/없음/차단/완료)

반드시 warning 이상으로 분류:
- 스택트레이스 포함 (at com., at org., Caused by:)
- 외부 시스템 연결·응답 실패 (DB, API, 메시지큐 등)
- 데이터 처리·정합성 오류

is_notification=true 시 root_cause 작성 규칙:
- 형식: "알림성 로그 — {{판단 근거 1줄}}"
- 예시: "알림성 로그 — 스택트레이스 없음, SSO 미사용 상태 통보"
        "알림성 로그 — 외부 연결 실패 아님, 세션 만료 정상 처리"
- 이 내용이 담당자 알림 카드의 판단 근거로 표시됨

{{"severity": "critical 또는 warning 또는 info", "is_notification": false, "root_cause": "원인 요약\\n근거/세부 설명", "recommendation": "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ...", "error_category": "오류 카테고리 (예: DB_CONNECTION, MEMORY, NETWORK 등)", "estimated_impact": "예상 영향 범위 (한국어, 1문장)", "analysis_type": "cascade 또는 independent (복수 log_type 섹션일 때만)"}}"""


# ── 집계 프롬프트 (aggregation_processor.py) ─────────────────────────────────

def build_hourly_agg_prompt(
    display_name: str,
    system_name: str,
    hour_bucket_iso: str,
    collector_type: str,
    metric_group: str,
    anomaly_reason: str,
    metrics_formatted: str,
    trace_section: str = "",
    trend_section: str = "",
) -> str:
    return (
        f"시스템: {display_name} ({system_name})\n"
        f"시간대: {hour_bucket_iso} (1시간 집계)\n"
        f"수집기: {collector_type} / {metric_group}\n"
        f"이상 감지 사유: {anomaly_reason}\n{trace_section}{trend_section}\n"
        f"[현재 시간 집계 메트릭]\n{metrics_formatted}\n\n"
        "위 메트릭 데이터를 분석하여 다음 JSON 형식으로만 응답하세요:\n"
        "{\n"
        '  "severity": "normal 또는 warning 또는 critical 중 하나",\n'
        '  "trend": "상승 또는 하락 또는 안정 또는 불규칙 (1문장 설명)",\n'
        '  "prediction": "현재 추세가 지속되면 임계치 도달 예상 (예측 불가 시 null)",\n'
        '  "root_cause_hypothesis": "가능한 원인 (한국어, 1문장)",\n'
        '  "recommendation": "권고 조치 (한국어, 1~2문장)"\n'
        "}"
    )


def build_daily_agg_prompt(
    day_label: str,
    system_lines: list[str],
    system_count: int,
) -> str:
    return (
        f"다음은 {day_label} 시스템 모니터링 일별 집계 데이터입니다.\n\n"
        + "\n".join(system_lines)
        + f"\n\n총 {system_count}개 시스템. "
        "한국어로 1-2 문장으로 핵심을 요약해 주세요."
    )


def build_weekly_agg_prompt(
    system_lines: list[str],
    system_count: int,
) -> str:
    return (
        "다음은 지난 7일간 시스템 모니터링 집계 데이터입니다.\n\n"
        "[시스템별 주간 현황 (이상 시간 순)]\n"
        + "\n".join(system_lines)
        + f"\n\n총 {system_count}개 시스템 모니터링. "
        "한국어로 2-3 문장의 핵심 요약을 작성해 주세요. "
        "가장 주의가 필요한 시스템과 전체적인 추세를 포함해 주세요."
    )


def build_monthly_agg_prompt(
    month_name: str,
    system_lines: list[str],
    system_count: int,
) -> str:
    return (
        f"{month_name} 전체 시스템 모니터링 월간 집계입니다.\n\n"
        "[시스템별 월간 현황]\n"
        + "\n".join(system_lines)
        + f"\n\n총 {system_count}개 시스템. "
        "이번 달의 전반적인 시스템 안정성, 주목할 만한 이슈, "
        "다음 달 주의사항을 한국어로 3-4 문장으로 요약해 주세요."
    )


def build_longperiod_agg_prompt(
    label: str,
    period_label_kr: str,
    system_lines: list[str],
    system_count: int,
) -> str:
    return (
        f"{label} 전체 시스템 모니터링 {period_label_kr} 집계입니다.\n\n"
        "[시스템별 현황]\n"
        + "\n".join(system_lines)
        + f"\n\n총 {system_count}개 시스템. "
        "이 기간의 전반적인 시스템 안정성 평가, 개선된 점, "
        "우려되는 장기 추세, 향후 권고사항을 한국어로 4-5 문장으로 요약해 주세요."
    )


def build_trend_alert_prompt(
    display_name: str,
    system_name: str,
    anomaly_hours: int,
    collector_type: str,
    metric_group: str,
    worst_severity: str,
    trend_sequence: str,
    predictions: str,
) -> str:
    return (
        f"시스템: {display_name} ({system_name})\n"
        f"분석 기간: 최근 8시간 중 {anomaly_hours}시간 이상 감지\n"
        f"수집기: {collector_type} / {metric_group}\n"
        f"최고 심각도: {worst_severity}\n\n"
        f"[시간별 추세 흐름]\n{trend_sequence}\n\n"
        f"[기존 예측 목록]\n{predictions}\n\n"
        "이 시스템이 지속적으로 이상 상태를 보이고 있습니다.\n"
        "임계치 도달 예상 시점과 조치 우선순위를 다음 JSON 형식으로만 응답해 주세요:\n"
        "{\n"
        '  "hours_to_breach": 숫자 또는 null,\n'
        '  "breach_metric": "임계치에 먼저 도달할 메트릭명",\n'
        '  "severity": "warning 또는 critical 중 하나",\n'
        '  "trend_summary": "지속 추세 요약 (1문장)",\n'
        '  "immediate_actions": "즉시 조치 사항 (1~2문장)"\n'
        "}"
    )
