#!/usr/bin/env python3
"""
벡터 관리 화면 테스트 데이터 시드 스크립트 (ADR-011/012 이후)

등록된 시스템 수 x 100개의 집계 데이터를 생성한다.
- 1시간~12개월 범위의 집계 데이터
- PostgreSQL (admin-api) + Qdrant (log-analyzer) 동시 저장
- LLM 분석/임베딩은 log-analyzer 내부 FastEmbed + DevX/Claude/OpenAI 가 처리
  (이 스크립트는 템플릿 기반 fallback 텍스트만 생성)

사전 조건:
  - admin-api (8080), log-analyzer (8000), Qdrant (6333) 실행 중

사용법:
  python main-server/scripts/seed_test_data.py
"""

import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta
from functools import partial

# stdout 버퍼링 비활성화
print = partial(print, flush=True)

try:
    import requests
except ImportError:
    print("ERROR: requests 패키지가 필요합니다. pip install requests")
    sys.exit(1)

# ── 설정 ──────────────────────────────────────────────────────────────────────

ADMIN_API = os.getenv("ADMIN_API_URL", "http://localhost:8080")
ANALYZER = os.getenv("LOG_ANALYZER_URL", "http://localhost:8000")
# ADR-011/012: Ollama 제거 — 테스트 데이터 생성은 LLM 호출 없이 fallback 템플릿으로 채운다.

# 시스템당 레코드 분배
COUNTS = {
    "hourly": 50,
    "daily": 20,
    "weekly": 15,
    "monthly": 8,
    "quarterly": 4,
    "half_year": 2,
    "annual": 1,
}

# 시스템 없을 때 자동 생성할 테스트 시스템
TEST_SYSTEMS = [
    {"system_name": "web-server-01", "display_name": "웹서버 01", "status": "active"},
    {"system_name": "db-server-01", "display_name": "DB서버 01", "status": "active"},
    {"system_name": "was-server-01", "display_name": "WAS서버 01", "status": "active"},
]

# 수집기별 메트릭그룹
COLLECTOR_GROUPS = {
    "synapse_agent": ["cpu", "memory", "disk", "network", "log", "web"],
    "db_exporter": ["db_connections", "db_query", "db_cache", "db_replication"],
}

# severity 분배 가중치
SEVERITY_WEIGHTS = {"normal": 65, "warning": 25, "critical": 10}

NOW = datetime.utcnow()


# ── 메트릭 생성기 ─────────────────────────────────────────────────────────────

