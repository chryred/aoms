# Agent-T 개발기 적용 가능성 확인 (H3)

- 일시: 2026-10-31 09:11 ~ 09:24 KST
- 대상: 개발기 `scdep-isic-wasdev` (10.253.21.78), JEUS 7 `sic_domain` / `sic_server1` (PID 42318), JDK `1.7.0_79` (HotSpot 24.79), 실행 계정 `jeussic`
- 공존 에이전트: SysMaster (`-agentpath:.../libdcagent64.so`, `-javaagent:.../sminst17_rt.jar`, `-Xbootclasspath/p:.../sminst17_rt.jar`)
- 사용 산출물: `feat/agent-t` 4e38c33 빌드 `agent-t-legacy.jar` (sha256 `b31ef735…f7b796`), `agent-t-attacher.jar` (`57d7be59…7a66fe`)
- 변경 범위: **즉시 적용(dynamic attach)만** 수행. `domain.xml` 은 수정하지 않음(diff 만 생성).

## 1. 사전 점검 (읽기 전용)
| 항목 | 결과 |
|---|---|
| 대상 JVM 소유자 == SSH 계정 | `jeussic` == `jeussic` |
| JDK (tools.jar) | `/usr/local/jdk1.7.0_79/lib/tools.jar` 존재 |
| attach 소켓 디렉터리 | `/tmp/hsperfdata_jeussic/42318` 노출 |
| 디스크 | `/apps` 53G 여유 |
| `agent-t-attacher.jar --check 42318` | `OK` (exit 0) |
| SSH exec 채널 | 거부 → 대화형 셸(PTY)로만 명령 실행 (D4 의 `ssh_shell_exec` 폴백 경로와 동일한 제약) |
| SSH 원격 포워딩(`-R`) | 거부 (`remote port forwarding failed`) |
| 개발기 → 로컬 gateway 직접 연결 | 불가 (timeout) |

→ 수집 경로 확인을 위해 개발기 `127.0.0.1:18330` 에 일회성 수신기(배치를 파일로 저장, 계약 형식 응답, `DISABLE` 파일로 enabled=false 전달)를 띄우고, 저장된 배치를 로컬 gateway 에 재전송(replay)해 저장소까지 검증했다. 수신기는 검증 후 삭제했다.

## 2. 즉시 적용 (attach)
- 09:13:46 attach → exit 0, 에이전트 로그: `retransform done: ok=66 failed=0`, `agent-t started (agentmain) system=sic-dev role=sic_server1`
- attach 직후 WAS 누적 CPU 시간 +약 6초(재변환 1회성), 이후 관찰 구간 평상시와 동일 (top `%CPU` 0~6.7%, RSS 2.3g 변화 없음)
- 수집 확인: 읽기 전용 `GET http://10.253.21.78:9092/` 요청이 `/index.jsp` 트랜잭션으로 수집됨 (method·status·elapsed·cpu·user_ip). 1초 배치, 5초 JVM 지표(heap 1.19G/2.14G, threads 218, cpu_ratio 0.006, classes 16,293) 정상.
- 저장소 확인: 캡처 배치 79건 로컬 gateway replay → 전부 200, ClickHouse `agent_t.tx_summary` 에 해당 시스템 21건 적재.
- **수집되지 않은 것**: JEUS 스케줄러 배치(`ScheduledJobInvoker`)의 SQL — 서블릿 진입이 없는 백그라운드 작업이라 설계상 루트 트랜잭션이 아님 (P3 대상: 업무 배치/스케줄러 진입점 계측).

## 3. 영향 관찰 (attach 후 약 8분, 1분마다 HTTP 10회)
| 시각 | WAS 로그 error/exception 누적 | WAS 로그 내 agent-t 언급 | CPU | RSS |
|---|---|---|---|---|
| 09:13:21 (attach 전) | 3,039 | 0 | 0.0% | 2.3g |
| 09:16:36 | 3,066 | 0 | 0.0% | 2.3g |
| 09:18:37 | 3,081 | 0 | 0.0% | 2.3g |
| 09:20:39 | 3,096 | 0 | 0.0% | 2.3g |

- 증가분은 attach 이전부터 있던 업무 배치 오류(`ScheduledJobInvoker … BATCH_ERROR`, 시간당 약 465건)와 종류·속도가 같다 (08:00~09:13 동일 패턴 190건 vs 09:14 이후 19건/약 3분). 에이전트 기인 오류 없음.
- SysMaster 와 동일 JVM 공존 상태에서 attach·재변환·서비스 모두 정상. (SysMaster 콘솔 수집 화면은 이번에 직접 확인하지 못함 — 후속 확인 필요)

## 4. 킬 스위치 · 원복
- 09:21:02 수신기에 `DISABLE` → 6초 내 `retransform done: ok=66 failed=0` (원본 복원). 이후 배치 15건·HTTP 10회 동안 수집 트랜잭션 0건 (전 71건).
- 09:22 수신기 종료, `~/agent-t-poc/DISABLE` 생성. 에이전트는 비활성 상태로 JVM 에 남아 5초마다 자체 로그(`~/agent-t-poc/logs/agent-t.log`, 크기 상한 적용)에 `post failed` 1줄을 남김. **다음 WAS 재기동 시 완전 제거**(영구 주입 없음).
- 원격 잔여물: `~/agent-t-poc/` (jar·properties(600)·DISABLE·logs). WAS 재기동 후 삭제 가능.

## 5. 영구 적용 (domain.xml) — 미적용, diff 만
`jeus_domain.add_javaagent()` 로 실제 `sic_domain/config/domain.xml`(345KB) 사본에 대해 생성한 diff. 대상 서버 항목만 1줄 추가되며 2회 실행 시 diff 없음(멱등).
```diff
@@ -749,6 +749,7 @@
             <jvm-option>-Dserver_type=DEV</jvm-option>
             <jvm-option>-Dsso.profiles.active=dev</jvm-option>
             <jvm-option>-Deai.profiles.active=dev</jvm-option>
+            <jvm-option>-javaagent:/apps/jeussic/agent-t/agent-t-legacy.jar</jvm-option>
          </jvm-config>
```

## 6. 결론 · 후속
- **JDK 1.7 / JEUS 7 / SysMaster 공존 환경에서 재기동 없는 즉시 적용, 수집, 킬 스위치 원복이 모두 동작함을 확인.**
- 운영 적용 전 필요:
  1. 개발기 WAS → Server A(10.253.21.106) `8330` 방화벽 오픈 (이번엔 네트워크 경로가 없어 일회성 수신기로 대체 검증)
  2. Server A `/app` 디스크 증설(설계 §7.3) 후 ClickHouse·gateway 배포, `.env` 에 `AGENT_T_GATEWAY_URL`·`CLICKHOUSE_PASSWORD` 추가 (없으면 compose 명령 전체가 실패하도록 가드됨)
  3. 적정 사양 서버에서 E2E S7(5,000 TPS)·S10(ClickHouse 정지) 재측정 — 로컬 Docker VM 메모리 부족으로 환경 제약 판정됨
  4. JEUS 영구 적용은 위 diff 를 운영 일정에 맞춰 `jeusadmin` 또는 확인 후 파일 반영 + 재기동
  5. SysMaster 콘솔에서 공존 기간 수집 정상 여부 확인
