#!/usr/bin/env bash
# Agent-T Docker E2E 하니스.
#   run.sh up            스택 기동 (PG·Prometheus·ClickHouse·gateway·Tomcat 3종 + 호스트 admin-api·frontend) + 시드
#   run.sh test [N...]   시나리오 실행 (기본 1~8). 예: run.sh test 2 3
#   run.sh down          전부 중지·삭제 (볼륨 포함)
# 시나리오 9(브라우저)는 별도 qa 에이전트 담당. 환경변수: E2E_LOAD_DURATION(기본 10m), E2E_SKIP_BUILD=1
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="$HERE/.work"
BIN="$HERE/.bin"
RUN_ID="${E2E_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RES="$HERE/results/$RUN_ID"
DC=(docker compose -f "$HERE/docker-compose.e2e.yml")
PY="${E2E_PY:-/Users/company/workspaces/aoms/venv/bin/python}"
SECRET="e2e-dev-secret-key-not-for-prod"
ADMIN_EMAIL="e2e-admin@example.test"
ADMIN_PW="e2e-admin-1234"
LOAD_DURATION="${E2E_LOAD_DURATION:-10m}"
T7=http://localhost:18081 T9=http://localhost:18082 TB=http://localhost:18083
CH_URL="http://localhost:18123/?user=agent_t&password=agent_t_dev&database=agent_t"
API=http://localhost:8080 GW=http://localhost:8330

mkdir -p "$WORK/agent7" "$WORK/agent9" "$RES"; ln -sfn "$RUN_ID" "$HERE/results/latest"
FAILS=0

ch() { curl -s --fail-with-body "$CH_URL" --data-binary "$1"; }
ch_now() { ch "SELECT toString(now64(3))"; }
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }
metric() { echo "$1=$2" >> "$RES/metrics.env"; log "  metric $1=$2"; }
result() { # n name PASS|FAIL detail
  local line; line="S$1 $3 - $2: $4"
  echo "$line" | tee -a "$RES/summary.txt"
  [ "$3" = PASS ] || FAILS=$((FAILS+1))
}
cmp_le() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a<=b)}'; }

login() {
  TOKEN=$(curl -s -X POST $API/api/v1/auth/login -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
}

sys_ids() { # shellcheck disable=SC1091
  source "$WORK/system-ids.env"; }

# hey 요약에서 값 추출: hey_stat <file> <p95|p50|p99|ok|total|rps>
hey_stat() {
  case "$2" in
    p95) awk '/95%+ in/{print $3*1000}' "$1";;
    p99) awk '/99%+ in/{print $3*1000}' "$1";;
    p50) awk '/50%+ in/{print $3*1000}' "$1";;
    rps) awk '/Requests\/sec/{print $2}' "$1";;
    ok)  awk '/^[ \t]*\[200\]/{n=$2} END{print n+0}' "$1";;
    total) awk '/^[ \t]*\[[0-9]+\]/{s+=$2} END{print s+0}' "$1";;
  esac
}

attach_both() {
  local rc=0
  docker exec e2e-tomcat7 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t-legacy.jar >"$RES/attach7.log" 2>&1 || rc=$?
  ATTACH7_RC=$rc; rc=0
  docker exec e2e-tomcat9 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t.jar >"$RES/attach9.log" 2>&1 || rc=$?
  ATTACH9_RC=$rc
}

wait_http() { # url tries
  for _ in $(seq 1 "${2:-60}"); do curl -s -o /dev/null -m 3 "$1" && return 0; sleep 2; done; return 1
}

last_seen_ms() { # system_id -> last_seen of its instance (ms) or 0
  curl -s "$GW/t/v1/snapshot?system_ids=$1" -H "Authorization: Bearer $TOKEN" |
    "$PY" -c 'import sys,json
d=json.load(sys.stdin); i=d.get("instances") or []
print(max([x.get("last_seen",0) for x in i] or [0]))'
}

# ───────────────────────── up / down ─────────────────────────
cmd_up() {
  log "jar 준비"
  [ -f "$REPO/agent-t/build/dist/agent-t.jar" ] || (cd "$REPO/agent-t" && ./build.sh fetch && ./build.sh jar)
  cp "$REPO/agent-t/build/dist/agent-t-legacy.jar" "$REPO/agent-t/build/dist/agent-t-attacher.jar" "$WORK/agent7/"
  cp "$REPO/agent-t/build/dist/agent-t.jar" "$REPO/agent-t/build/dist/agent-t-attacher.jar" "$WORK/agent9/"
  rm -f "$WORK/agent7/DISABLE" "$WORK/agent9/DISABLE"
  [ -x "$BIN/e2e-hey" ] || GOBIN="$BIN" go install github.com/rakyll/hey@latest
  (cd "$REPO/agent-t-gateway" && go build -o "$BIN/agentsim" ./cmd/agentsim)
  log "docker 스택 기동"
  if [ "${E2E_SKIP_BUILD:-}" = 1 ]; then "${DC[@]}" up -d; else "${DC[@]}" up -d --build; fi
  "${DC[@]}" up -d --wait postgres clickhouse >/dev/null
  log "시드 (시스템 3·agent_instances·테스트 admin)"
  "$PY" "$HERE/seed.py" "$WORK" 50
  start_admin_api
  start_frontend
  wait_http $API/health 30 || { echo "admin-api 기동 실패 ($WORK/admin-api.log)"; exit 1; }
  login
  log "스택 준비 완료. frontend http://localhost:3001  로그인 $ADMIN_EMAIL / $ADMIN_PW (dev 전용)"
}

port_pid() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
# 이 하니스가 시작한 프로세스(pid 파일)만 재사용·종료한다. 포트를 모르는 프로세스가 점유 중이면 큰 소리로 실패.
claim_port() { # name port
  local lp pf="$WORK/$1.pid"; lp=$(port_pid "$2")
  [ -z "$lp" ] && return 0
  if [ -f "$pf" ]; then   # 리스너가 pid 파일의 프로세스이거나 그 자손이면 우리가 시작한 것 → 재사용
    local cur="$lp" want; want=$(cat "$pf")
    while [ -n "$cur" ] && [ "$cur" != 1 ] && [ "$cur" != 0 ]; do
      [ "$cur" = "$want" ] && return 10
      cur=$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')
    done
  fi
  echo "ERROR: 포트 $2 를 하니스가 시작하지 않은 프로세스(pid $lp)가 점유 중입니다. 종료 후 다시 실행하세요." >&2
  exit 1
}

start_admin_api() {
  claim_port admin-api 8080; [ $? -eq 10 ] && return
  (cd "$REPO/main-server/services/admin-api"
   export DATABASE_URL=postgresql+asyncpg://synapse:synapse@localhost:15432/synapse SECRET_KEY="$SECRET"
   export CLICKHOUSE_URL=http://localhost:18123 CLICKHOUSE_USER=agent_t CLICKHOUSE_PASSWORD=agent_t_dev CLICKHOUSE_DB=agent_t \
     AGENT_T_GATEWAY_INTERNAL_URL=$GW AGENT_T_GATEWAY_URL=http://agent-t-gateway:8330 PROMETHEUS_URL=http://localhost:19090
   nohup "$PY" -m uvicorn main:app --host 0.0.0.0 --port 8080 >"$WORK/admin-api.log" 2>&1 </dev/null &
   echo $! > "$WORK/admin-api.pid")
}

