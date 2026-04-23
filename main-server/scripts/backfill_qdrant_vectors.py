"""
Qdrant 벡터 백필 스크립트 — metric_hourly_patterns / aggregation_summaries

컬렉션 재생성 후 PostgreSQL에 있는 기존 LLM 분석 데이터를 Qdrant에 재등록한다.
- hourly: metric_hourly_aggregations (llm_summary IS NOT NULL)
- daily/weekly/monthly: 각 집계 테이블 (llm_summary IS NOT NULL)

실행:
  pip install psycopg2-binary requests
  python backfill_qdrant_vectors.py
"""

import sys
import time
import psycopg2
import requests

DATABASE_URL = "postgresql://synapse:synapse@localhost:5432/synapse"
LOG_ANALYZER_URL = "http://localhost:8000"
BATCH_SIZE = 10   # 동시 처리 배치 크기
SLEEP_BETWEEN_BATCHES = 0.5  # 초


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def store_hourly(conn, row, session):
    system_id, system_name, row_id, hour_bucket, collector_type, metric_group, \
        llm_summary, llm_severity, llm_trend, llm_prediction = row

    resp = session.post(f"{LOG_ANALYZER_URL}/aggregation/store-hourly", json={
        "system_id":      system_id,
        "system_name":    system_name,
        "hour_bucket":    hour_bucket.isoformat(),
        "collector_type": collector_type,
        "metric_group":   metric_group,
        "summary_text":   llm_summary,
        "llm_severity":   llm_severity or "normal",
        "llm_trend":      llm_trend,
        "llm_prediction": llm_prediction,
        "pg_row_id":      row_id,
    }, timeout=60)
    resp.raise_for_status()
    return resp.json().get("point_id")


def store_summary(conn, system_id, system_name, period_type, period_start, row_id,
                  llm_summary, llm_severity, session):
    resp = session.post(f"{LOG_ANALYZER_URL}/aggregation/store-summary", json={
        "system_id":         system_id,
        "system_name":       system_name,
        "period_type":       period_type,
        "period_start":      period_start.isoformat(),
        "summary_text":      llm_summary,
        "dominant_severity": llm_severity or "normal",
        "pg_row_id":         row_id,
    }, timeout=60)
    resp.raise_for_status()
    return resp.json().get("point_id")


def update_hourly_point_id(conn, row_id, point_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE metric_hourly_aggregations SET qdrant_point_id=%s WHERE id=%s",
            (point_id, row_id)
        )
    conn.commit()


def update_daily_point_id(conn, row_id, point_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE metric_daily_aggregations SET qdrant_point_id=%s WHERE id=%s",
            (point_id, row_id)
        )
    conn.commit()


def update_weekly_point_id(conn, row_id, point_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE metric_weekly_aggregations SET qdrant_point_id=%s WHERE id=%s",
            (point_id, row_id)
        )
    conn.commit()


def update_monthly_point_id(conn, row_id, point_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE metric_monthly_aggregations SET qdrant_point_id=%s WHERE id=%s",
            (point_id, row_id)
        )
    conn.commit()


def backfill_hourly(conn, session):
    print("\n=== [1/4] Hourly 백필 시작 ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT h.system_id, s.system_name, h.id, h.hour_bucket,
                   h.collector_type, h.metric_group,
                   h.llm_summary, h.llm_severity, h.llm_trend, h.llm_prediction
            FROM metric_hourly_aggregations h
            JOIN systems s ON s.id = h.system_id
            WHERE h.llm_summary IS NOT NULL
            ORDER BY h.hour_bucket
        """)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    fail = 0
    for i, row in enumerate(rows, 1):
        row_id = row[2]
        try:
            point_id = store_hourly(conn, row, session)
            update_hourly_point_id(conn, row_id, point_id)
            ok += 1
        except Exception as e:
            print(f"  [FAIL] hourly id={row_id}: {e}")
            fail += 1

        if i % BATCH_SIZE == 0 or i == total:
            print(f"  진행: {i}/{total} (성공={ok} 실패={fail})")
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"  완료: 총 {total}건 → 성공 {ok}, 실패 {fail}")
    return ok, fail


def backfill_daily(conn, session):
    print("\n=== [2/4] Daily 백필 시작 ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT d.system_id, s.system_name, d.id, d.day_bucket,
                   d.llm_summary, d.llm_severity
            FROM metric_daily_aggregations d
            JOIN systems s ON s.id = d.system_id
            WHERE d.llm_summary IS NOT NULL
            ORDER BY d.day_bucket
        """)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    fail = 0
    for i, row in enumerate(rows, 1):
        system_id, system_name, row_id, day_bucket, llm_summary, llm_severity = row
        try:
            point_id = store_summary(
                conn, system_id, system_name, "daily", day_bucket,
                row_id, llm_summary, llm_severity, session
            )
            update_daily_point_id(conn, row_id, point_id)
            ok += 1
        except Exception as e:
            print(f"  [FAIL] daily id={row_id}: {e}")
            fail += 1

        if i % BATCH_SIZE == 0 or i == total:
            print(f"  진행: {i}/{total} (성공={ok} 실패={fail})")
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"  완료: 총 {total}건 → 성공 {ok}, 실패 {fail}")
    return ok, fail


