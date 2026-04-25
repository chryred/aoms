# Synapse-V 한국어 RAG 평가셋 & 스크립트

Synapse-V 챗봇 RAG 검색 품질을 정량 측정하기 위한 한국어 평가셋과 실행 스크립트.
**reranker 도입 전후 A/B 비교 baseline**으로 사용한다.

## 디렉터리 구조

```
docs/rag-eval/
├── README.md                  # 이 문서
├── korean-eval-set.json       # 한국어 평가 query 36문항
└── results/                   # 실행 결과 JSON (커밋 가능)
    └── .gitkeep
scripts/
└── eval_rag.py                # 평가 실행 스크립트 (표준 라이브러리 + httpx)
```

## 빠른 실행

```bash
# log-analyzer 가 실행 중이어야 함 (make run-analyzer)
python scripts/eval_rag.py \
    --eval-set docs/rag-eval/korean-eval-set.json \
    --endpoint http://localhost:8000/incident/search \
    --top-k 10
# 결과: docs/rag-eval/results/eval_<YYYYmmdd_HHMMSS>.json + 콘솔 표
```

전체 옵션은 `python scripts/eval_rag.py --help`.

## 평가셋 구조 (`korean-eval-set.json`)

각 query 객체는 다음 필드를 가진다.

| 필드 | 설명 |
|---|---|
| `id` | `{category-prefix}-{NNN}` 형식. `ops`, `incident`, `policy`, `metric`, `biz`, `mixed`, `ambig` |
| `category` | 운영절차 / 장애대응 / 정책 / 메트릭 / 비즈니스 / cross-lingual / 모호질의 |
| `query` | 사용자가 챗봇에 물을 자연어 질문 |
| `expected_keywords` | 정답 문서에 반드시 포함될 키워드. **lowercase 비교** — 한 개라도 hit 텍스트에 있으면 정답으로 판정 |
| `expected_doc_hints` | 사람이 검수할 때 참고할 정답 문서 힌트 (스크립트는 사용하지 않음) |
| `language` | `ko` / `mixed` (한·영 혼용) |
| `query_length` | `short`(<10자) / `medium`(10~30자) / `long`(30자 초과) |

### 카테고리 분포 (현재 36문항)

| 카테고리 | 개수 | 의도 |
|---|---|---|
| 운영절차 (ops) | 8 | 배치, POS, 백업, 마감, 배포 등 일상 운영 절차 |
| 장애대응 (incident) | 8 | DB/메모리/디스크/네트워크/WAS 장애 진단·복구 |
| 정책 (policy) | 6 | VIP, 환불, 회원 탈퇴, 쿠폰, 휴면회원 |
| 메트릭 (metric) | 4 | CPU/메모리/네트워크/디스크 임계치 |
| 비즈니스 (biz) | 4 | 멤버십, 영업시간, 주차, 선물포장 |
| cross-lingual (mixed) | 4 | "payment timeout", "DB connection pool" 등 한·영 혼용 |
| 모호질의 (ambig) | 2 | "이거 왜 그래요?", "결제 안 됨" 식 짧은·모호 질의 |

### 새 query 추가 가이드

1. `id`는 카테고리 prefix + 3자리 일련번호. 기존 ID와 중복 금지.
2. `expected_keywords`는 **검색 결과 텍스트에 실제로 등장할 단어**로 작성한다.
   - 너무 일반적이면 false positive (예: `["오류"]` → 거의 모든 문서가 정답으로 잡힘)
   - 너무 specific 하면 false negative (예: 정답 문서에 한 번도 안 나오는 합성어)
   - 2~4개가 적절. lowercase 비교이므로 영어는 소문자로 작성.
3. `query_length` 분포가 한쪽으로 치우치지 않게 — short/medium/long 균형 유지.
4. 실제 운영자 어조 사용. 학술적·로봇적 문장 지양.
5. 추가 후 `python scripts/eval_rag.py --help` 가 정상 동작하는지만 확인하면 충분 (스크립트는 추가 변경 불필요).

## 메트릭 정의

| 메트릭 | 정의 | 양호 기준(권장) |
|---|---|---|
| **Recall@5** | 정답이 top-5 안에 1건이라도 있는 query 비율 | ≥ 0.70 |
| **Recall@10** | 정답이 top-10 안에 1건이라도 있는 query 비율 | ≥ 0.85 |
| **MRR** | Σ(1/rank_first_relevant) / N. 정답이 위에 있을수록 높음 | ≥ 0.50 |
| **NDCG@5** | 이진 relevance 가정의 NDCG. 상위 ranking 품질 | ≥ 0.55 |