start_frontend() {
  claim_port frontend 3001; [ $? -eq 10 ] && return
  local fe="$REPO/main-server/services/frontend"
  [ -d "$fe/node_modules" ] || (cd "$fe" && npm ci --no-audit --no-fund >"$WORK/npm-ci.log" 2>&1)
  (cd "$fe"; nohup npm run dev >"$WORK/frontend.log" 2>&1 </dev/null &
   echo $! > "$WORK/frontend.pid")
}

kill_tree() { # pid — 자식까지 종료
  local c; for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done; kill "$1" 2>/dev/null || true
}

cmd_down() {
  local n pid
  for n in admin-api frontend; do
    if [ -f "$WORK/$n.pid" ]; then
      pid=$(cat "$WORK/$n.pid"); kill_tree "$pid"; rm -f "$WORK/$n.pid"
    fi
  done
  for pt in 8080 3001; do
    pid=$(port_pid $pt); [ -n "$pid" ] && echo "WARN: 포트 $pt 는 하니스 소유가 아닌 프로세스(pid $pid)가 점유 중 — 종료하지 않음" >&2
  done
  "${DC[@]}" down -v
  rm -rf "$WORK"/agent7/logs "$WORK"/agent9/logs
}

# ───────────────────────── 시나리오 ─────────────────────────
# 1. 에이전트 없이 기동 → 트래픽 30초 → attach → 5초 내 snapshot 에 두 인스턴스
s1() {
  sys_ids; login
  log "S1: Tomcat 재기동(에이전트 없이)"
  rm -f "$WORK/agent7/DISABLE" "$WORK/agent9/DISABLE"; rm -rf "$WORK"/agent7/logs "$WORK"/agent9/logs
  "${DC[@]}" restart tomcat7 tomcat9 >/dev/null 2>&1
  wait_http $T7/ok 60 && wait_http $T9/ok 60 || { result 1 "attach" FAIL "Tomcat 기동 실패"; return; }
  log "S1: 트래픽 (에이전트 없음) 30초 후 attach, 트래픽은 attach 이후에도 유지"
  "$BIN/e2e-hey" -z 60s -q 10 -c 2 $T7/ok >"$RES/s1-hey7.txt" 2>&1 &
  "$BIN/e2e-hey" -z 60s -q 10 -c 2 $T9/ok >"$RES/s1-hey9.txt" 2>&1 &
  sleep 12
  "$BIN/e2e-hey" -n 5 -c 1 $T7/ext >/dev/null 2>&1   # attach 전에 로딩된 서블릿에도 /ext 호출
  "$BIN/e2e-hey" -n 10 -c 1 $T7/db >/dev/null 2>&1   # JDK7 JDBC 클래스를 attach 전에 로딩 → attach 시 retransform 대상
  "$BIN/e2e-hey" -n 10 -c 1 $T9/db >/dev/null 2>&1
  sleep 18
  local t0 t1; t0=$("$PY" -c 'import time;print(int(time.time()*1000))')
  attach_both
  t1=$("$PY" -c 'import time;print(int(time.time()*1000))')
  log "S1: attach rc 7=$ATTACH7_RC 9=$ATTACH9_RC ($((t1-t0))ms)"
  # attach 완료 시점부터 두 인스턴스가 last_seen > attach 시작 시각 으로 보일 때까지
  local ok=0 waited=0 seen1=0 seen2=0
  local start; start=$("$PY" -c 'import time;print(time.time())')
  for _ in $(seq 1 40); do
    seen1=$(last_seen_ms "$ID_E2E_SYS_A"); seen2=$(last_seen_ms "$ID_E2E_SYS_B")
    if [ "$seen1" -gt "$t0" ] && [ "$seen2" -gt "$t0" ]; then ok=1; break; fi
    sleep 0.5
  done
  waited=$("$PY" -c "import time;print(round(time.time()-$start,1))")
  wait   # hey 종료 (attach 중에도 서비스 정상이어야 함)
  local bad7 bad9; bad7=$(( $(hey_stat "$RES/s1-hey7.txt" total) - $(hey_stat "$RES/s1-hey7.txt" ok) ))
  bad9=$(( $(hey_stat "$RES/s1-hey9.txt" total) - $(hey_stat "$RES/s1-hey9.txt" ok) ))
  metric S1_attach_ms "$((t1-t0))"; metric S1_snapshot_wait_s_after_attach "$waited"
  if [ $ATTACH7_RC -eq 0 ] && [ $ATTACH9_RC -eq 0 ] && [ $ok -eq 1 ] && cmp_le "$waited" 5 && [ $bad7 -eq 0 ] && [ $bad9 -eq 0 ]; then
    result 1 "attach 후 5초 내 snapshot 등장" PASS "attach ${waited}s, 비정상 응답 7=$bad7 9=$bad9"
  else
    result 1 "attach 후 5초 내 snapshot 등장" FAIL "rc7=$ATTACH7_RC rc9=$ATTACH9_RC seen=$ok wait=${waited}s bad7=$bad7 bad9=$bad9 (attach7.log: $(tr '\n' ' ' <"$RES/attach7.log"|head -c 200))"
  fi
}

