"""
Synapse Log Analyzer — 백그라운드 스케줄러 태스크

main.py lifespan에서 asyncio.create_task()로 시작되는 스케줄러 함수들과
공유 상태 전역 변수, Jira/Confluence 증분 동기화 로직을 포함한다.

스케줄러 목록:
  _scheduler()               : ANALYSIS_INTERVAL_SECONDS마다 로그 분석
  _hourly_agg_scheduler()    : 매 시간 :05분 hourly 집계
  _daily_agg_scheduler()     : 매일 07:30 KST daily 롤업
  _weekly_agg_scheduler()    : 매주 월요일 08:00 KST weekly 리포트
  _monthly_agg_scheduler()   : 매월 1일 08:00 KST monthly 리포트
  _longperiod_agg_scheduler(): 매월 1일 09:00 KST longperiod 리포트
  _trend_agg_scheduler()     : 4시간마다 trend 이상 알림
  _jira_sync_scheduler()     : 매일 04:00 KST Jira 증분 동기화
  _confluence_sync_scheduler(): 매일 04:30 KST Confluence 증분 동기화
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx

import analyzer
import aggregation_processor
import knowledge_vector_client

logger = logging.getLogger(__name__)

ANALYSIS_INTERVAL = int(os.getenv("ANALYSIS_INTERVAL_SECONDS", "300"))
ADMIN_API_URL = os.getenv("ADMIN_API_URL", "http://admin-api:8080")

# V1 Knowledge 동기화 환경변수 (미설정 시 스케줄러 비활성화)
JIRA_URL           = os.getenv("JIRA_URL")
JIRA_TOKEN         = os.getenv("JIRA_TOKEN")
JIRA_PROJECTS      = os.getenv("JIRA_PROJECTS")
CONFLUENCE_URL     = os.getenv("CONFLUENCE_URL")
CONFLUENCE_TOKEN   = os.getenv("CONFLUENCE_TOKEN")
CONFLUENCE_SPACES  = os.getenv("CONFLUENCE_SPACES")
KNOWLEDGE_SYNC_RATE_LIMIT = int(os.getenv("KNOWLEDGE_SYNC_RATE_LIMIT", "5"))

_KST = timezone(timedelta(hours=9))

# ── 분석 실행 상태 ────────────────────────────────────────────────────────────

_running = False
_last_run: dict = {"started_at": None, "finished_at": None, "result": None}

# ── 집계 실행 상태 ────────────────────────────────────────────────────────────

_AGG_TYPES = ("hourly", "daily", "weekly", "monthly", "longperiod", "trend")
_agg_running: dict[str, bool] = {k: False for k in _AGG_TYPES}
_agg_last_run: dict[str, dict] = {
    k: {"started_at": None, "finished_at": None, "result": None} for k in _AGG_TYPES
}


async def _record_run(scheduler_type: str, started_at: str, finished_at: str, result: dict | None) -> None:
    """스케줄러 실행 결과를 admin-api에 기록 (fire-and-forget, 실패해도 무시)"""
    if result is None:
        result = {}
    has_error = "error" in result
    payload = {
        "scheduler_type": scheduler_type,
        "started_at": started_at,
        "finished_at": finished_at,
        "status": "error" if has_error else "ok",
        "error_count": result.get("errors", 0),
        "analyzed_count": result.get("analyzed", 0) if scheduler_type == "analysis" else result.get("anomalies", 0),
        "summary_json": result,
        "error_message": str(result["error"]) if has_error else None,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"{ADMIN_API_URL}/api/v1/scheduler-runs", json=payload)
    except Exception as exc:
        logger.debug("스케줄러 이력 기록 실패 (무시): %s", exc)


async def _run_analysis_task() -> None:
    global _running, _last_run
    if _running:
        logger.info("이전 분석이 진행 중 — 스킵")
        return
    _running = True
    _last_run["started_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    _last_run["finished_at"] = None
    try:
        result = await analyzer.run_analysis()
        _last_run["result"] = result
    except Exception as e:
        logger.error(f"분석 실행 중 예외: {e}")
        _last_run["result"] = {"error": str(e)}
    finally:
        _running = False
        _last_run["finished_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        asyncio.create_task(_record_run(
            "analysis",
            _last_run["started_at"],
            _last_run["finished_at"],
            _last_run["result"],
        ))


async def _scheduler() -> None:
    """ANALYSIS_INTERVAL_SECONDS 주기로 분석 실행"""
    await asyncio.sleep(15)  # 서비스 기동 안정화 대기
    while True:
        await _run_analysis_task()
        await asyncio.sleep(ANALYSIS_INTERVAL)


def _seconds_until_next(hour: int, minute: int) -> float:
    """다음 KST 지정 시각까지의 초 수"""
    now = datetime.now(_KST)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def _run_agg_task(name: str, fn) -> None:
    global _agg_running, _agg_last_run
    if _agg_running[name]:
        return
    _agg_running[name] = True
    _agg_last_run[name]["started_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    _agg_last_run[name]["finished_at"] = None
    try:
        result = await fn()
        _agg_last_run[name]["result"] = result
    except Exception as e:
        logger.error(f"집계 오류 [{name}]: {e}")
        _agg_last_run[name]["result"] = {"error": str(e)}
    finally:
        _agg_running[name] = False
        _agg_last_run[name]["finished_at"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        asyncio.create_task(_record_run(
            name,
            _agg_last_run[name]["started_at"],
            _agg_last_run[name]["finished_at"],
            _agg_last_run[name]["result"],
        ))


def _trigger_aggregation(task_key: str, coro_fn) -> dict:
    """집계 트리거 공통 처리 — 실행 중이면 상태 반환, 아니면 백그라운드 태스크 시작"""
    if _agg_running[task_key]:
        return {"status": "already_running", "last_run": _agg_last_run[task_key]}
    asyncio.create_task(_run_agg_task(task_key, coro_fn))
    return {"status": "triggered"}


# ── 집계 스케줄러 (WF6~WF11 대체) ────────────────────────────────────────────

async def _hourly_agg_scheduler() -> None:
    """WF6 대체 — 매 시간 :05분에 hourly 집계 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(minute=5, second=0, microsecond=0)
        if now >= target:
            target += timedelta(hours=1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("hourly", aggregation_processor.run_hourly_aggregation))