def _gen_metrics(collector_type: str, metric_group: str, severity: str) -> dict:
    """PROMQL_MAP 키에 맞는 현실적 메트릭 값 생성"""
    # severity에 따라 값 범위 조정
    high = severity in ("warning", "critical")
    crit = severity == "critical"

    generators = {
        ("synapse_agent", "cpu"): lambda: {
            "cpu_avg": round(random.uniform(70, 95) if high else random.uniform(10, 55), 2),
            "cpu_max": round(random.uniform(85, 99) if high else random.uniform(20, 70), 2),
            "cpu_p95": round(random.uniform(80, 98) if high else random.uniform(15, 65), 2),
            "load1": round(random.uniform(3.0, 8.0) if high else random.uniform(0.1, 2.5), 2),
            "load5": round(random.uniform(2.5, 6.0) if high else random.uniform(0.1, 2.0), 2),
        },
        ("synapse_agent", "memory"): lambda: {
            "mem_used_pct": round(random.uniform(82, 97) if high else random.uniform(20, 70), 2),
            "mem_p95": round(random.uniform(85, 99) if high else random.uniform(25, 75), 2),
        },
        ("synapse_agent", "disk"): lambda: {
            "disk_read_mb": round(random.uniform(30, 100) if high else random.uniform(0.1, 20), 2),
            "disk_write_mb": round(random.uniform(40, 150) if high else random.uniform(0.1, 30), 2),
            "disk_io_ms": round(random.uniform(100, 500) if high else random.uniform(0.5, 50), 2),
        },
        ("synapse_agent", "network"): lambda: {
            "net_rx_mb": round(random.uniform(50, 200) if high else random.uniform(0.1, 30), 2),
            "net_tx_mb": round(random.uniform(40, 150) if high else random.uniform(0.1, 25), 2),
        },
        ("synapse_agent", "log"): lambda: {
            "log_errors": random.randint(15, 100) if high else random.randint(0, 8),
            "log_errors_err": random.randint(10, 80) if high else random.randint(0, 5),
        },
        ("synapse_agent", "web"): lambda: {
            "req_total": random.randint(500, 10000),
            "req_slow": random.randint(50, 500) if high else random.randint(0, 20),
            "resp_avg_ms": round(random.uniform(2000, 5000) if crit else (random.uniform(800, 2000) if high else random.uniform(10, 500)), 2),
        },
        ("db_exporter", "db_connections"): lambda: {
            "conn_active_pct": round(random.uniform(80, 98) if high else random.uniform(5, 60), 2),
            "conn_max": random.randint(100, 300) if high else random.randint(5, 80),
        },
        ("db_exporter", "db_query"): lambda: {
            "tps": round(random.uniform(200, 800), 2),
            "slow_queries": random.randint(20, 100) if high else random.randint(0, 5),
        },
        ("db_exporter", "db_cache"): lambda: {
            "cache_hit_rate": round(random.uniform(60, 90) if high else random.uniform(95, 99.9), 2),
        },
        ("db_exporter", "db_replication"): lambda: {
            "repl_lag_sec": round(random.uniform(10, 60) if high else random.uniform(0, 3), 2),
        },
    }
    gen = generators.get((collector_type, metric_group))
    if gen:
        return gen()
    return {"value": round(random.uniform(0, 100), 2)}


def _pick_severity() -> str:
    return random.choices(
        list(SEVERITY_WEIGHTS.keys()),
        weights=list(SEVERITY_WEIGHTS.values()),
    )[0]


# ── 테스트 분석 결과 생성 (LLM 호출 없이 템플릿 기반, ADR-012) ─────────────────

def generate_llm_analysis(
    display_name: str, system_name: str,
    collector_type: str, metric_group: str,
    metrics: dict, severity_hint: str,
) -> dict:
    """템플릿 기반 분석 결과 생성 (LLM 호출 없음). ADR-012로 Ollama 제거됨 → 실제 LLM은 log-analyzer 스케줄러가 처리."""
    result = {
        "severity": severity_hint,
        "trend": "안정적으로 유지되고 있습니다.",
        "prediction": None,
        "root_cause_hypothesis": f"{metric_group} 지표 변동 없음",
        "recommendation": "현재 상태 유지, 정기 모니터링 권장",
    }

    # summary_text 구성
    result["summary_text"] = (
        f"[{display_name}] {collector_type}/{metric_group} — "
        f"추세: {result['trend']}. 원인: {result['root_cause_hypothesis']}. "
        f"권고: {result['recommendation']}"
    )

    return result


# ── 시간 버킷 생성 ────────────────────────────────────────────────────────────

def hourly_buckets(count: int) -> list[datetime]:
    base = NOW.replace(minute=0, second=0, microsecond=0)
    return [base - timedelta(hours=i) for i in range(count)]


def daily_buckets(count: int) -> list[datetime]:
    base = NOW.replace(hour=0, minute=0, second=0, microsecond=0)
    return [base - timedelta(days=i) for i in range(count)]


def weekly_buckets(count: int) -> list[datetime]:
    today = NOW.date()
    monday = today - timedelta(days=today.weekday())
    return [
        datetime(*(monday - timedelta(weeks=i)).timetuple()[:3])
        for i in range(count)
    ]