# 2. /ext(JDK7) → /db(JDK17): trace 2행, path 길이 2
s2() {
  sys_ids; login
  local t0; t0=$(ch_now)
  "$BIN/e2e-hey" -n 20 -c 2 $T7/ext >"$RES/s2-hey.txt" 2>&1
  sleep 6
  local trace span
  trace=$(ch "SELECT trace_id FROM tx_summary WHERE start_ts >= toDateTime64('$t0',3,'UTC') GROUP BY trace_id HAVING uniqExact(system_id)=2 LIMIT 1 FORMAT TSV")
  if [ -z "$trace" ]; then result 2 "분산 trace" FAIL "2개 system 에 걸친 trace_id 없음 (tx_summary)"; return; fi
  local rows; rows=$(ch "SELECT count() FROM tx_summary WHERE trace_id='$trace'")
  span=$(ch "SELECT span_id FROM tx_summary WHERE trace_id='$trace' AND system_id=$ID_E2E_SYS_A LIMIT 1 FORMAT TSV")
  local plen
  plen=$(curl -s "$API/api/v1/apm/transactions/$trace/$span" -H "Authorization: Bearer $TOKEN" | "$PY" -c 'import sys,json
d=json.load(sys.stdin); print(len(d.get("path",[])), len({p["system_id"] for p in d.get("path",[])}))')
  local ntrace; ntrace=$(ch "SELECT count() FROM (SELECT trace_id FROM tx_summary WHERE start_ts >= toDateTime64('$t0',3,'UTC') GROUP BY trace_id HAVING uniqExact(system_id)=2)")
  if [ "$rows" = 2 ] && [ "$plen" = "2 2" ]; then
    result 2 "JDK7→JDK17 trace 연결" PASS "trace=$trace rows=$rows path/systems=$plen 연결된 trace $ntrace/20"
  else
    result 2 "JDK7→JDK17 trace 연결" FAIL "trace=$trace rows=$rows path/systems=$plen"
  fi
}

# 3. /slow=상세+gap, /ok 대부분 상세 없음, /error=상세
s3() {
  sys_ids; login
  local t0; t0=$(ch_now)
  "$BIN/e2e-hey" -n 300 -c 5 $T9/ok >/dev/null 2>&1
  "$BIN/e2e-hey" -n 3 -c 1 $T9/slow >/dev/null 2>&1
  "$BIN/e2e-hey" -n 3 -c 1 $T7/slow >/dev/null 2>&1
  "$BIN/e2e-hey" -n 5 -c 1 $T9/error >/dev/null 2>&1
  "$BIN/e2e-hey" -n 3 -c 1 $T7/error >/dev/null 2>&1
  "$BIN/e2e-hey" -n 20 -c 2 $T7/db >"$RES/s3-db7.txt" 2>&1
  "$BIN/e2e-hey" -n 20 -c 2 $T9/db >"$RES/s3-db9.txt" 2>&1
  sleep 8
  local dbA dbB sqlrows   # /db: 호출 수, sql_cnt>=3 건수, conn_open>=1 건수 (시스템별)
  for sid in $ID_E2E_SYS_A $ID_E2E_SYS_B; do
    local r; r=$(ch "SELECT count(), countIf(sql_cnt>=3), countIf(conn_open>=1 AND conn_close>=1 AND conn_leak=0) FROM tx_summary s JOIN (SELECT id FROM dict_uri WHERE text='/db') d ON d.id=s.uri_id WHERE system_id=$sid AND start_ts >= toDateTime64('$t0',3,'UTC') FORMAT TSV")
    [ "$sid" = "$ID_E2E_SYS_A" ] && dbA="$r" || dbB="$r"
  done
  sqlrows=$(ch "SELECT count() FROM tx_sql WHERE system_id IN ($ID_E2E_SYS_A,$ID_E2E_SYS_B) AND start_ts >= toDateTime64('$t0',3,'UTC') FORMAT TSV" 2>/dev/null || echo ERR)
  local tbl; tbl=$(ch "SELECT d.text, system_id, count(), countIf(has_detail), countIf(error) FROM tx_summary s JOIN (SELECT id, argMax(text,last_seen) text FROM dict_uri GROUP BY id) d ON d.id=s.uri_id WHERE s.start_ts >= toDateTime64('$t0',3,'UTC') GROUP BY d.text, system_id ORDER BY d.text, system_id FORMAT TSV")
  echo "$tbl" > "$RES/s3-table.tsv"
  local ok_n ok_d slow_n slow_d err_n err_d
  read -r ok_n ok_d <<<"$(echo "$tbl" | awk -F'\t' '$1=="/ok"&&$2=='"$ID_E2E_SYS_B"'{print $3,$4}')"
  read -r slow_n slow_d <<<"$(echo "$tbl" | awk -F'\t' '$1=="/slow"{n+=$3;d+=$4}END{print n+0,d+0}')"
  read -r err_n err_d <<<"$(echo "$tbl" | awk -F'\t' '$1=="/error"{n+=$3;d+=$4}END{print n+0,d+0}')"
  # 호출 트리 gap: /slow 상세의 루트 노드 소요시간 - 자식 합 > 1000ms
  local sl; sl=$(ch "SELECT trace_id, span_id FROM tx_summary s JOIN (SELECT id FROM dict_uri WHERE text='/slow') d ON d.id=s.uri_id WHERE has_detail=1 AND start_ts >= toDateTime64('$t0',3,'UTC') AND system_id=$ID_E2E_SYS_B LIMIT 1 FORMAT TSV")
  local gap="none"
  if [ -n "$sl" ]; then
    gap=$(curl -s "$API/api/v1/apm/transactions/$(echo "$sl" | cut -f1)/$(echo "$sl" | cut -f2)" -H "Authorization: Bearer $TOKEN" | "$PY" -c 'import sys,json
d=json.load(sys.stdin); det=d.get("detail") or {}
n=det.get("nodes") or []
if isinstance(n,str): n=json.loads(n)
root=[x for x in n if x["p"]==-1]
if not root: print("noroot"); sys.exit()
r=root[0]; ch=sum(x["d"] for x in n if x["p"]==r["i"])
print(r["d"]-ch)')
  fi
  metric S3_ok_total "${ok_n:-0}"; metric S3_ok_with_detail "${ok_d:-0}"; metric S3_slow_gap_ms "$gap"
  local pass=1 why=""
  [ "${slow_n:-0}" -ge 1 ] && [ "$slow_d" -eq "$slow_n" ] || { pass=0; why+="slow detail $slow_d/$slow_n; "; }
  [ "${err_n:-0}" -ge 1 ] && [ "$err_d" -eq "$err_n" ] || { pass=0; why+="error detail $err_d/$err_n; "; }
  [ "${ok_n:-0}" -ge 100 ] && awk -v d="${ok_d:-0}" -v n="${ok_n:-1}" 'BEGIN{exit !(d/n<=0.05)}' || { pass=0; why+="ok detail ${ok_d:-?}/${ok_n:-?} (기대 ≤5%); "; }
  case "$gap" in none|noroot|"") pass=0; why+="gap 측정 불가($gap); ";; *) [ "${gap%.*}" -ge 1000 ] || { pass=0; why+="gap ${gap}ms (<1000); "; };; esac
  local a_n a_s a_c b_n b_s b_c; read -r a_n a_s a_c <<<"$dbA"; read -r b_n b_s b_c <<<"$dbB"
  metric S3_db_jdk7 "n=$a_n sql3=$a_s conn_ok=$a_c"; metric S3_db_jdk17 "n=$b_n sql3=$b_s conn_ok=$b_c"; metric S3_tx_sql_rows_db "$sqlrows"
  [ "${a_n:-0}" -ge 20 ] && [ "$a_s" -eq "$a_n" ] || { pass=0; why+="JDK7 /db 캡처 n=$a_n sql>=3:$a_s conn:$a_c; "; }
  [ "${b_n:-0}" -ge 20 ] && [ "$b_s" -eq "$b_n" ] || { pass=0; why+="JDK17 /db 캡처 n=$b_n sql>=3:$b_s conn:$b_c; "; }
  case "$sqlrows" in ERR|""|0) pass=0; why+="tx_sql 행 없음; ";; esac
  if [ "${a_c:-0}" -gt 0 ] && [ "${b_c:-0}" -gt 0 ]; then result 3 "커넥션 open/close 추적" PASS "JDK7 $a_c/$a_n, JDK17 $b_c/$b_n"
  else result 3 "커넥션 open/close 추적" FAIL "DataSource.getConnection(PGSimpleDataSource) 경유 /db 에서 conn_open/close>0 건수 JDK7 ${a_c:-0}/$a_n, JDK17 ${b_c:-0}/$b_n (Defects found D-H1-1)"; fi
  [ $pass -eq 1 ] && result 3 "상세 보존 규칙" PASS "JDK7 /db ${a_n}건 SQL 3건 이상 ${a_s}/${a_n}, JDK17 /db ${b_n}건; ok detail ${ok_d}/${ok_n}, slow ${slow_d}/${slow_n}, error ${err_d}/${err_n}, slow gap ${gap}ms" \
                  || result 3 "상세 보존 규칙" FAIL "$why (ok ${ok_d:-?}/${ok_n:-?} slow ${slow_d:-?}/${slow_n:-?} err ${err_d:-?}/${err_n:-?})"
}