async def _daily_agg_scheduler() -> None:
    """WF7 대체 — 매일 07:30에 daily 롤업 트리거"""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(_seconds_until_next(7, 30))
        asyncio.create_task(_run_agg_task("daily", aggregation_processor.run_daily_aggregation))


async def _trend_agg_scheduler() -> None:
    """WF11 대체 — 4시간마다 trend 이상 알림 트리거"""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(4 * 3600)
        asyncio.create_task(_run_agg_task("trend", aggregation_processor.run_trend_alert))


async def _weekly_agg_scheduler() -> None:
    """WF8 대체 — 매주 월요일 08:00에 weekly 리포트 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(hour=8, minute=0, second=0, microsecond=0)
        days_until_monday = (0 - now.weekday()) % 7  # 0 = 월요일
        if days_until_monday == 0 and now >= target:
            days_until_monday = 7
        target += timedelta(days=days_until_monday)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("weekly", aggregation_processor.run_weekly_report))


async def _monthly_agg_scheduler() -> None:
    """WF9 대체 — 매월 1일 08:00에 monthly 리포트 트리거"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(day=1, hour=8, minute=0, second=0, microsecond=0)
        if now >= target:
            if target.month == 12:
                target = target.replace(year=target.year + 1, month=1)
            else:
                target = target.replace(month=target.month + 1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("monthly", aggregation_processor.run_monthly_report))