def monthly_buckets(count: int) -> list[tuple[datetime, str]]:
    """(period_start, period_type) 튜플 리스트 반환"""
    results = []
    # monthly
    for i in range(min(count, 8)):
        y = NOW.year
        m = NOW.month - i
        while m <= 0:
            m += 12
            y -= 1
        results.append((datetime(y, m, 1), "monthly"))

    # quarterly
    for i in range(min(4, count - len(results))):
        quarter_month = ((NOW.month - 1) // 3) * 3 + 1
        y = NOW.year
        m = quarter_month - i * 3
        while m <= 0:
            m += 12
            y -= 1
        results.append((datetime(y, m, 1), "quarterly"))

    # half_year
    for i in range(min(2, count - len(results))):
        half_month = 1 if NOW.month <= 6 else 7
        y = NOW.year
        m = half_month - i * 6
        while m <= 0:
            m += 12
            y -= 1
        results.append((datetime(y, m, 1), "half_year"))

    # annual
    remaining = count - len(results)
    for i in range(min(1, remaining)):
        results.append((datetime(NOW.year - i, 1, 1), "annual"))

    return results


# ── Preflight 검사 ────────────────────────────────────────────────────────────

def check_admin_api() -> None:
    print(f"[Preflight] admin-api ({ADMIN_API}) 연결 확인...")
    try:
        resp = requests.get(f"{ADMIN_API}/api/v1/systems", timeout=10)
        resp.raise_for_status()
        print(f"  OK — 시스템 {len(resp.json())}개 등록됨")
    except requests.ConnectionError:
        print(f"  ERROR: admin-api에 연결할 수 없습니다 ({ADMIN_API})")
        sys.exit(1)


def check_log_analyzer() -> None:
    print(f"[Preflight] log-analyzer ({ANALYZER}) 연결 확인...")
    try:
        resp = requests.get(f"{ANALYZER}/health", timeout=10)
        resp.raise_for_status()
        print("  OK")
    except requests.ConnectionError:
        print(f"  ERROR: log-analyzer에 연결할 수 없습니다 ({ANALYZER})")
        sys.exit(1)


# ── 시스템 부트스트랩 ─────────────────────────────────────────────────────────

def ensure_systems() -> list[dict]:
    resp = requests.get(f"{ADMIN_API}/api/v1/systems")
    systems = resp.json()
    if not systems:
        print("[Setup] 시스템이 없어 테스트 시스템 3개를 생성합니다...")
        for s in TEST_SYSTEMS:
            r = requests.post(f"{ADMIN_API}/api/v1/systems", json=s)
            if r.ok:
                print(f"  생성: {s['display_name']} ({s['system_name']})")
            else:
                print(f"  실패: {s['system_name']} — {r.status_code} {r.text}")
        resp = requests.get(f"{ADMIN_API}/api/v1/systems")
        systems = resp.json()
    if not systems:
        print("ERROR: 시스템을 생성할 수 없습니다.")
        sys.exit(1)
    return systems


def setup_collections() -> None:
    print("[Setup] Qdrant 컬렉션 초기화...")
    resp = requests.post(f"{ANALYZER}/aggregation/collections/setup", timeout=30)
    if resp.ok:
        print(f"  OK — {resp.json()}")
    else:
        print(f"  WARN: {resp.status_code} {resp.text}")


# ── 수집기/메트릭그룹 순환 선택기 ─────────────────────────────────────────────

def _build_collector_cycle():
    """모든 (collector_type, metric_group) 조합을 순환하는 제너레이터"""
    pairs = []
    for ct, groups in COLLECTOR_GROUPS.items():
        for mg in groups:
            pairs.append((ct, mg))
    idx = 0
    while True:
        yield pairs[idx % len(pairs)]
        idx += 1


# ── 레코드 생성 함수 ─────────────────────────────────────────────────────────

def create_hourly_record(
    system: dict, hour_bucket: datetime,
    collector_type: str, metric_group: str,
    idx: int, total: int,
) -> bool:
    severity = _pick_severity()
    metrics = _gen_metrics(collector_type, metric_group, severity)

    # LLM 분석
    llm = generate_llm_analysis(
        system.get("display_name", system["system_name"]),
        system["system_name"],
        collector_type, metric_group, metrics, severity,
    )

    # Step 1: admin-api에 PG 저장
    pg_body = {
        "system_id": system["id"],
        "collector_type": collector_type,
        "metric_group": metric_group,
        "metrics_json": json.dumps(metrics),
        "llm_summary": llm.get("summary_text", ""),
        "llm_severity": severity,
        "llm_trend": llm.get("trend"),
        "llm_prediction": llm.get("prediction"),
        "llm_model_used": LLM_MODEL,
        "hour_bucket": hour_bucket.isoformat(),
    }
    resp = requests.post(f"{ADMIN_API}/api/v1/aggregations/hourly", json=pg_body, timeout=30)
    if not resp.ok:
        print(f"    [FAIL] hourly PG 저장 실패: {resp.status_code}")
        return False
    pg_row_id = resp.json()["id"]

    # Step 2: log-analyzer store-hourly (임베딩 + Qdrant)
    store_body = {
        "system_id": system["id"],
        "system_name": system["system_name"],
        "hour_bucket": hour_bucket.isoformat(),
        "collector_type": collector_type,
        "metric_group": metric_group,
        "summary_text": llm.get("summary_text", ""),
        "llm_severity": severity,
        "llm_trend": llm.get("trend"),
        "llm_prediction": llm.get("prediction"),
        "pg_row_id": pg_row_id,
    }
    resp2 = requests.post(f"{ANALYZER}/aggregation/store-hourly", json=store_body, timeout=60)
    if not resp2.ok:
        print(f"    [WARN] store-hourly 실패: {resp2.status_code}")
        return False
    point_id = resp2.json().get("point_id")

    # Step 3: qdrant_point_id 업데이트 (upsert)
    pg_body["qdrant_point_id"] = point_id
    requests.post(f"{ADMIN_API}/api/v1/aggregations/hourly", json=pg_body, timeout=30)

    print(f"  hourly [{idx}/{total}] {system['system_name']} {collector_type}/{metric_group} "
          f"severity={severity} -> OK (point={point_id[:8]}...)")
    return True


def create_summary_record(
    system: dict,
    period_type: str,
    period_start: datetime,
    collector_type: str, metric_group: str,
    admin_endpoint: str,
    bucket_field: str,
    idx: int, total: int,
    label: str,
) -> bool:
    severity = _pick_severity()
    metrics = _gen_metrics(collector_type, metric_group, severity)

    # LLM 분석
    llm = generate_llm_analysis(
        system.get("display_name", system["system_name"]),
        system["system_name"],
        collector_type, metric_group, metrics, severity,
    )

    # Step 1: admin-api PG 저장
    pg_body = {
        "system_id": system["id"],
        "collector_type": collector_type,
        "metric_group": metric_group,
        "metrics_json": json.dumps(metrics),
        "llm_summary": llm.get("summary_text", ""),
        "llm_severity": severity,
        "llm_trend": llm.get("trend"),
        bucket_field: period_start.isoformat(),
    }
    if admin_endpoint == "monthly":
        pg_body["period_type"] = period_type

    resp = requests.post(
        f"{ADMIN_API}/api/v1/aggregations/{admin_endpoint}",
        json=pg_body, timeout=30,
    )
    if not resp.ok:
        print(f"    [FAIL] {label} PG 저장 실패: {resp.status_code}")
        return False
    pg_row_id = resp.json()["id"]

    # Step 2: log-analyzer store-summary (임베딩 + Qdrant)
    store_body = {
        "system_id": system["id"],
        "system_name": system["system_name"],
        "period_type": period_type,
        "period_start": period_start.isoformat(),
        "summary_text": llm.get("summary_text", ""),
        "dominant_severity": severity,
        "pg_row_id": pg_row_id,
    }
    resp2 = requests.post(f"{ANALYZER}/aggregation/store-summary", json=store_body, timeout=60)
    if not resp2.ok:
        print(f"    [WARN] store-summary 실패: {resp2.status_code}")
        return False
    point_id = resp2.json().get("point_id")

    # Step 3: qdrant_point_id 업데이트
    pg_body["qdrant_point_id"] = point_id
    requests.post(
        f"{ADMIN_API}/api/v1/aggregations/{admin_endpoint}",
        json=pg_body, timeout=30,
    )

    print(f"  {label} [{idx}/{total}] {system['system_name']} {collector_type}/{metric_group} "
          f"severity={severity} -> OK (point={point_id[:8]}...)")
    return True


# ── 메인 실행 ─────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  벡터 관리 테스트 데이터 시드 스크립트")
    print("=" * 60)
    start_time = time.time()

    # Preflight (ADR-012: Ollama 사전 체크 제거)
    check_admin_api()
    check_log_analyzer()

    # Setup
    systems = ensure_systems()
    setup_collections()

    total_per_system = sum(COUNTS.values())
    total_records = len(systems) * total_per_system
    print(f"\n시스템 {len(systems)}개 x {total_per_system}건 = 총 {total_records}건 생성 시작\n")

    stats = {"success": 0, "fail": 0}
    record_num = 0

    for sys_idx, system in enumerate(systems):
        sys_name = system.get("display_name", system["system_name"])
        print(f"\n{'─' * 50}")
        print(f"시스템 [{sys_idx + 1}/{len(systems)}]: {sys_name}")
        print(f"{'─' * 50}")

        cycle = _build_collector_cycle()

        # ── Hourly (50건) ──
        buckets = hourly_buckets(COUNTS["hourly"])
        for i, bucket in enumerate(buckets):
            record_num += 1
            ct, mg = next(cycle)
            ok = create_hourly_record(system, bucket, ct, mg, i + 1, COUNTS["hourly"])
            stats["success" if ok else "fail"] += 1

        # ── Daily (20건) ──
        buckets = daily_buckets(COUNTS["daily"])
        for i, bucket in enumerate(buckets):
            record_num += 1
            ct, mg = next(cycle)
            ok = create_summary_record(
                system, "daily", bucket, ct, mg,
                admin_endpoint="daily", bucket_field="day_bucket",
                idx=i + 1, total=COUNTS["daily"], label="daily",
            )
            stats["success" if ok else "fail"] += 1

        # ── Weekly (15건) ──
        buckets = weekly_buckets(COUNTS["weekly"])
        for i, bucket in enumerate(buckets):
            record_num += 1
            ct, mg = next(cycle)
            ok = create_summary_record(
                system, "weekly", bucket, ct, mg,
                admin_endpoint="weekly", bucket_field="week_start",
                idx=i + 1, total=COUNTS["weekly"], label="weekly",
            )
            stats["success" if ok else "fail"] += 1

        # ── Monthly/Quarterly/HalfYear/Annual (15건) ──
        monthly_total = COUNTS["monthly"] + COUNTS["quarterly"] + COUNTS["half_year"] + COUNTS["annual"]
        m_buckets = monthly_buckets(monthly_total)
        for i, (bucket, ptype) in enumerate(m_buckets):
            record_num += 1
            ct, mg = next(cycle)
            ok = create_summary_record(
                system, ptype, bucket, ct, mg,
                admin_endpoint="monthly", bucket_field="period_start",
                idx=i + 1, total=monthly_total, label=ptype,
            )
            stats["success" if ok else "fail"] += 1

    # ── 결과 출력 ──
    elapsed = time.time() - start_time
    print(f"\n{'=' * 60}")
    print(f"  완료: {stats['success']}건 성공, {stats['fail']}건 실패")
    print(f"  소요 시간: {elapsed:.1f}초 ({elapsed / 60:.1f}분)")
    print(f"  레코드당 평균: {elapsed / max(record_num, 1):.1f}초")
    print(f"{'=' * 60}")

    # 컬렉션 상태 확인
    print("\n[검증] Qdrant 컬렉션 현황:")
    try:
        resp = requests.get(f"{ANALYZER}/aggregation/collections/info", timeout=10)
        if resp.ok:
            info = resp.json()
            for name, data in info.items():
                points = data.get("points_count", "?")
                status = data.get("status", "?")
                print(f"  {name}: {points}개 포인트 (status={status})")
        else:
            print(f"  조회 실패: {resp.status_code}")
    except Exception as e:
        print(f"  조회 실패: {e}")


if __name__ == "__main__":
    main()