# 4. 전량 수집: hey 성공 건수 == tx_summary 건수 (±0.5%)
s4() {
  sys_ids
  sleep 3
  local t0 t1; t0=$(ch_now)
  "$BIN/e2e-hey" -z 60s -q 50 -c 20 $T9/ok >"$RES/s4-hey.txt" 2>&1
  t1=$(ch "SELECT toString(now64(3))")
  sleep 15
  local hey_ok rows
  hey_ok=$(hey_stat "$RES/s4-hey.txt" ok)
  rows=$(ch "SELECT count() FROM tx_summary s JOIN (SELECT id FROM dict_uri WHERE text='/ok') d ON d.id=s.uri_id WHERE system_id=$ID_E2E_SYS_B AND start_ts >= toDateTime64('$t0',3,'UTC') AND start_ts <= toDateTime64('$t1',3,'UTC')")
  local diff pct
  diff=$((rows-hey_ok)); pct=$(awk -v d="$diff" -v n="$hey_ok" 'BEGIN{printf "%.3f", (d<0?-d:d)*100/n}')
  # 파이프라인은 at-least-once — 같은 span 이 두 번 적재되면 count() - uniqExact(span_id) > 0
  local dup
  dup=$(ch "SELECT count() - uniqExact(span_id) FROM tx_summary s JOIN (SELECT id FROM dict_uri WHERE text='/ok') d ON d.id=s.uri_id WHERE system_id=$ID_E2E_SYS_B AND start_ts >= toDateTime64('$t0',3,'UTC') AND start_ts <= toDateTime64('$t1',3,'UTC')")
  metric S4_hey_ok "$hey_ok"; metric S4_tx_summary_rows "$rows"; metric S4_diff_pct "$pct"; metric S4_rps "$(hey_stat "$RES/s4-hey.txt" rps)"; metric S4_dup_span_rows "$dup"
  if [ "${dup:-1}" -gt 0 ]; then result 4 "전량 수집" FAIL "중복 적재 span ${dup:-?}행 (count()-uniqExact(span_id) > 0; hey=$hey_ok tx_summary=$rows 차이 ${pct}%)"
  elif cmp_le "$pct" 0.5; then result 4 "전량 수집" PASS "hey=$hey_ok tx_summary=$rows 차이 ${pct}% 중복 span 0"
  else result 4 "전량 수집" FAIL "hey=$hey_ok tx_summary=$rows 차이 ${pct}% (>0.5%)"; fi
}

heap_after_gc() { # container -> used bytes after GC.run (JDK17)
  docker exec "$1" jcmd 1 GC.run >/dev/null 2>&1
  docker exec "$1" jcmd 1 GC.heap_info 2>/dev/null | awk '/used/{gsub("K","",$0); for(i=1;i<=NF;i++) if($i=="used") {v=$(i+1); gsub("K","",v); print v*1024; exit}}'
}
agent_hist_bytes() { # com.synapsev.agentt.* 인스턴스 바이트 합 (class histogram, 풀 GC 포함)
  docker exec "$1" jcmd 1 GC.class_histogram 2>/dev/null | awk '/com.synapsev.agentt/{s+=$3} END{print s+0}'
}

# 5. gateway stop: p95 변화 ≤5ms, 버퍼 ≤8MB, 재기동 후 수신 재개
s5() {
  sys_ids; login
  log "S5: 기준선 hey 30s (gateway 가동)"
  "$BIN/e2e-hey" -z 30s -q 50 -c 20 $T9/ok >"$RES/s5-base.txt" 2>&1
  local heap0 hist0; heap0=$(heap_after_gc e2e-tomcat9); hist0=$(agent_hist_bytes e2e-tomcat9)
  log "S5: gateway 중지 + 60s 부하"
  docker stop e2e-gateway >/dev/null
  local tstop; tstop=$(ch_now)
  "$BIN/e2e-hey" -z 60s -q 50 -c 20 $T9/ok >"$RES/s5-down.txt" 2>&1
  local heap1 hist1; hist1=$(agent_hist_bytes e2e-tomcat9); heap1=$(heap_after_gc e2e-tomcat9)
  local fail=$(( $(hey_stat "$RES/s5-down.txt" total) - $(hey_stat "$RES/s5-down.txt" ok) ))
  local p95b p95d; p95b=$(hey_stat "$RES/s5-base.txt" p95); p95d=$(hey_stat "$RES/s5-down.txt" p95)
  local dp; dp=$(awk -v a="$p95d" -v b="$p95b" 'BEGIN{printf "%.2f", a-b}')
  local heap_delta_mb hist_mb
  heap_delta_mb=$(awk -v a="$heap1" -v b="$heap0" 'BEGIN{printf "%.2f", (a-b)/1048576}')
  hist_mb=$(awk -v a="$hist1" 'BEGIN{printf "%.2f", a/1048576}')
  log "S5: 에이전트 로그 최근: $(docker exec e2e-tomcat9 tail -3 /opt/agent-t/logs/agent-t.log | tr '\n' '|')"
  docker start e2e-gateway >/dev/null
  wait_http $GW/t/v1/snapshot 30 >/dev/null
  log "S5b: gateway docker pause (연결은 수락·응답 없음) 30s 부하"
  docker pause e2e-gateway >/dev/null
  "$BIN/e2e-hey" -z 30s -q 50 -c 20 $T9/ok >"$RES/s5-pause.txt" 2>&1
  local hist2; hist2=$(agent_hist_bytes e2e-tomcat9)
  docker unpause e2e-gateway >/dev/null
  local p95p; p95p=$(hey_stat "$RES/s5-pause.txt" p95); local dpp; dpp=$(awk -v a="$p95p" -v b="$p95b" 'BEGIN{printf "%.2f", a-b}')
  local hist2_mb; hist2_mb=$(awk -v a="$hist2" 'BEGIN{printf "%.2f", a/1048576}')
  metric S5b_pause_p95_ms "$p95p"; metric S5b_pause_p95_delta_ms "$dpp"; metric S5b_pause_agent_objs_mb "$hist2_mb"
  sleep 5
  local tresume; tresume=$("$PY" -c 'import time;print(int(time.time()*1000))')
  "$BIN/e2e-hey" -z 20s -q 10 -c 2 $T9/ok >/dev/null 2>&1
  local seen; seen=$(last_seen_ms "$ID_E2E_SYS_B")
  local rows_after; rows_after=$(ch "SELECT count() FROM tx_summary WHERE system_id=$ID_E2E_SYS_B AND start_ts >= toDateTime64('$tstop',3,'UTC') + 61")
  metric S5_p95_base_ms "$p95b"; metric S5_p95_gwdown_ms "$p95d"; metric S5_p95_delta_ms "$dp"
  metric S5_agent_objs_mb "$hist_mb"; metric S5_heap_delta_mb "$heap_delta_mb"; metric S5_failed_requests "$fail"
  local pass=1 why=""
  [ -n "$p95b" ] && [ -n "$p95d" ] || { pass=0; why+="p95 파싱 실패; "; }
  cmp_le "$dp" 5 || { pass=0; why+="p95 +${dp}ms; "; }
  cmp_le "$dpp" 5 || { pass=0; why+="pause p95 +${dpp}ms; "; }
  cmp_le "$hist2_mb" 8 || { pass=0; why+="pause 에이전트 객체 ${hist2_mb}MB; "; }
  cmp_le "$hist_mb" 8 || { pass=0; why+="에이전트 객체 ${hist_mb}MB>8MB; "; }
  [ "$seen" -gt "$tresume" ] || { pass=0; why+="재기동 후 last_seen 갱신 없음; "; }
  [ "$rows_after" -gt 0 ] || { pass=0; why+="재기동 후 tx_summary 증가 없음; "; }
  [ "$fail" -eq 0 ] || { pass=0; why+="gateway 중지 중 실패 응답 $fail; "; }
  [ $pass -eq 1 ] && result 5 "gateway 중단 내성" PASS "p95 ${p95b}→${p95d}ms (Δ${dp}; pause Δ${dpp}), 에이전트 객체 ${hist_mb}MB(pause ${hist2_mb}MB), 힙Δ ${heap_delta_mb}MB, 재개 rows=$rows_after" \
                  || result 5 "gateway 중단 내성" FAIL "$why (p95 ${p95b}→${p95d}, agentObjs ${hist_mb}MB, heapΔ ${heap_delta_mb}MB)"
}