async def _longperiod_agg_scheduler() -> None:
    """WF10 대체 — 매월 1일 09:00에 longperiod 리포트 트리거 (함수 내부에서 분기/반기/연간 판단)"""
    await asyncio.sleep(30)
    while True:
        now = datetime.now(_KST)
        target = now.replace(day=1, hour=9, minute=0, second=0, microsecond=0)
        if now >= target:
            if target.month == 12:
                target = target.replace(year=target.year + 1, month=1)
            else:
                target = target.replace(month=target.month + 1)
        await asyncio.sleep((target - now).total_seconds())
        asyncio.create_task(_run_agg_task("longperiod", aggregation_processor.run_longperiod_report))


# ── V1 Knowledge 동기화 ───────────────────────────────────────────────────────

_JIRA_FIELDS = (
    "summary,description,status,comment,"
    "issuetype,priority,components,resolutiondate,project,"
    "customfield_18370,customfield_11011,customfield_17901,"
    "customfield_15315,customfield_15316,customfield_14403,"
    "customfield_11351,customfield_11718,customfield_11343,"
    "customfield_16460,customfield_16461,"
    "customfield_10451,customfield_10452,customfield_10453,"
    "customfield_10454,customfield_10455,customfield_10415,"
    "customfield_11374,customfield_11347,customfield_11368,"
    "customfield_11369,customfield_11370,customfield_11012,"
    "customfield_11311,customfield_11362,customfield_11363,"
    "customfield_11366"
)


def _issue_to_upsert_kwargs(issue: dict) -> dict:
    """Jira issue dict → upsert_jira_issue() kwargs. force sync 엔드포인트에서 재사용."""
    f = issue.get("fields", {})
    comments = [c.get("body", "") for c in f.get("comment", {}).get("comments", [])[:10] if c.get("body")]

    def _cv(key: str) -> str | None:
        v = f.get(key)
        if isinstance(v, dict):
            return v.get("value") or v.get("name") or None
        return str(v) if v is not None else None

    def _cl(key: str) -> list[str]:
        v = f.get(key)
        if not isinstance(v, list):
            return []
        return [
            (item.get("name") or item.get("value") or str(item))
            if isinstance(item, dict) else str(item)
            for item in v
        ]

    return dict(
        project=f.get("project", {}).get("key", ""),
        issue_id=issue["id"],
        issue_key=issue.get("key"),
        title=f.get("summary", ""),
        description=f.get("description") or "",
        status=f.get("status", {}).get("name", ""),
        comments=comments,
        issue_type=f.get("issuetype", {}).get("name"),
        priority=f.get("priority", {}).get("name"),
        components=[c["name"] for c in f.get("components", []) if c.get("name")],
        resolution_date=f.get("resolutiondate"),
        company=_cl("customfield_18370"),
        system_dept=_cl("customfield_11011"),
        service=_cl("customfield_17901"),
        fte_category=_cl("customfield_15315"),
        fte_type=_cl("customfield_15316"),
        difficulty=_cv("customfield_14403"),
        service_grade=_cl("customfield_11351"),
        request_type=_cl("customfield_11718"),
        change_process_type=_cl("customfield_16460"),
        sr_process_type=_cl("customfield_16461"),
        issue_type_am=_cl("customfield_11343"),
        incident_summary=_cv("customfield_10451"),
        action_taken=f.get("customfield_10452") or None,
        action_timeline=f.get("customfield_10453") or None,
        root_cause=f.get("customfield_10454") or None,
        solution=f.get("customfield_10455") or None,
        reception_channel=_cv("customfield_10415"),
        incident_cause_type=_cv("customfield_11374"),
        incident_type=_cl("customfield_11347"),
        impact_scope=_cv("customfield_11368"),
        grade=_cv("customfield_11369"),
        responsibility=_cv("customfield_11370"),
        business_system=_cl("customfield_11012"),
        incident_start_at=f.get("customfield_11311"),
        incident_noticed_at=f.get("customfield_11362"),
        incident_notified_at=f.get("customfield_11363"),
        duration_minutes=f.get("customfield_11366"),
    )


