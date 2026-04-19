"""EMS (Polestar) executor — ems-mcp 로직을 admin-api 내부로 포팅.

자격증명은 `chat_executor_configs.executor='ems'`의 config에서 로드
(`base_url`, `username`, `password`). 미설정 시 사용자에게 친절한 에러 반환.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from services.chat_tools.executor_config import load_executor_config

_CLIENT: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = httpx.AsyncClient(timeout=30, verify=False)
    return _CLIENT


async def aclose_client() -> None:
    global _CLIENT
    if _CLIENT is not None:
        await _CLIENT.aclose()
        _CLIENT = None


# ── 한국어 날짜 파서 (ems-mcp 포팅) ──────────────────────────────────────
def parse_korean_date(s: str | None) -> int | None:
    if not isinstance(s, str) or not s.strip():
        return None
    s = s.strip()
    now = datetime.now()
    y, mo, d, h, mi, sec = now.year, None, None, 0, 0, 0

    m = re.match(r"^(\d{4})\D?(\d{1,2})\D?(\d{1,2})?", s)
    if m:
        y = int(m.group(1))
        mo = int(m.group(2))
        d = int(m.group(3)) if m.group(3) else 1
    else:
        m = re.search(r"(\d{1,2})월\s*(\d{1,2})?일?", s)
        if m:
            mo = int(m.group(1))
            d = int(m.group(2)) if m.group(2) else 1

    m = re.search(r"(\d{1,2})시", s)
    if m:
        h = int(m.group(1))
    m = re.search(r"(\d{1,2})분", s)
    if m:
        mi = int(m.group(1))
    m = re.search(r"(\d{1,2})초", s)
    if m:
        sec = int(m.group(1))
    m = re.search(r"(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?", s)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        sec = int(m.group(3)) if m.group(3) else 0

    if mo is None:
        return None
    try:
        return int(datetime(y, mo, d or 1, h, mi, sec).timestamp() * 1000)
    except Exception:
        return None


def end_of_month_ms(t: int) -> int:
    d = datetime.fromtimestamp(t / 1000)
    if d.month == 12:
        end = datetime(d.year + 1, 1, 1) - timedelta(milliseconds=1)
    else:
        end = datetime(d.year, d.month + 1, 1) - timedelta(milliseconds=1)
    return int(end.timestamp() * 1000)


def to_millis(v: Any, is_end: bool = False) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)) and v > 1e12:
        return int(v)
    parsed = parse_korean_date(str(v)) if isinstance(v, str) else None
    if parsed is None:
        return None
    return end_of_month_ms(parsed) if is_end else parsed


# ── EMS 세션 클라이언트 ─────────────────────────────────────────────────
class _EMSSession:
    """요청당 생성되는 경량 세션 (쿠키 유지)."""

    def __init__(self, base_url: str, username: str, password: str) -> None:
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.username = username
        self.password = password
        self.cookie = ""

    async def _raw(
        self,
        path: str,
        method: str = "GET",
        body: Any = None,
        content_type: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        h: dict[str, str] = {"Cookie": self.cookie} if self.cookie else {}
        if content_type:
            h["Content-Type"] = content_type
        if headers:
            h.update(headers)
        resp = await _client().request(method, url, content=body, headers=h)
        sc = resp.headers.get("set-cookie", "")
        if sc:
            cookie = sc.split(";")[0].split(",")[0]
            if cookie:
                self.cookie = cookie
        return resp

    async def _parse(self, resp: httpx.Response) -> dict[str, Any]:
        text = resp.text
        if not text:
            return {}
        try:
            return json.loads(text)
        except Exception:
            return {"raw": text}

    async def request(
        self,
        path: str,
        method: str = "GET",
        body: Any = None,
        content_type: str | None = None,
        retried: bool = False,
    ) -> dict[str, Any]:
        resp = await self._raw(path, method, body, content_type)
        if resp.status_code < 400:
            ct = resp.headers.get("content-type", "")
            if "text/html" in ct:
                if not retried and await self._try_auto_login():
                    return await self.request(path, method, body, content_type, True)
                raise RuntimeError(f"HTML 응답(로그인 필요): {resp.text[:200]}")
            return await self._parse(resp)
        status = resp.status_code
        if status in (401, 403, 302, 303) and not retried:
            if await self._try_auto_login():
                return await self.request(path, method, body, content_type, True)
        raise RuntimeError(f"HTTP {status} {resp.text[:200]}")

    async def _try_auto_login(self) -> bool:
        try:
            r = await self.login()
            return bool(r.get("success"))
        except Exception:
            return False

    async def login(self) -> dict[str, Any]:
        if not self.username or not self.password:
            raise RuntimeError("EMS username/password 미설정")
        body = urlencode({"id": self.username, "password": self.password})
        data = await self.request(
            "/rest/login",
            "POST",
            body=body,
            content_type="application/x-www-form-urlencoded",
        )
        result = (data.get("data", {}).get("result", {}) or {}) if isinstance(data, dict) else {}
        success = result.get("success") or data.get("success") or data.get("result")
        message = result.get("message") or data.get("message") or data.get("msg")
        return {"success": bool(success), "message": message}

    async def list_groups(self) -> list[dict[str, Any]]:
        r = await self.request("/rest/resource/group")
        rows = (
            r.get("configuration")
            or r.get("data", {}).get("list")
            or r.get("data")
            or r.get("list")
            or []
        )
        if not isinstance(rows, list):
            rows = [rows]
        return [
            {"id": g.get("id"), "name": g.get("name"), "resourceType": g.get("resourceType")}
            for g in rows
        ]

    async def resolve_team_group_ids(self, team_name: str) -> list[dict[str, Any]]:
        q = (team_name or "").strip()
        if not q:
            raise RuntimeError("teamname 필요")
        groups = await self.list_groups()
        lq = q.lower()

        def score(name: str | None) -> float:
            s = (name or "").lower()
            if s == lq:
                return 1.0
            if s.startswith(lq):
                return 0.9
            if re.search(r"(?:^|\b|_)" + re.escape(lq), s):
                return 0.85
            if lq in s:
                return 0.8
            return 0.0

        candidates = [
            {"id": g["id"], "name": g["name"], "score": score(g["name"])} for g in groups
        ]
        candidates = [c for c in candidates if c["score"] > 0]
        exact = [c for c in candidates if c["score"] >= 1.0]
        if exact:
            return sorted(exact, key=lambda x: x["name"])
        return sorted(candidates, key=lambda x: (-x["score"], x["name"]))[:10]

    async def list_servers_by_group_id(self, group_id: str) -> list[dict[str, Any]]:
        r = await self.request(f"/rest/resource/{group_id}/children")
        rows = (
            r.get("configuration")
            or r.get("data", {}).get("list")
            or r.get("data")
            or r.get("list")
            or []
        )
        if not isinstance(rows, list):
            rows = [rows]
        arr = [
            it
            for it in rows
            if not it.get("resourceType") or "server.Server" in str(it.get("resourceType", ""))
        ]
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "ip": it.get("ipAddress") or it.get("ipaddress"),
                "resourceType": it.get("resourceType"),
            }
            for it in arr
        ]

    async def find_server_by_ip(self, ip: str) -> list[dict[str, Any]]:
        r = await self.request(f"/rest/resource/list/search?ip={quote(ip)}")
        rows = r.get("data", {}).get("list") or r.get("data") or []
        if not isinstance(rows, list):
            rows = [rows]
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "ip": it.get("ipAddress") or it.get("ipaddress"),
                "resourceType": it.get("resourceType"),
            }
            for it in rows
        ]

    async def get_server_detail(self, resource_id: str) -> dict[str, Any]:
        basic = await self.request(f"/rest/resource/{resource_id}")
        detail = await self.request(
            f"/rest/report/resource/list?resourceId={resource_id}&resourceType=server.Server",
            method="POST",
        )
        conf = basic.get("configuration") or {}
        rep_list = detail.get("configuration") or detail.get("data", {}).get("configuration") or []
        rep = rep_list[0] if isinstance(rep_list, list) and rep_list else {}
        return {
            "id": conf.get("id") or rep.get("id") or resource_id,
            "name": conf.get("name") or rep.get("name"),
            "ip": conf.get("ipAddress") or rep.get("ipaddress"),
            "osType": rep.get("osType"),
            "lastUpTime": rep.get("upTime"),
            "availability": conf.get("availability") or rep.get("availability"),
            "resourceType": conf.get("resourceType") or rep.get("resourceType"),
        }

    async def _resolve_core_defs(self) -> tuple[str, str, str]:
        r = await self.request("/rest/measure/definitionName/server.Server")
        arr = r.get("data") or r.get("list") or []
        if not isinstance(arr, list):
            arr = [arr]
        defs = [
            d.get("definitionName") if isinstance(d, dict) else d
            for d in arr
            if (isinstance(d, dict) and d.get("definitionName")) or isinstance(d, str)
        ]

        def pick(patterns: list[str], fallback: str) -> str:
            for p in patterns:
                found = [d for d in defs if re.search(p, str(d), re.I)]
                if found:
                    return found[0]
            return fallback

        cpu = pick([r"cpu.*util", r"kernel.*util", r"user.*util", r"utilization"], "utilization")
        mem = pick([r"new.*used.*rate", r"memory.*usage.*used", r"memory.*util"], "MemoryUsedRate")
        fs = pick([r"file.*system.*used.*rate|util|usage", r"disk.*used"], "FileSystemUsedRate")
        return cpu, mem, fs

    async def get_summary_usage(
        self,
        resource_id: str,
        time_selector: str | None = None,
        from_time: int | None = None,
        to_time: int | None = None,
    ) -> dict[str, Any]:
        sel = (time_selector or "day").strip()
        cpu_def, mem_def, fs_def = await self._resolve_core_defs()
        target_defs = ",".join([d for d in [cpu_def, mem_def, fs_def] if d])
        url = f"/rest/report/measure/summary?resourceId={resource_id}&targetDefinitions={quote(target_defs)}&timeSelector={sel}"
        has_period = from_time is not None and to_time is not None
        if has_period:
            url += f"&searchType=CUSTOM&fromTime={from_time}&toTime={to_time}"
        r = await self.request(url)

        if isinstance(r.get("measurement"), list) and r.get("measurement"):
            m = r["measurement"][0] if isinstance(r["measurement"][0], dict) else {}

            def make_triple(avg_k: str, min_k: str, max_k: str) -> dict[str, Any] | None:
                avg, mn, mx = m.get(avg_k), m.get(min_k), m.get(max_k)
                if avg is None and mn is None and mx is None:
                    return None
                return {"avg": avg, "min": mn, "max": mx}

            cpu = make_triple("cpu_avg", "cpu_min", "cpu_max")
            memory = make_triple("mem_avg", "mem_min", "mem_max")
            filesystem = make_triple("fs_avg", "fs_min", "fs_max")
        else:
            rows = r.get("data") or r.get("summary") or r.get("measurement") or r.get("list") or []
            if not isinstance(rows, list):
                rows = []

            def normalize(item: dict[str, Any]) -> dict[str, Any]:
                return {
                    "definition": item.get("definitionName") or item.get("definition"),
                    "min": item.get("min"),
                    "max": item.get("max"),
                    "avg": item.get("avg") or item.get("avgValue"),
                }

            items = [normalize(it) for it in rows if isinstance(it, dict)]

            def pick_def(pattern: str) -> dict[str, Any] | None:
                for it in items:
                    if it["definition"] and re.search(pattern, str(it["definition"]), re.I):
                        return it
                return None

            cpu = pick_def(r"cpu|util")
            memory = pick_def(r"mem")
            filesystem = pick_def(r"file.*system|disk")

        base: dict[str, Any] = {"cpu": cpu, "memory": memory, "filesystem": filesystem, "timeSelector": sel}
        if has_period:
            base["period"] = {"fromTime": from_time, "toTime": to_time}
        return base

    async def get_alarm_report(
        self,
        resource_ids: list[str],
        search_type: str,
        alarm_levels: list[str],
        from_time: int | None = None,
        to_time: int | None = None,
    ) -> list[dict[str, Any]]:
        qs = urlencode(
            {
                "resourceId": ",".join(str(x) for x in resource_ids),
                "searchType": search_type,
                "alarmLevel": ",".join(str(x) for x in alarm_levels),
            }
        )
        if search_type == "CUSTOM":
            if from_time is None or to_time is None:
                raise RuntimeError("CUSTOM은 fromTime/toTime 필수")
            qs += f"&fromTime={from_time}&toTime={to_time}"
        r = await self.request(f"/rest/report/alarm/list?{qs}", method="POST")
        rows = r.get("data") or r.get("list") or []
        if not isinstance(rows, list):
            rows = [rows]
        return rows

    async def get_top_processes(
        self,
        resource_id: str,
        top_n: int = 10,
        sort_key: str = "pcpu",
    ) -> list[dict[str, Any]]:
        url = f"/rest/server/process/top?resourceId={resource_id}&topN={top_n}&sortKey={sort_key}"
        r = await self.request(url)
        rows = r.get("data") or r.get("list") or []
        if not isinstance(rows, list):
            rows = [rows]
        return rows


async def _session(db: AsyncSession) -> _EMSSession:
    config = await load_executor_config(db, "ems")
    base_url = config.get("base_url") or ""
    username = config.get("username") or ""
    password = config.get("password") or ""
    if not (base_url and username and password):
        raise _CredentialError(
            "EMS 자격증명이 구성되지 않았습니다. /admin/chat-tools에서 base_url, username, password를 설정하세요."
        )
    return _EMSSession(base_url, username, password)


class _CredentialError(RuntimeError):
    pass


async def _resolve_id(session: _EMSSession, args: dict[str, Any]) -> int:
    rid = args.get("resourceId")
    if rid:
        return int(rid)
    ip = args.get("ip")
    if ip:
        found = await session.find_server_by_ip(str(ip).strip())
        if not found:
            raise RuntimeError(f"IP '{ip}'에 해당하는 서버가 없습니다.")
        return int(found[0]["id"])
    raise RuntimeError("resourceId 또는 ip를 입력하세요.")


# ── Tool handlers ──────────────────────────────────────────────────────
async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        session = await _session(db)
    except _CredentialError as e:
        return {"error": str(e)}

    try:
        if name == "ems_login":
            return await session.login()
        if name == "ems_get_team_group_id":
            return {"candidates": await session.resolve_team_group_ids(args.get("teamname", ""))}
        if name == "ems_list_servers_by_team":
            group_ids = list(args.get("groupIds") or [])
            teamnames = list(args.get("teamnames") or [])
            for tn in teamnames:
                cands = await session.resolve_team_group_ids(tn)
                group_ids.extend([c["id"] for c in cands])
            if not group_ids:
                return {"error": "teamnames 또는 groupIds 필요"}
            result: list[dict[str, Any]] = []
            for gid in group_ids:
                result.extend(await session.list_servers_by_group_id(str(gid)))
            return {"servers": result}
        if name == "ems_find_server_by_ip":
            return {"servers": await session.find_server_by_ip(str(args["ip"]))}
        if name == "ems_get_server_detail":
            rid = await _resolve_id(session, args)
            return await session.get_server_detail(str(rid))
        if name == "ems_get_summary_usage":
            rid = await _resolve_id(session, args)
            return await session.get_summary_usage(str(rid), args.get("timeSelector"))
        if name == "ems_get_period_usage":
            rid = await _resolve_id(session, args)
            from_ms = to_millis(args.get("fromTime"), False)
            to_ms = to_millis(args.get("toTime"), True)
            if not (from_ms and to_ms):
                return {"error": "fromTime/toTime 파싱 실패"}
            return await session.get_summary_usage(
                str(rid), time_selector="CUSTOM", from_time=from_ms, to_time=to_ms
            )
        if name == "ems_get_alarm_report":
            # resourceId 단건/다건 지원
            rids: list[str]
            if args.get("resourceIds"):
                rids = [str(x) for x in args["resourceIds"]]
            elif args.get("resourceId") or args.get("ip"):
                rid = await _resolve_id(session, args)
                rids = [str(rid)]
            else:
                return {"error": "resourceId/resourceIds/ip 중 하나 필요"}
            levels = args.get("alarmLevels") or ([args["alarmLevel"]] if args.get("alarmLevel") else [])
            if not levels:
                return {"error": "alarmLevel 필요"}
            search_type = args.get("searchType") or "RECENT"
            return {
                "alarms": await session.get_alarm_report(
                    rids,
                    search_type,
                    levels,
                    to_millis(args.get("fromTime"), False),
                    to_millis(args.get("toTime"), True),
                )
            }
        if name == "ems_get_top_processes":
            rid = await _resolve_id(session, args)
            sort_by = args.get("sortBy", "cpu")
            sort_key = "pcpu" if sort_by == "cpu" else "pmem"
            return {
                "processes": await session.get_top_processes(
                    str(rid), top_n=int(args.get("topN", 5)), sort_key=sort_key
                )
            }
        return {"error": f"unknown EMS tool: {name}"}
    except _CredentialError as e:
        return {"error": str(e)}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if any(code in msg for code in ("401", "403", "로그인")):
            return {"error": f"EMS 인증 실패: 자격증명을 확인하세요. ({msg[:120]})"}
        return {"error": f"EMS 호출 실패: {msg[:200]}"}