patch_enabled() { # agent_id true|false
  local cur new
  cur=$(curl -s "$API/api/v1/agents/$1" -H "Authorization: Bearer $TOKEN" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["label_info"])')
  new=$(echo "$cur" | "$PY" -c "import sys,json;d=json.loads(sys.stdin.read());d['enabled']='$2';print(json.dumps(json.dumps(d)))")
  curl -s -X PATCH "$API/api/v1/agents/$1" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"label_info\":$new}" -o /dev/null -w '%{http_code}'
}

# 6. kill switch — 레지스트리 30s 갱신 주기 대비 서로 다른 위상에서 3회 토글, 기준 ≤35s (controller 결정:
#    30s 레지스트리 갱신 + 1s 전송 + 여유; 에이전트별 label_info.enabled 가 이 설계의 킬 스위치 경로)
s6() {
  sys_ids; login
  local aid; aid=$(docker exec e2e-postgres psql -U synapse -d synapse -At -c "SELECT id FROM agent_instances WHERE agent_type='agent_t' AND system_id=$ID_E2E_SYS_B")
  "$BIN/e2e-hey" -z 480s -q 5 -c 1 $T9/ok >"$RES/s6-hey.txt" 2>&1 &
  sleep 15
  local lags=() pass=1 why="" round off
  local offsets=(0 9 19)
  for round in 1 2 3; do
    off=${offsets[$((round-1))]}; sleep "$off"
    local tp; tp=$(ch_now)
    local code; code=$(patch_enabled "$aid" false)
    sleep 50
    local lag lag_s after_n
    lag=$(ch "SELECT toUnixTimestamp64Milli(max(start_ts)) - toUnixTimestamp64Milli(toDateTime64('$tp',3,'UTC')) FROM tx_summary WHERE system_id=$ID_E2E_SYS_B")
    lag_s=$(awk -v l="$lag" 'BEGIN{printf "%.1f", (l<0?0:l)/1000}')
    after_n=$(ch "SELECT count() FROM tx_summary WHERE system_id=$ID_E2E_SYS_B AND start_ts > toDateTime64('$tp',3,'UTC') + 40")
    log "S6 round $round (위상 +${off}s): PATCH $code, 중단까지 ${lag_s}s, +40s 이후 행 $after_n"
    lags+=("$lag_s"); metric "S6_round${round}_stop_s" "$lag_s"
    [ "$code" = 200 ] && [ "$after_n" -eq 0 ] || { pass=0; why+="round$round patch=$code after=$after_n; "; }
    cmp_le "$lag_s" 35 || { pass=0; why+="round$round ${lag_s}s>35s; "; }
    # 재활성 → 재attach 없이 수집 재개
    local tr; tr=$(ch_now); patch_enabled "$aid" true >/dev/null
    local resumed=0 w
    for w in $(seq 1 40); do
      sleep 3
      [ "$(ch "SELECT count() FROM tx_summary WHERE system_id=$ID_E2E_SYS_B AND start_ts >= toDateTime64('$tr',3,'UTC')")" -gt 0 ] && { resumed=1; break; }
    done
    metric "S6_round${round}_resume_s" "$((w*3))"
    [ $resumed -eq 1 ] || { pass=0; why+="round$round 재개 없음; "; }
  done
  wait   # hey 종료
  local bad; bad=$(( $(hey_stat "$RES/s6-hey.txt" total) - $(hey_stat "$RES/s6-hey.txt" ok) )) 2>/dev/null || bad=-1
  [ "$bad" -eq 0 ] || { pass=0; why+="서비스 실패응답 $bad; "; }
  local mn mx; mn=$(printf '%s\n' "${lags[@]}" | sort -n | head -1); mx=$(printf '%s\n' "${lags[@]}" | sort -n | tail -1)
  metric S6_stop_min_s "$mn"; metric S6_stop_max_s "$mx"
  [ $pass -eq 1 ] && result 6 "킬 스위치(3회)" PASS "중단까지 min ${mn}s / max ${mx}s (≤35s), 재활성 시 재attach 없이 재개, 서비스 실패응답 0" \
                  || result 6 "킬 스위치(3회)" FAIL "$why (stop ${lags[*]})"
}