> **이 임계값은 reranker 미도입 baseline 권장값**이다. 운영 실측치가 누적되면 프로젝트 컨벤션에 맞춰 재조정한다.

### 메트릭 해석 팁

- Recall@10 은 높은데 Recall@5 가 낮다 → **top-5 ranking 품질 문제**. reranker 도입 효과가 큰 영역.
- Recall@10 자체가 낮다 → **임베딩 recall 문제**. Hybrid 검색 가중치, BM25 인덱스, 쿼리 확장 검토.
- 카테고리별 큰 격차(예: 정책 0.9 vs 장애대응 0.4) → 도메인 데이터 불균형. 부족한 카테고리 문서 추가 인덱싱.
- NDCG@5 가 Recall@5 보다 현저히 낮다 → 정답이 5위 안엔 들지만 1~2위가 아님. reranker 효과 확실.

## A/B 워크플로 (reranker 전후)

```bash
# 1. baseline 측정 (현재 RRF 기준)
python scripts/eval_rag.py \
    --output docs/rag-eval/results/baseline_rrf.json

# 2. reranker 도입 — log-analyzer 검색 로직에 reranker 적용
git checkout -b feat/reranker
# (코드 변경 — Cohere rerank, BGE reranker, ColBERT 등)

# 3. 변경 후 측정
python scripts/eval_rag.py \
    --output docs/rag-eval/results/reranker_v1.json

# 4. JSON 결과 비교
python -c "
import json
b = json.load(open('docs/rag-eval/results/baseline_rrf.json'))['summary']['overall']
r = json.load(open('docs/rag-eval/results/reranker_v1.json'))['summary']['overall']
for k in ('recall@5','recall@10','mrr','ndcg@5'):
    delta = r[k] - b[k]
    sign = '+' if delta >= 0 else ''
    print(f'{k:<12} baseline={b[k]:.4f}  reranker={r[k]:.4f}  ({sign}{delta:.4f})')
"
```

결과 JSON은 **commit 권장**. 커밋 히스토리로 검색 품질 추이 추적 가능.

## 운영 데이터로 평가셋 누적

운영 중 챗봇 사용 로그(`chat_messages` 테이블)에서 **검색 품질이 낮았던 질의**를 자동으로 후보 추출:

```sql
-- rag_top1_score 가 낮아 검색이 약했던 질의 (last 7 days)
SELECT id, content, rag_top1_score, created_at
FROM chat_messages
WHERE role = 'user'
  AND rag_top1_score IS NOT NULL
  AND rag_top1_score < 0.030
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY rag_top1_score ASC
LIMIT 50;
```

후보 라벨링 절차:
1. 운영자가 chat 내역을 검토해 "검색이 도움됐어야 하는 질의"를 골라낸다.
2. 정답이 되어야 할 문서를 직접 확인하고 `expected_keywords` 를 작성한다.
3. `korean-eval-set.json` 의 `queries` 배열에 추가 (id 충돌 주의).
4. 다음 평가 실행에 자동 반영된다.

> 운영 데이터를 평가셋에 추가할 때는 **개인정보(고객명, 카드번호, 사번 등) 마스킹**을 반드시 거쳐야 한다.

## 매칭 한계와 향후 개선

현재 매칭은 `expected_keywords` lowercase 부분문자열 매칭이다. 다음과 같은 한계가 있다:

- **False positive**: 키워드가 무관한 문서에 우연히 등장 → recall 과대평가.
- **False negative**: 정답 문서가 동의어를 사용 → recall 과소평가.

향후 개선 방향:

1. **정답 doc id 기반 매칭** — `expected_doc_ids: ["log_inc_123", "kb_456"]` 필드로 교체. Qdrant point id 라벨링 필요.
2. **사람 라벨 기반 NDCG (graded relevance)** — 0/1 이 아니라 0~3 점수로 라벨링.
3. **LLM-as-judge** — 검색 결과를 LLM 에 보여주고 "정답인가?" 판정. cost trade-off 필요.

## 절대 하지 말 것

- 평가 데이터에 **실제 운영 정보** (실제 사번, 비밀번호, IP, 카드번호 등) 포함 금지.
- 코드 변경 (admin-api / log-analyzer / frontend) — 평가 인프라만 다룬다.
- 외부 의존성 추가 금지 — `httpx` + 표준 라이브러리만 사용.
