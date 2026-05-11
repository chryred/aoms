# 핵심 데이터 흐름

## 메트릭 알림 흐름
```
Prometheus 수집 → alert_rules.yml 평가
  → Alertmanager (firing)
  → POST admin-api/api/v1/alerts/receive
    → system_name으로 시스템 + 담당자 조회
    → 5분 쿨다운 체크
    → TeamsNotifier.send_metric_alert()
    → alert_cooldown upsert + alert_history 저장
```

## LLM 로그 분석 흐름
```
log-analyzer 내부 스케줄러 (ANALYSIS_INTERVAL_SECONDS마다, 기본 5분)
  → analyzer.run_analysis()
    → admin-api에서 활성 시스템 목록 조회
    → Prometheus에서 시스템별 최근 5분 log_error_total 시리즈 조회
       (sum_over_time(log_error_total{system_name="..."}[5m]) > 0)
    → PII 마스킹 (카드번호, 주민번호, 전화번호, 이메일)
    → (Phase 4b) normalize → Ollama 임베딩 → Qdrant 유사도 검색
    → 유사 이력 + 해결책으로 LLM 프롬프트 강화
    → 담당자별 llm_api_key로 LLM API 호출 (llm_client Strategy, ADR-001)
    → POST admin-api/api/v1/analysis (결과 전송)
      → warning/critical이면 TeamsNotifier.send_log_analysis_alert()
      → 실패 시 error_message 채워서 저장 (ADR-002) + Teams 미발송
```

## 벡터 유사도 분류
```
anomaly type:
  duplicate  — score ≥ 0.95 → Teams 알림 생략
  recurring  — score ≥ 0.85 → "반복 이상" 강조 알림
  related    — score ≥ 0.70 → "유사 이상" 알림
  new        — score < 0.70 → "신규 이상" 알림
```

## Prometheus 기반 메트릭 교차 분석 흐름 (admin-api, Phase F)
```
admin-api lifespan → run_prometheus_analyzer_loop() (PROMETHEUS_ANALYZE_INTERVAL_SECONDS=300)
  → run_analysis_cycle()
    → Prometheus에서 host 단위 메트릭 수집 (CPU/메모리/HTTP/로그 에러율)
    → 이상 감지 (host별 교차 분석 — "CPU 급증 + 로그 에러 증가" 등)
    → llm_client.call_llm_text() (ADR-001)
    → Teams 알림 + log_analysis_history 저장
       (instance_role="prometheus_analyzer", model_used=LLM_TYPE)
```

## 분석 실패 처리 흐름 (ADR-002)
```
analyzer.run_analysis() inner except
  → submit_analysis(
       ...,
       severity="info",
       error_message=f"{type(e).__name__}: {str(e)[:300]}",
       model_used=LLM_TYPE,
     )
  → admin-api /api/v1/analysis
    → error_message IS NOT NULL 감지
      → Teams 미발송 (스팸 차단)
      → WebSocket 브로드캐스트 차단
    → log_analysis_history + alert_history 동반 저장
  → Frontend AlertTable: error_message truthy 시 빨간 "분석 실패" 뱃지 렌더
```

---

## 챗봇 다중 시스템 스코프 + 메시지 system_id 추출 흐름 (ADR-015)