async def _jira_sync_run() -> dict:
    """Jira 증분 동기화 실행. 결과 요약 dict 반환."""
    if not (JIRA_URL and JIRA_TOKEN and JIRA_PROJECTS):
        logger.info("Jira 동기화 환경변수 미설정 (JIRA_URL/JIRA_TOKEN/JIRA_PROJECTS) — 건너뜀")
        return {"skipped": True, "reason": "env not configured"}

    projects = [p.strip() for p in JIRA_PROJECTS.split(",") if p.strip()]
    synced = 0
    errors = 0

    # admin-api에서 last_sync_at 조회
    last_sync_at: str | None = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/knowledge/sync-status",
                params={"source": "jira"},
            )
            if resp.status_code == 200:
                last_sync_at = resp.json().get("last_sync_at")
    except Exception as exc:
        logger.warning("Jira last_sync_at 조회 실패: %s → 전체 동기화 진행", exc)

    jql_date = f" AND updated >= \"{last_sync_at[:10]}\"" if last_sync_at else ""

    rate_sem = asyncio.Semaphore(1)
    interval = 1.0 / max(KNOWLEDGE_SYNC_RATE_LIMIT, 1)

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={
            "Authorization": f"Bearer {JIRA_TOKEN}",
            "Accept":        "application/json",
        },
    ) as jira_client:
        for project in projects:
            jql = f"project = {project}{jql_date} ORDER BY updated ASC"
            start_at = 0
            max_results = 50

            while True:
                try:
                    resp = await jira_client.get(
                        f"{JIRA_URL}/rest/api/2/search",
                        params={"jql": jql, "startAt": start_at, "maxResults": max_results,
                                "fields": _JIRA_FIELDS},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as exc:
                    logger.warning("Jira 이슈 조회 실패 [project=%s, start=%d]: %s", project, start_at, exc)
                    errors += 1
                    break

                issues = data.get("issues", [])
                if not issues:
                    break

                for issue in issues:
                    async with rate_sem:
                        try:
                            await knowledge_vector_client.upsert_jira_issue(
                                **_issue_to_upsert_kwargs(issue)
                            )
                            synced += 1
                        except Exception as exc:
                            logger.warning("Jira upsert 실패 [%s]: %s", issue.get("key"), exc)
                            errors += 1
                        await asyncio.sleep(interval)

                total = data.get("total", 0)
                start_at += len(issues)
                if start_at >= total:
                    break

    # admin-api에 sync-status 업데이트
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{ADMIN_API_URL}/api/v1/knowledge/sync-status",
                json={
                    "source":       "jira",
                    "last_sync_at": datetime.now(timezone.utc).isoformat(),
                    "synced_count": synced,
                },
            )
    except Exception as exc:
        logger.warning("Jira sync-status 업데이트 실패: %s", exc)

    logger.info("Jira 동기화 완료: synced=%d, errors=%d", synced, errors)
    return {"synced": synced, "errors": errors}


async def _jira_sync_scheduler() -> None:
    """매일 04:00 KST에 Jira 증분 동기화 실행."""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(_seconds_until_next(4, 0))
        try:
            await _jira_sync_run()
        except Exception as exc:
            logger.error("Jira 동기화 스케줄러 예외: %s", exc)


