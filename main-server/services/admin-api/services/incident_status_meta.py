"""인시던트 상태 메타데이터 — 한국어 라벨, 진행률, 권장 액션 매핑.

routes/incidents.py와 chat_tools/executors/admin.py에서 공통으로 사용.
status는 incidents 테이블의 5단계 enum: open / acknowledged / investigating / resolved / closed.
"""

from __future__ import annotations


INCIDENT_STATUS_KO: dict[str, str] = {
    "open": "신규",
    "acknowledged": "확인",
    "investigating": "조사중",
    "resolved": "해결",
    "closed": "종결",
}


INCIDENT_PROGRESS: dict[str, int] = {
    "open": 20,
    "acknowledged": 40,
    "investigating": 60,
    "resolved": 80,
    "closed": 100,
}


INCIDENT_NEXT_ACTION: dict[str, str] = {
    "open": "담당자 호출 + 인시던트 확인 처리. 영향 범위 1차 파악.",
    "acknowledged": "원인 조사 시작. 상태를 원인 파악 중으로 전환.",
    "investigating": "근본 원인 확정 + 조치 내용 작성. 조치 완료 시 해결 처리.",
    "resolved": "사후 분석 작성. 문제 재발 방지 대책 수립 후 종결.",
    "closed": "종결됨. 추가 액션 불필요.",
}


def status_meta(status: str | None) -> dict[str, object]:
    """status에 대한 ko 라벨, 진행률, 권장 액션을 dict으로 반환.

    알 수 없는 status도 fallback으로 안전하게 처리.
    """
    s = (status or "open").lower()
    return {
        "status": s,
        "status_ko": INCIDENT_STATUS_KO.get(s, s),
        "progress_pct": INCIDENT_PROGRESS.get(s, 0),
        "next_action": INCIDENT_NEXT_ACTION.get(s, "상태를 확인 후 다음 단계 진행."),
    }
