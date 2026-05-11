---
name: warn-excessive-parallel-agents
enabled: true
event: stop
pattern: .*
---

⚠️ **병렬 Agent 배치 상한 자가 점검**

이번 턴에 `Agent` 툴을 **4회 이상** 호출했다면 CLAUDE.md 규칙 위반이다.

**규칙 (CLAUDE.md — [일반] 병렬 Subagent 배치 상한):**
- 한 턴에 Agent 툴 호출 **최대 3개**
- 이유: 에이전트마다 현재 컨텍스트를 독립 복사 → 입력 토큰 × N 배 소모

**초과했다면 다음 턴부터 체인 방식으로 분리:**
- [A, B, C] spawn → 완료 확인 → [D, E, F] spawn → 완료 확인 → [G, H] spawn

❌ 금지: 10개 작업을 한 메시지에서 한꺼번에 spawn
✅ 허용: 최대 3개씩 배치 분리