def backfill_weekly(conn, session):
    print("\n=== [3/4] Weekly 백필 시작 ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT w.system_id, s.system_name, w.id, w.week_start,
                   w.llm_summary, w.llm_severity
            FROM metric_weekly_aggregations w
            JOIN systems s ON s.id = w.system_id
            WHERE w.llm_summary IS NOT NULL
            ORDER BY w.week_start
        """)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    fail = 0
    for i, row in enumerate(rows, 1):
        system_id, system_name, row_id, week_start, llm_summary, llm_severity = row
        try:
            point_id = store_summary(
                conn, system_id, system_name, "weekly", week_start,
                row_id, llm_summary, llm_severity, session
            )
            update_weekly_point_id(conn, row_id, point_id)
            ok += 1
        except Exception as e:
            print(f"  [FAIL] weekly id={row_id}: {e}")
            fail += 1

        if i % BATCH_SIZE == 0 or i == total:
            print(f"  진행: {i}/{total} (성공={ok} 실패={fail})")
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"  완료: 총 {total}건 → 성공 {ok}, 실패 {fail}")
    return ok, fail


def backfill_monthly(conn, session):
    print("\n=== [4/4] Monthly 백필 시작 ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.system_id, s.system_name, m.id, m.period_start, m.period_type,
                   m.llm_summary, m.llm_severity
            FROM metric_monthly_aggregations m
            JOIN systems s ON s.id = m.system_id
            WHERE m.llm_summary IS NOT NULL
            ORDER BY m.period_start
        """)
        rows = cur.fetchall()

    total = len(rows)
    ok = 0
    fail = 0
    for i, row in enumerate(rows, 1):
        system_id, system_name, row_id, period_start, period_type, \
            llm_summary, llm_severity = row
        try:
            point_id = store_summary(
                conn, system_id, system_name, period_type, period_start,
                row_id, llm_summary, llm_severity, session
            )
            update_monthly_point_id(conn, row_id, point_id)
            ok += 1
        except Exception as e:
            print(f"  [FAIL] monthly id={row_id}: {e}")
            fail += 1

        if i % BATCH_SIZE == 0 or i == total:
            print(f"  진행: {i}/{total} (성공={ok} 실패={fail})")
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"  완료: 총 {total}건 → 성공 {ok}, 실패 {fail}")
    return ok, fail


def main():
    print("Qdrant 벡터 백필 시작")
    print(f"  DB:  {DATABASE_URL}")
    print(f"  API: {LOG_ANALYZER_URL}")

    # log-analyzer 헬스체크
    try:
        r = requests.get(f"{LOG_ANALYZER_URL}/health", timeout=5)
        r.raise_for_status()
        print("  log-analyzer: OK")
    except Exception as e:
        print(f"  log-analyzer 연결 실패: {e}")
        sys.exit(1)

    conn = get_conn()
    session = requests.Session()

    total_ok = 0
    total_fail = 0
    try:
        for fn in (backfill_hourly, backfill_daily, backfill_weekly, backfill_monthly):
            ok, fail = fn(conn, session)
            total_ok += ok
            total_fail += fail
    finally:
        conn.close()

    print(f"\n=== 전체 완료: 성공 {total_ok}건, 실패 {total_fail}건 ===")


if __name__ == "__main__":
    main()