```
[프론트엔드 — 사용자 작업]
사용자 로그인 → ChatPage / ChatPanel mount
  → useMyPrimarySystems() 호출 → 담당 시스템 N개 로드
  → chatStore.filterSystemIds 빈 배열일 때만 디폴트 적용
    - 일반 사용자: 담당 시스템 모두 자동 선택
    - admin: useSystems()의 모든 시스템 자동 선택
    - 담당 0개 일반: 빈 상태 유지 (사용자 직접 선택)
  → SystemMultiSelect 변경 시
    → setFilterSystemIds(ids) + usePatchChatSession({ system_ids: ids })
    → PATCH /api/v1/chat/sessions/{id} → chat_sessions.system_ids 갱신

[백엔드 — 메시지 처리 / RAG]
사용자 질문 전송 → POST /sessions/{id}/messages (SSE)
  → run_react_stream(db, session, content, ...)
    → session.system_ids 를 RAG 도구(qdrant_search_*)에 전달
    → ReAct 루프에서 도구 호출 결과 분석
      → _extract_system_id_from_tool 폴백:
        1. tool_args.system_id (정수 직접)
        2. tool_args.system_name → systems 테이블 조회로 변환
        3. tool_result에 단일 system 정보
        4. session.system_ids 가 1개면 그것
        5. NULL (전체/다중 시스템 질문)
    → _append_message 시 system_id 컬럼 채워서 chat_messages 저장

[통계 조회]
관리자 → GET /api/v1/chat/statistics?from=&to=&group_by=system
  → chat_messages JOIN systems
  → GROUP BY system_id 집계
  → [{ system_id, system_name, session_count, message_count, top1_avg_score }]

[소프트 삭제]
DELETE /api/v1/chat/sessions/{id}
  → UPDATE chat_sessions SET deleted_at = NOW()
  → GET /sessions / messages / _ensure_owner 모두 deleted_at IS NULL 필터
  → 첨부 파일은 영구 보존 (데이터 보존 원칙)
```

---

## 게스트 챗봇 24시간 이전 대화 이어가기 흐름 (ADR-016)

```
[프론트엔드 — 사용자 진입]
사용자가 /chat/guest 진입 → HelpVisitorForm
  → 사번/이메일 입력 → submit 핸들러 진입
    → loadCache() (lib/guestSessionCache.ts)
      → localStorage 'synapse-guest-recent' 읽음
      → expires_at <= now 이면 wipeCache() + null 반환
      → 손상 JSON 이면 wipeCache() + null
    → cache.visitor_employee_id !== 입력 사번 이면 wipeCache() (사번 변경 wipe)
  → helpApi.createSession() 호출 → HelpSessionResponse 반환
  → onSuccess(session) → handleSessionCreated()
    → loadCache() 재확인
      → 사번 일치 + sessions.length >= 1
        → setCachedSessions(cache.sessions) + setPhase('recent_sessions')
      → 그 외 → setPhase('system_select') (기존 흐름)

[recent_sessions phase — GuestRecentSessions 컴포넌트]
사용자가 카드 N개 중 하나 클릭
  → handleResume(sessionId)
    → helpApi.getMessages(sessionId, employee_id)
      → GET /api/v1/help/sessions/{id}/messages?employee_id=...
      → 백엔드: _get_help_session() (area='help_inquiry' + deleted_at IS NULL)
      → visitor_employee_id == query.employee_id 검증 (불일치 403)
      → chat_messages 시간순 반환
    → setMessages(restored)
    → setSession({ session_id, employee_id, system_id })
    → setSelectedSystemIds(meta.system_ids)
    → setPhase('chat')

또는 "새 대화 시작" 클릭 → setPhase('system_select')
또는 "기록 모두 삭제" 클릭 → wipeCache() + setPhase('system_select')

[chat phase — 메시지 활동 시 캐시 동기화]
handleSend(content)
  → user 메시지 setMessages prepend
  → addOrUpdateSession(employee_id, {
      session_id, title (첫 메시지 30자), created_at,
      last_message_at: now, system_ids
    })
    → expires_at = now + 24h 갱신
    → 같은 session_id 있으면 last_message_at만 갱신, title 보존
    → MAX_SESSIONS=5 초과 시 가장 오래된 last_message_at 항목 제거
  → streamGuestMessage SSE → handleEvent

[chat phase — 수동 wipe]
헤더 우측 "기록 삭제" 클릭 → handleWipeAll()
  → wipeCache() + setCachedSessions([]) + setPhase('system_select')

[보안 모델]
- session_id (UUID v4, 122-bit) = 1차 시크릿 — 추측 불가
- visitor_employee_id 매칭 = 감사 로그 기록 + 추가 안전망
- localStorage 메타만 보관 (메시지 본문은 백엔드 GET) — XSS 표면 축소
- 24h 만료 + 사번 변경 wipe = 공용 PC 시나리오 격리
```