cpu_usec() { docker exec "$1" sh -c 'grep usage_usec /sys/fs/cgroup/cpu.stat' | awk '{print $2}'; }
cpu_pct_run() { # container url secs -> avg cpu% of one core during hey run; hey output to $RES/s8-last.txt
  local c0 c1 s0 s1
  c0=$(cpu_usec "$1"); s0=$("$PY" -c 'import time;print(time.time())')
  "$BIN/e2e-hey" -z "$3"s -q 50 -c 20 "$2" >"$RES/s8-last.txt" 2>&1
  c1=$(cpu_usec "$1"); s1=$("$PY" -c 'import time;print(time.time())')
  awk -v a="$c0" -v b="$c1" -v n="$(hey_stat "$RES/s8-last.txt" total)" 'BEGIN{printf "%.1f\n", (b-a)/n}' >"$RES/s8-last-usreq.txt"
  awk -v a="$c0" -v b="$c1" -v s="$s0" -v e="$s1" 'BEGIN{printf "%.2f", (b-a)/1e6/(e-s)*100}'
}
docker_cpu_mem() { docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$1"; }

# 7. 5,000 TPS 용량
s7() {
  sys_ids; login
  local base_n=200
  local i bl=()
  for i in 1 2 3; do
    "$BIN/e2e-hey" -z 10s -c 5 -H "Authorization: Bearer $TOKEN" $API/api/v1/systems >"$RES/s7-api-base$i.txt" 2>&1
    bl+=("$(hey_stat "$RES/s7-api-base$i.txt" p95)")
  done
  local p95b; p95b=$(printf '%s\n' "${bl[@]}" | sort -n | sed -n 2p)   # 중앙값(3개)
  log "S7: agentsim 시작 (50 JVM, 5000 TPS, $LOAD_DURATION)"
  local t0; t0=$(ch_now)
  : > "$RES/s7-stats.txt"; : > "$RES/s7-lag.txt"; : > "$RES/s7-apm-probe.txt"
  local net0; net0=$(docker stats --no-stream --format '{{.NetIO}}' e2e-gateway)
  "$BIN/agentsim" -gateway $GW -tokens "$WORK/tokens-sim.txt" -jvms 50 -tps 5000 -duration "$LOAD_DURATION" >"$RES/s7-agentsim.txt" 2>&1 &
  local sim=$!
  local dur_s; dur_s=$("$PY" -c "
import re,sys
v='$LOAD_DURATION'; m=re.match(r'(\d+)([smh])',v); n=int(m.group(1)); print(n*{'s':1,'m':60,'h':3600}[m.group(2)])")
  local end=$(( $(date +%s) + dur_s )) api_done=0 tick=0
  while kill -0 $sim 2>/dev/null; do
    docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' e2e-gateway e2e-clickhouse >>"$RES/s7-stats.txt" 2>/dev/null
    local lag; lag=$(ch "SELECT dateDiff('millisecond', max(start_ts), now64(3)) FROM tx_summary WHERE system_id=$ID_E2E_SYS_SIM AND start_ts > now() - 60" 2>/dev/null)
    case "$lag" in ''|*[!0-9]*) lag=99999999;; esac; [ "$lag" -gt 600000 ] && lag=99999999   # 쿼리 실패·최근 60초 행 없음 = 적재 정지로 간주(기록값 99999999)
    echo "$lag" >>"$RES/s7-lag.txt"
    tick=$((tick+1))
    if [ $api_done -eq 0 ] && [ $tick -ge 20 ]; then      # ≈1분 시점
      api_done=1
      "$BIN/e2e-hey" -z 10s -c 5 -H "Authorization: Bearer $TOKEN" $API/api/v1/systems >"$RES/s7-api-load1.txt" 2>&1
    elif [ $api_done -eq 1 ] && [ $tick -ge 100 ]; then   # ≈5분 시점
      api_done=2
      "$BIN/e2e-hey" -z 10s -c 5 -H "Authorization: Bearer $TOKEN" $API/api/v1/systems >"$RES/s7-api-load2.txt" 2>&1
    fi
    if [ $((tick % 10)) -eq 5 ]; then   # ≈30초마다: 전체 시스템·최근 1시간 검색 (limit 100) 상태코드·시간 기록
      curl -s -o "$RES/s7-apm-last.json" -w '%{http_code} %{time_total}\n' -m 60 -H "Authorization: Bearer $TOKEN" \
        "$API/api/v1/apm/transactions?system_ids=$ID_E2E_SYS_A&system_ids=$ID_E2E_SYS_B&system_ids=$ID_E2E_SYS_SIM&limit=100" >>"$RES/s7-apm-probe.txt"
    fi
    sleep 3
  done
  wait $sim
  local apm_bad apm_n; apm_n=$(wc -l <"$RES/s7-apm-probe.txt"); apm_bad=$(awk '$1!=200' "$RES/s7-apm-probe.txt" | wc -l)
  metric S7_apm_search_probes "$apm_n"; metric S7_apm_search_non200 "$apm_bad"; metric S7_apm_search_max_s "$(sort -k2 -n "$RES/s7-apm-probe.txt" | tail -1 | cut -d' ' -f2)"
  local t1; t1=$(ch_now)
  sleep 10
  local p95l; p95l=$(printf '%s\n' "$(hey_stat "$RES/s7-api-load1.txt" p95)" "$(hey_stat "$RES/s7-api-load2.txt" p95)" | sort -n | tail -1)   # 보수적으로 큰 값
  local dabs; dabs=$(awk -v a="$p95l" -v b="$p95b" 'BEGIN{printf "%.2f", a-b}')
  local sent; sent=$(sed -n 's/.*sent_tx=\([0-9]*\).*/\1/p' "$RES/s7-agentsim.txt")
  local rej; rej=$(sed -n 's/.*rejected_429=\([0-9]*\).*/\1/p' "$RES/s7-agentsim.txt")
  local failed; failed=$(sed -n 's/.*failed=\([0-9]*\).*/\1/p' "$RES/s7-agentsim.txt")
  local rows; rows=$(ch "SELECT count() FROM tx_summary WHERE system_id=$ID_E2E_SYS_SIM AND start_ts >= toDateTime64('$t0',3,'UTC')")
  local dup; dup=$(ch "SELECT count() - uniqExact(span_id) FROM tx_summary WHERE system_id=$ID_E2E_SYS_SIM AND start_ts >= toDateTime64('$t0',3,'UTC')")
  local dropped; dropped=$(curl -s "http://localhost:19090/api/v1/query" --data-urlencode 'query=sum(agent_t_dropped_total{system_name="e2e-sys-sim"})' | "$PY" -c 'import sys,json
d=json.load(sys.stdin)["data"]["result"]; print(d[0]["value"][1] if d else "NA")')
  local lag_max lag_p95
  lag_max=$(sort -n "$RES/s7-lag.txt" | tail -1)
  lag_p95=$(sort -n "$RES/s7-lag.txt" | awk '{a[NR]=$1} END{print a[int(NR*0.95)+ (NR*0.95>int(NR*0.95)?1:0)]}')
  local gw_avg gw_max ch_avg ch_max
  read -r gw_avg gw_max <<<"$(awk '$1=="e2e-gateway"{gsub("%","",$2);s+=$2;n++;if($2>m)m=$2}END{printf "%.0f %.0f", s/n, m}' "$RES/s7-stats.txt")"
  read -r ch_avg ch_max <<<"$(awk '$1=="e2e-clickhouse"{gsub("%","",$2);s+=$2;n++;if($2>m)m=$2}END{printf "%.0f %.0f", s/n, m}' "$RES/s7-stats.txt")"
  local gw_mem; gw_mem=$(awk '$1=="e2e-gateway"{print $3}' "$RES/s7-stats.txt" | sort -h | tail -1)
  local degr; degr=$(awk -v a="$p95l" -v b="$p95b" 'BEGIN{printf "%.1f", (a-b)*100/b}')
  # system.parts 는 agent_t 사용자 권한 밖 → 컨테이너 내부 default 사용자
  local bytes_per_tx sql_bytes
  bytes_per_tx=$(docker exec e2e-clickhouse clickhouse-client -q "SELECT round(sum(bytes_on_disk)/sum(rows),1) FROM system.parts WHERE database='agent_t' AND table='tx_summary' AND active")
  sql_bytes=$(docker exec e2e-clickhouse clickhouse-client -q "SELECT round(sum(bytes_on_disk)/sum(rows),1) FROM system.parts WHERE database='agent_t' AND table='tx_sql' AND active")
  local rx_b wire_per_tx; rx_b=$("$PY" - "$net0" "$(docker stats --no-stream --format '{{.NetIO}}' e2e-gateway)" <<'PYEOF'
import sys,re
def b(s):
    m=re.match(r"([\d.]+)\s*([kKMGT]?i?B)",s.strip()); u={"B":1,"kB":1e3,"KiB":1024,"MB":1e6,"MiB":1048576,"GB":1e9,"GiB":1073741824}
    return float(m.group(1))*u[m.group(2)]
print(int(b(sys.argv[2].split("/")[0])-b(sys.argv[1].split("/")[0])))
PYEOF
)
  wire_per_tx=$(awk -v r="$rx_b" -v n="$sent" 'BEGIN{printf "%.1f", r/n}')
  metric S7_sent_tx "$sent"; metric S7_rows "$rows"; metric S7_dup_span_rows "$dup"; metric S7_rejected_429 "$rej"; metric S7_failed_posts "$failed"; metric S7_dropped_total "$dropped"
  metric S7_lag_max_ms "$lag_max"; metric S7_lag_p95_ms "$lag_p95"
  metric S7_gateway_cpu_avg_pct "$gw_avg"; metric S7_gateway_cpu_max_pct "$gw_max"; metric S7_clickhouse_cpu_avg_pct "$ch_avg"; metric S7_clickhouse_cpu_max_pct "$ch_max"
  metric S7_gateway_mem_max "$gw_mem"
  metric S7_api_systems_p95_base_ms "$p95b"; metric S7_api_systems_p95_load_ms "$p95l"; metric S7_api_degradation_pct "$degr"; metric S7_api_degradation_abs_ms "$dabs"
  metric S7_ch_bytes_per_tx_summary_row "$bytes_per_tx"; metric S7_ch_bytes_per_tx_sql_row "$sql_bytes"; metric S7_gateway_rx_bytes_per_tx_approx "$wire_per_tx"
  local pass=1 why=""
  [ "${rej:-1}" -eq 0 ] && [ "${failed:-1}" -eq 0 ] || { pass=0; why+="429=$rej failed=$failed; "; }
  case "$dropped" in NA|"") pass=0; why+="dropped 지표 조회 결과 없음(Prometheus 비어 있음); ";; *) [ "${dropped%.*}" -eq 0 ] || { pass=0; why+="dropped=$dropped; "; };; esac
  [ "$rows" -ge "$(( sent * 995 / 1000 ))" ] || { pass=0; why+="적재 $rows < 송신 $sent; "; }
  [ "${lag_p95:-99999}" -lt 5000 ] || { pass=0; why+="적재 지연 p95 ${lag_p95}ms; "; }
  cmp_le "$gw_avg" 100 || { pass=0; why+="gateway CPU avg ${gw_avg}%; "; }
  cmp_le "$ch_avg" 150 || { pass=0; why+="clickhouse CPU avg ${ch_avg}%; "; }
  # 베이스라인이 서브밀리초대라 상대값이 노이즈에 지배됨 → 상대 ≤20% 또는 절대 ≤+1ms(hey 해상도·타이머 노이즈 하한) 중 하나면 통과
  { cmp_le "$degr" 20 || cmp_le "$dabs" 1; } || { pass=0; why+="admin-api p95 +${degr}% (+${dabs}ms); "; }
  [ $pass -eq 1 ] && result 7 "5,000 TPS 용량" PASS "sent=$sent rows=$rows dup_span=$dup dropped=$dropped lag p95=${lag_p95}ms max=${lag_max}ms gw CPU ${gw_avg}%/${gw_max}% ch CPU ${ch_avg}%/${ch_max}% api p95 ${p95b}→${p95l}ms(+${degr}%)" \
                  || result 7 "5,000 TPS 용량" FAIL "$why (sent=$sent rows=$rows dup_span=$dup lag p95=${lag_p95}ms max=${lag_max}ms gw ${gw_avg}%/${gw_max}% ch ${ch_avg}%/${ch_max}% api ${p95b}→${p95l}ms)"
}

