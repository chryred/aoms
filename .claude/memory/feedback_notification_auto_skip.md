---
name: feedback-notification-auto-skip
description: notification_auto skip 로직 설계 원칙 — _has_definite_real_error 가드 제거, RRF 점수 기준 상위 3건 사용
metadata:
  type: feedback
---

Qdrant RRF 점수 상위 3건(`similar_all[:3]`)으로 `is_notification=True` 포인트를 감지하면 LLM을 생략하는 방식이 맞다.

**Why:** timestamp 정렬 방식(`recent_candidates`)으로 변경했다가 regression 발생 — 매 5분 사이클마다 새 warning 포인트가 쌓이면서 notification 포인트가 top-3 timestamp에서 밀려나 영구 불능 상태가 됨. `_has_definite_real_error` 가드는 synapse_agent의 `{at com.xxx}` 포맷(스택트레이스 압축)을 오탐해 notification_auto를 막는 문제가 있었음 → 가드 자체를 제거.

**How to apply:** `analyze_with_vector_context`에서 notification_auto 조건은 `similar_all[:3]` 순회, `_has_definite_real_error` 같은 콘텐츠 기반 가드 추가 금지.
