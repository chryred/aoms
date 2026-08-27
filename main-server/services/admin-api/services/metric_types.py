"""prometheus_analyzer 메트릭 종류 정의 — 예외처리(metric_exclusions) 매칭 키.

# SYNC: main-server/services/frontend/src/constants/metricTypes.ts
변경 시 양쪽 파일을 함께 수정할 것.
"""
from __future__ import annotations

import re
from enum import Enum


class MetricType(str, Enum):
    CPU = "cpu"
    MEMORY = "memory"
    DISK_IO = "disk_io"
    NETWORK_RX = "network_rx"
    NETWORK_TX = "network_tx"
    HTTP_LATENCY = "http_latency"
    LOG_ERROR_RATE = "log_error_rate"
    ZOMBIE = "zombie"


# 한국어 라벨 — UI 표시용 (DB 저장 값은 enum value 그대로 사용)
METRIC_TYPE_LABELS_KO: dict[str, str] = {
    MetricType.CPU.value: "CPU 사용률",
    MetricType.MEMORY.value: "메모리 사용률",
    MetricType.DISK_IO.value: "디스크 I/O 지연",
    MetricType.NETWORK_RX.value: "네트워크 수신",
    MetricType.NETWORK_TX.value: "네트워크 송신",
    MetricType.HTTP_LATENCY.value: "HTTP 응답 지연",
    MetricType.LOG_ERROR_RATE.value: "로그 에러 발생률",
    MetricType.ZOMBIE.value: "좀비 프로세스",
}

ALLOWED_METRIC_TYPES = frozenset(mt.value for mt in MetricType)


# anomalies title 정규식 매핑 — 레거시 alert_history.metric_types=NULL 행에서 메트릭 종류 추출용
# prometheus_analyzer.py 의 push 메시지와 매칭됨
# (예: "CPU 평균 75.0% (임계치 70%)", "디스크 I/O 278ms (임계치 200ms)")
_TITLE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"CPU\s*평균"), MetricType.CPU.value),
    (re.compile(r"메모리\s*사용률"), MetricType.MEMORY.value),
    (re.compile(r"디스크\s*I/?O"), MetricType.DISK_IO.value),
    (re.compile(r"네트워크\s*RX"), MetricType.NETWORK_RX.value),
    (re.compile(r"네트워크\s*TX"), MetricType.NETWORK_TX.value),
    (re.compile(r"HTTP\s*지연"), MetricType.HTTP_LATENCY.value),
    (re.compile(r"로그\s*에러"), MetricType.LOG_ERROR_RATE.value),
    (re.compile(r"좀비\s*프로세스"), MetricType.ZOMBIE.value),
]


def extract_metric_types_from_title(title: str) -> list[str]:
    """레거시 prometheus_analyzer 알림 title 에서 메트릭 종류 추출 (metric_types 컬럼 폴백용).

    title 예시: "[prometheus_analyzer] 디스크 I/O 278ms (임계치 200ms), CPU 평균 92.0% (임계치 70%)"
    반환: ["disk_io", "cpu"] (중복 제거, 등장 순서 유지)
    """
    if not title:
        return []
    found: list[str] = []
    for pattern, mtype in _TITLE_PATTERNS:
        if pattern.search(title) and mtype not in found:
            found.append(mtype)
    return found