# 8. 에이전트 오버헤드 (JDK17 native): bare(OFF) vs 에이전트 부착(ON), 교차 2회
s8() {
  sys_ids; login
  # 에이전트가 붙어 있는지 확인(S6 재attach). 없으면 attach.
  docker exec e2e-tomcat9 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t.jar >/dev/null 2>&1
  sleep 3
  "$BIN/e2e-hey" -z 20s -q 50 -c 20 $TB/ok >/dev/null 2>&1; "$BIN/e2e-hey" -z 20s -q 50 -c 20 $T9/ok >/dev/null 2>&1   # warm-up
  local off=() on=() offp=() onp=() offu=() onu=() r
  for r in 1 2 3; do
    off+=("$(cpu_pct_run e2e-tomcat9-bare $TB/ok 45)"); offp+=("$(hey_stat "$RES/s8-last.txt" p95)"); offu+=("$(cat "$RES/s8-last-usreq.txt")")
    on+=("$(cpu_pct_run e2e-tomcat9 $T9/ok 45)");       onp+=("$(hey_stat "$RES/s8-last.txt" p95)"); onu+=("$(cat "$RES/s8-last-usreq.txt")")
  done
  local off_cpu on_cpu off_p on_p
  off_cpu=$(printf '%s\n' "${off[@]}" | awk '{s+=$1}END{printf "%.2f", s/NR}'); on_cpu=$(printf '%s\n' "${on[@]}" | awk '{s+=$1}END{printf "%.2f", s/NR}')
  off_p=$(printf '%s\n' "${offp[@]}" | awk '{s+=$1}END{printf "%.2f", s/NR}'); on_p=$(printf '%s\n' "${onp[@]}" | awk '{s+=$1}END{printf "%.2f", s/NR}')
  local dcpu dp rel
  dcpu=$(awk -v a="$on_cpu" -v b="$off_cpu" 'BEGIN{printf "%.2f", a-b}'); dp=$(awk -v a="$on_p" -v b="$off_p" 'BEGIN{printf "%.2f", a-b}')
  rel=$(awk -v a="$on_cpu" -v b="$off_cpu" 'BEGIN{printf "%.1f", (a-b)*100/b}')
  metric S8_cpu_off_pct "$off_cpu (${off[*]})"; metric S8_cpu_on_pct "$on_cpu (${on[*]})"; metric S8_cpu_delta_pt "$dcpu"; metric S8_cpu_delta_rel_pct "$rel"
  local offu_m onu_m; offu_m=$(printf '%s\n' "${offu[@]}" | awk '{s+=$1}END{printf "%.1f", s/NR}'); onu_m=$(printf '%s\n' "${onu[@]}" | awk '{s+=$1}END{printf "%.1f", s/NR}')
  metric S8_cpu_us_per_req_off "$offu_m (${offu[*]})"; metric S8_cpu_us_per_req_on "$onu_m (${onu[*]})"
  metric S8_p95_off_ms "$off_p (${offp[*]})"; metric S8_p95_on_ms "$on_p (${onp[*]})"; metric S8_p95_delta_ms "$dp"
  metric S8_heap_used_mb_on "$(awk -v h="$(heap_after_gc e2e-tomcat9)" 'BEGIN{printf "%.1f", h/1048576}')"; metric S8_heap_used_mb_off "$(awk -v h="$(heap_after_gc e2e-tomcat9-bare)" 'BEGIN{printf "%.1f", h/1048576}')"
  if cmp_le "$dcpu" 3 && cmp_le "$dp" 5; then
    result 8 "에이전트 오버헤드" PASS "CPU ${off_cpu}%→${on_cpu}% (+${dcpu}pt, 상대 +${rel}%), p95 ${off_p}→${on_p}ms (+${dp})"
  else
    result 8 "에이전트 오버헤드" FAIL "CPU ${off_cpu}%→${on_cpu}% (+${dcpu}pt, 상대 +${rel}%), p95 ${off_p}→${on_p}ms (+${dp})"
  fi
}