async def _confluence_sync_run() -> dict:
    """Confluence 증분 동기화 실행. 결과 요약 dict 반환."""
    if not (CONFLUENCE_URL and CONFLUENCE_TOKEN and CONFLUENCE_SPACES):
        logger.info("Confluence 환경변수 미설정 (CONFLUENCE_URL/CONFLUENCE_TOKEN/CONFLUENCE_SPACES) — 건너뜀")
        return {"skipped": True, "reason": "env not configured"}

    import chunking

    spaces = [s.strip() for s in CONFLUENCE_SPACES.split(",") if s.strip()]
    synced_pages = 0
    synced_chunks = 0
    errors = 0

    # admin-api에서 last_sync_at 조회
    last_sync_at: str | None = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/knowledge/sync-status",
                params={"source": "confluence"},
            )
            if resp.status_code == 200:
                last_sync_at = resp.json().get("last_sync_at")
    except Exception as exc:
        logger.warning("Confluence last_sync_at 조회 실패: %s → 전체 동기화 진행", exc)

    rate_sem = asyncio.Semaphore(1)
    interval = 1.0 / max(KNOWLEDGE_SYNC_RATE_LIMIT, 1)

    auth_header = f"Bearer {CONFLUENCE_TOKEN}"

    async with httpx.AsyncClient(
        timeout=30.0,
        headers={"Authorization": auth_header, "Accept": "application/json"},
    ) as conf_client:
        for space_key in spaces:
            start = 0
            limit_per_page = 25
            cql_date = f" AND lastModified >= \"{last_sync_at[:10]}\"" if last_sync_at else ""
            cql = f"space = {space_key} AND type = page{cql_date} ORDER BY lastModified ASC"

            while True:
                try:
                    resp = await conf_client.get(
                        f"{CONFLUENCE_URL}/rest/api/content/search",
                        params={
                            "cql":    cql,
                            "start":  start,
                            "limit":  limit_per_page,
                            "expand": "body.storage,space,version",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except Exception as exc:
                    logger.warning("Confluence 페이지 조회 실패 [space=%s, start=%d]: %s", space_key, start, exc)
                    errors += 1
                    break

                results = data.get("results", [])
                if not results:
                    break

                for page in results:
                    page_id = page["id"]
                    page_title = page.get("title", "")
                    html_content = page.get("body", {}).get("storage", {}).get("value", "") or ""
                    page_url = f"{CONFLUENCE_URL}/pages/{page_id}"

                    try:
                        chunks = chunking.chunk_confluence_page(
                            content=html_content,
                            page_id=page_id,
                            page_title=page_title,
                            space=space_key,
                        )
                    except Exception as exc:
                        logger.warning("Confluence 청킹 실패 [page_id=%s]: %s", page_id, exc)
                        errors += 1
                        continue

                    async with rate_sem:
                        try:
                            await knowledge_vector_client.delete_confluence_chunks_by_page_id(page_id)
                            n = await knowledge_vector_client.upsert_confluence_chunks(
                                page_id=page_id,
                                page_title=page_title,
                                space=space_key,
                                chunks=chunks,
                                url=page_url,
                            )
                            synced_pages += 1
                            synced_chunks += n
                        except Exception as exc:
                            logger.warning("Confluence upsert 실패 [page_id=%s]: %s", page_id, exc)
                            errors += 1
                        await asyncio.sleep(interval)

                start += len(results)
                if len(results) < limit_per_page:
                    break

    # admin-api에 sync-status 업데이트
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{ADMIN_API_URL}/api/v1/knowledge/sync-status",
                json={
                    "source":        "confluence",
                    "last_sync_at":  datetime.now(timezone.utc).isoformat(),
                    "synced_count":  synced_pages,
                    "synced_chunks": synced_chunks,
                },
            )
    except Exception as exc:
        logger.warning("Confluence sync-status 업데이트 실패: %s", exc)

    logger.info("Confluence 동기화 완료: pages=%d, chunks=%d, errors=%d", synced_pages, synced_chunks, errors)
    return {"synced_pages": synced_pages, "synced_chunks": synced_chunks, "errors": errors}


async def _confluence_sync_scheduler() -> None:
    """매일 04:30 KST에 Confluence 증분 동기화 실행."""
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(_seconds_until_next(4, 30))
        try:
            await _confluence_sync_run()
        except Exception as exc:
            logger.error("Confluence 동기화 스케줄러 예외: %s", exc)
