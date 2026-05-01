"""
로그 텍스트 정규화 유틸리티

analyzer.py에서 사용하는 순수 함수들:
- mask_sensitive_data: PII/결제정보 마스킹
- _sample_logs_by_type: log_type 비율 보장 샘플링
- _format_logs_by_type: log_type별 섹션 포맷
"""

import re


def mask_sensitive_data(text: str) -> str:
    """PII 및 결제정보 마스킹 처리"""
    text = re.sub(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', '****-****-****-****', text)  # 카드번호
    text = re.sub(r'\b\d{6}[-\s]?\d{7}\b', '******-*******', text)                              # 주민등록번호
    text = re.sub(r'\b01[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b', '010-****-****', text)               # 전화번호
    text = re.sub(r'[\w.-]+@[\w.-]+\.\w+', '***@***.***', text)                                 # 이메일
    return text


def _sample_logs_by_type(logs: list[dict], max_count: int = 50) -> list[dict]:
    """log_type 비율 보장 샘플링. 전체 ≤ max_count면 전부 반환."""
    if len(logs) <= max_count:
        return logs
    by_type: dict[str, list[dict]] = {}
    for entry in logs:
        by_type.setdefault(entry.get("log_type", "app"), []).append(entry)
    # 발생 횟수(count) 합계 내림차순으로 log_type 정렬
    sorted_types = sorted(
        by_type.items(),
        key=lambda x: -sum(e["count"] for e in x[1]),
    )
    total = len(logs)
    sampled: list[dict] = []
    remaining = max_count
    for i, (_, type_logs) in enumerate(sorted_types):
        if i == len(sorted_types) - 1:
            alloc = remaining
        else:
            alloc = max(1, round(len(type_logs) / total * max_count))
            alloc = min(alloc, remaining)
        sampled.extend(type_logs[:alloc])
        remaining -= alloc
        if remaining <= 0:
            break
    return sampled


def _format_logs_by_type(logs: list[dict]) -> str:
    """log_type별 섹션으로 분리. 단일 타입이면 헤더 없이 단순 나열."""
    by_type: dict[str, list[dict]] = {}
    for entry in logs:
        by_type.setdefault(entry.get("log_type", "app"), []).append(entry)
    if len(by_type) == 1:
        return "\n".join(entry["line"] for entry in logs)
    lines: list[str] = []
    for log_type, type_logs in sorted(by_type.items(), key=lambda x: -len(x[1])):
        lines.append(f"[{log_type}] {len(type_logs)}건")
        lines.append("─" * 20)
        lines.extend(entry["line"] for entry in type_logs)
        lines.append("")
    return "\n".join(lines).strip()