# 10. ClickHouse 정지 내성 — 의심 결함 "ClickHouse 지연 시 인입 타임아웃" 의 결정적 재현.
#     agentsim 2,000 TPS × 2분 중 30초 시점에 ClickHouse 를 45초 docker pause → unpause.
#     기대: agentsim 실패 post 0(429 는 허용), 별도 프로브 요청의 gateway 핸들러 지연 p99 < 1s, 적재 행 == 송신 - 보고된 drop(±0.5%).
#     프로브: 빈 tx 배치를 전용 토큰(50번째 sim 인스턴스)으로 10rps 전송 — gateway /metrics 가 없어 외부에서 지연을 측정한다.
s10() {
  sys_ids; login
  local probe_tok; probe_tok=$(tail -1 "$WORK/tokens-sim.txt")
  "$PY" - "$WORK/probe.json.gz" <<'PYEOF'
import gzip, json, sys, time
b = {"v": 1, "seq": 1, "ts": int(time.time() * 1000), "cfg_v": 0,
     "agent": {"version": "probe", "jvm": "21", "pid": 1, "host": "probe", "start_ts": int(time.time() * 1000) - 60000},
     "active": {"buckets": [0, 0, 0], "top": []}, "tx": [], "dict": {"sql": {}, "uri": {}}, "jvm": None, "dumps": [], "dropped": {"detail": 0, "sql": 0, "tx": 0}}
open(sys.argv[1], "wb").write(gzip.compress(json.dumps(b).encode()))
PYEOF
  head -49 "$WORK/tokens-sim.txt" > "$WORK/tokens-sim49.txt"
  local t0; t0=$(ch_now)
  if [ "${E2E_SIM_IN_DOCKER:-}" = 1 ]; then   # 호스트→컨테이너 포트포워딩 경로 영향을 배제하기 위해 agentsim 을 dev-net 내부에서 실행
    docker run --rm --network agent-t-e2e_dev-net -v "$BIN:/b:ro" -v "$WORK:/w:ro" busybox /b/agentsim-linux -gateway http://agent-t-gateway:8330 \
      -tokens /w/tokens-sim49.txt -jvms 49 -tps 2000 -duration 120s >"$RES/s10-agentsim.txt" 2>&1 &
  else
    "$BIN/agentsim" -gateway $GW -tokens "$WORK/tokens-sim49.txt" -jvms 49 -tps 2000 -duration 120s >"$RES/s10-agentsim.txt" 2>&1 &
  fi
  local sim=$!
  "$BIN/e2e-hey" -z 115s -q 10 -c 1 -m POST -D "$WORK/probe.json.gz" -H "Authorization: Bearer $probe_tok" \
      -H "Content-Encoding: gzip" -H "Content-Type: application/json" $GW/t/v1/batch >"$RES/s10-probe.txt" 2>&1 &
  local probe=$!
  # 타임라인 프로브: ≤5rps, 요청별 시각·지연 기록(정지 시점과 지연 급증 시점 대조용).
  ( local dumped=0 t0s; t0s=$(date +%s)
    while [ $(( $(date +%s) - t0s )) -lt 118 ]; do
      local r; r=$(curl -s -o /dev/null -m 30 -X POST -H "Authorization: Bearer $probe_tok" -H "Content-Encoding: gzip" -H "Content-Type: application/json" \
            --data-binary @"$WORK/probe.json.gz" -w '%{http_code} %{time_total}' $GW/t/v1/batch)
      echo "$(date +%H:%M:%S) $r" >>"$RES/s10-timeline.txt"
      sleep 0.2
    done ) &
  local tl=$!
  sleep 30
  log "S10: docker pause "${E2E_S10_PAUSE:-e2e-clickhouse}" 45s"
  docker pause "${E2E_S10_PAUSE:-e2e-clickhouse}" >/dev/null
  sleep 25; docker logs --since 30s e2e-gateway >"$RES/s10-gateway-during-stall.log" 2>&1
  # 정지 25초 시점(관측된 지연 급증 구간)에 goroutine dump 를 원하면 E2E_S10_QUIT=1 — gateway 가 종료되므로 그 실행의 수치는 무효
  [ "${E2E_S10_QUIT:-}" = 1 ] && { docker kill -s QUIT e2e-gateway >/dev/null 2>&1; echo "$(date +%H:%M:%S) SIGQUIT sent (stall+25s)" >>"$RES/s10-timeline.txt"; }
  sleep 20
  docker unpause "${E2E_S10_PAUSE:-e2e-clickhouse}" >/dev/null
  wait $sim; wait $probe; wait $tl
  docker start e2e-gateway >/dev/null 2>&1; sleep 45
  local sent failed rej p99 slow bad rows dropped
  sent=$(sed -n 's/.*sent_tx=\([0-9]*\).*/\1/p' "$RES/s10-agentsim.txt")
  rej=$(sed -n 's/.*rejected_429=\([0-9]*\).*/\1/p' "$RES/s10-agentsim.txt")
  failed=$(sed -n 's/.*failed=\([0-9]*\).*/\1/p' "$RES/s10-agentsim.txt")
  p99=$(hey_stat "$RES/s10-probe.txt" p99); slow=$(awk '/Slowest:/{print $2*1000}' "$RES/s10-probe.txt")
  bad=$(( $(hey_stat "$RES/s10-probe.txt" total) - $(hey_stat "$RES/s10-probe.txt" ok) ))
  rows=$(ch "SELECT count() FROM tx_summary WHERE system_id=$ID_E2E_SYS_SIM AND start_ts >= toDateTime64('$t0',3,'UTC')")
  local dup; dup=$(ch "SELECT count() - uniqExact(span_id) FROM tx_summary WHERE system_id=$ID_E2E_SYS_SIM AND start_ts >= toDateTime64('$t0',3,'UTC')")
  dropped=$(curl -s "http://localhost:19090/api/v1/query" --data-urlencode 'query=sum(agent_t_dropped_total{system_name="e2e-sys-sim"})' | "$PY" -c 'import sys,json
d=json.load(sys.stdin)["data"]["result"]; print(d[0]["value"][1] if d else "NA")')
  metric S10_sent_tx "$sent"; metric S10_rejected_429 "$rej"; metric S10_failed_posts "$failed"; metric S10_probe_p99_ms "$p99"
  metric S10_probe_max_ms "$slow"; metric S10_probe_non200 "$bad"; metric S10_rows "$rows"; metric S10_dropped "$dropped"; metric S10_dup_span_rows "$dup"
  local pass=1 why=""
  [ "${failed:-1}" -eq 0 ] || { pass=0; why+="agentsim 실패 post ${failed}(타임아웃/연결오류, 429 아님); "; }
  [ -n "$p99" ] && cmp_le "$p99" 999 || { pass=0; why+="프로브 p99 ${p99:-?}ms (≥1s); "; }
  case "$dropped" in NA|"") pass=0; why+="dropped 조회 결과 없음; ";; esac
  local expect; expect=$(( sent - ${dropped%.*} ))
  [ "$rows" -ge "$(( expect * 995 / 1000 ))" ] || { pass=0; why+="적재 $rows < 송신-drop $expect; "; }
  if [ $pass -eq 1 ]; then
    result 10 "ClickHouse 45s 정지 내성" PASS "실패 post 0(429=$rej), 프로브 p99 ${p99}ms max ${slow}ms, rows=$rows dup_span=$dup sent=$sent dropped=$dropped"
  else
    result 10 "ClickHouse 45s 정지 내성" FAIL "$why (p99 ${p99}ms max ${slow}ms, 429=$rej failed=$failed rows=$rows dup_span=$dup sent=$sent dropped=$dropped)"
    log "S10: 실패 증거 수집 (gateway 로그·goroutine dump)"
    docker logs e2e-gateway >"$RES/s10-gateway.log" 2>&1
    docker stats --no-stream >"$RES/s10-docker-stats.txt" 2>&1
    docker logs e2e-gateway >"$RES/s10-gateway-goroutines.log" 2>&1   # 타임라인 프로브가 SIGQUIT 를 보냈다면 dump 포함
    wait_http $GW/healthz 30 >/dev/null
  fi
}

cmd_test() {
  : > "$RES/summary.txt"; : > "$RES/metrics.env"
  { echo "docker_vm_mem:"; docker run --rm alpine free -m 2>&1 | sed 's/^/  /'; echo "run_id=$RUN_ID"; echo "start=$(date -u +%FT%TZ)"; echo "load_avg=$(uptime | sed 's/.*load averages*: //')"; } > "$RES/run-info.txt"
  login 2>/dev/null || { echo "admin-api 로그인 실패 — 'run.sh up' 먼저"; exit 1; }
  local list=("$@"); [ ${#list[@]} -eq 0 ] && list=(1 2 3 4 5 6 7 8 10)
  for n in "${list[@]}"; do log "=== 시나리오 $n ==="; "s$n"; done
  echo "end=$(date -u +%FT%TZ)" >> "$RES/run-info.txt"; echo "load_avg_end=$(uptime | sed 's/.*load averages*: //')" >> "$RES/run-info.txt"
  if [ "${E2E_PUBLISH:-}" = 1 ]; then   # 작은 텍스트 결과만 리포에 보관
    mkdir -p "$HERE/results-committed/$RUN_ID"; cp "$RES/summary.txt" "$RES/metrics.env" "$RES/run-info.txt" "$HERE/results-committed/$RUN_ID/"
  fi
  echo; echo "── 요약 ──"; cat "$RES/summary.txt"; echo "(9: 브라우저 — qa subagent)  결과: $RES"
  [ $FAILS -eq 0 ]
}

case "${1:-}" in
  up) cmd_up;;
  test) shift; cmd_test "$@";;
  down) cmd_down;;
  *) sed -n 2,6p "$0"; exit 2;;
esac
