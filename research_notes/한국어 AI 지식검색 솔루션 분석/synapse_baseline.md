# Synapse 지식 자산화·검색 스택 현황 (코드베이스 baseline, 2026-10-19 기준)

> 출처 표기 규칙: 모든 경로는 리포 루트 `/Users/youwonji/workspace/ai/aoms` 기준 상대경로이며 `파일:줄번호`로 표기한다. "문서"는 CLAUDE.md/memory 기재 내용, "코드"는 실제 구현 확인 내용이다. 둘이 어긋나는 경우는 명시했다. 웹 리서치는 하지 않았고, fastembed 동작은 설치된 venv 패키지(fastembed 0.8.0) 소스를 읽고 직접 실행해 확인했다.

## Q1. Qdrant 컬렉션 9종 — 저장 내용, 청킹, payload, 시스템 필터 정책

### Takeaway
Qdrant 컬렉션은 9개다. 모두 Dense 1024(cosine, HNSW m=16/ef_construct=200) + Sparse(BM25, `modifier: idf`) 스키마로 만들어진다. 운영 분석 계열 5종은 자동 생성된 이상 이력과 LLM 요약을, Knowledge 계열 4종은 Jira·Confluence·업로드 문서·운영자 노트·가이드를 담는다. 시스템 필터는 컬렉션마다 다르게 걸리는데, 특히 Jira/Confluence는 V1 정책상 시스템 필터가 아예 없다.

### Cited Findings
- 컬렉션 스키마 공통: `dense` size=1024, Cosine, HNSW `{"m":16,"ef_construct":200,"ef":128}`, sparse `{"modifier":"idf"}` (BM25 IDF는 Qdrant 서버가 계산) — [main-server/services/log-analyzer/vector_client.py:401-410](main-server/services/log-analyzer/vector_client.py), 생성 로직 `ensure_collection` — [vector_client.py:418-452](main-server/services/log-analyzer/vector_client.py)
- 9개 컬렉션 표(저장 주체·필터·내용) — [main-server/CLAUDE.md:132-154](main-server/CLAUDE.md)
  - `log_incidents`: 로그 분석 이상 이력, 필터 `system_name`. 임베딩 입력은 **정규화된 로그 template**(TS/IP/UUID/URL/값 마스킹, 400자 상한)이다 — [vector_client.py:155-212](main-server/services/log-analyzer/vector_client.py), [analyzer.py:315-326](main-server/services/log-analyzer/analyzer.py). payload: `system_name, instance_role, severity, log_pattern[:500], error_category, root_cause, recommendation, occurrence_count, resolved, is_notification` 등 — [vector_client.py:717-728](main-server/services/log-analyzer/vector_client.py). point_id는 UUID5 결정적 키 `template_point_id(system, role, normalized_template)` — [vector_client.py:226](main-server/services/log-analyzer/vector_client.py)
  - `metric_baselines`: 메트릭 알림 이상 이력, 필터 `system_name`+`metric_name`. 메트릭 상태를 자연어로 바꾼 텍스트를 임베딩한다 (`build_metric_description`) — [vector_client.py:963-1013](main-server/services/log-analyzer/vector_client.py)
  - `incident_postmortems`: 인시던트 피드백이 승인될 때 저장. 서사 = `title | system_name | 심각도 | alert_excerpts | root_cause | solution | ocr_text`를 `" | "`로 이어붙인 문자열 — [vector_client.py:1194-1238](main-server/services/log-analyzer/vector_client.py). 필터는 `system_id` IN list
  - `metric_hourly_patterns`: 1시간 집계 LLM 분석 패턴. 문서상으로는 Dense 전용 — [.claude/memory/adrs.md:311](.claude/memory/adrs.md). 반면 main-server/CLAUDE.md는 "모두 Hybrid"라고 적고 있어 서로 다르다(불확실, 아래 Gaps 참조)
  - `aggregation_summaries`: 일/주/월/분기/반기/연간 리포트 요약, 필터 `system_name` — [main-server/services/log-analyzer/CLAUDE.md "aggregation_summaries 스케줄러별 system_name 보존 현황"](main-server/services/log-analyzer/CLAUDE.md)
  - `knowledge_guides`: 운영 가이드. 1500자 청크, overlap 200 — [guides_vector_client.py:63-64](main-server/services/log-analyzer/guides_vector_client.py). 임베딩 입력은 `title\n[section_heading\n]chunk_text` — [guides_vector_client.py:226-233](main-server/services/log-analyzer/guides_vector_client.py). 필터는 `system_id IN list OR system_id IS NULL`(NULL은 공용 가이드) — [guides_vector_client.py:445-449](main-server/services/log-analyzer/guides_vector_client.py). point_id는 `sha256("guide:{id}:{chunk_index}")[:8]` — [guides_vector_client.py:124](main-server/services/log-analyzer/guides_vector_client.py)
  - `knowledge_jira_issues`: **이슈 1건 = 1포인트(청킹 없음)**. payload 인덱스 `project, status, system_name` — [knowledge_vector_client.py:46](main-server/services/log-analyzer/knowledge_vector_client.py). 임베딩 텍스트는 `[project] title` + 담당자/관계사/시스템/유형/장애개요 등 메타 라벨 + description + `[장애원인]/[조치사항]/[해결방안]/[처리사항]` + comments 순서로 이어붙인다 — [knowledge_vector_client.py:203-249](main-server/services/log-analyzer/knowledge_vector_client.py)
  - `knowledge_confluence_pages`: H2/H3 섹션 단위로 자르고, 큰 섹션은 1500자 sliding window로 다시 나눈다. 임베딩은 `section_heading\nraw_text` — [knowledge_vector_client.py:393-434](main-server/services/log-analyzer/knowledge_vector_client.py)
  - `knowledge_documents`: 업로드 문서 청크 + 운영자 노트(`doc_type=operator_note`, 임베딩 `Q: ...\nA: ...`). payload 인덱스 `doc_type, system_id, tags, stored_at` — [knowledge_vector_client.py:48](main-server/services/log-analyzer/knowledge_vector_client.py), [knowledge_vector_client.py:466-609](main-server/services/log-analyzer/knowledge_vector_client.py)
- 시스템 필터 정책: Jira/Confluence는 "Jira 프로젝트가 시스템과 1:1로 대응하지 않고, bge-m3 임베딩이 시스템 키워드를 변별한다"는 이유로 필터를 걸지 않는다. 코드에서도 `system_name`을 받기는 하지만 의도적으로 무시한다 — [main-server/services/log-analyzer/CLAUDE.md "컬렉션별 시스템 필터 정책"](main-server/services/log-analyzer/CLAUDE.md), [knowledge_vector_client.py:1115-1117, 1145-1151](main-server/services/log-analyzer/knowledge_vector_client.py)
- 텍스트 payload 절단: Confluence/문서 `text[:2000]`, Jira `description[:2000]`, `comments[:10]` — [knowledge_vector_client.py:260-262, 429, 513](main-server/services/log-analyzer/knowledge_vector_client.py)

### Inferences
- `log_incidents`에는 정규화된 로그 문자열이 임베딩된다. 챗봇 사용자는 자연어 한국어로 묻기 때문에 질의와 문서의 표현 공간이 다르다. 그래서 장애 이력 검색에서는 의미 매칭이 약할 가능성이 높다(아래 Q7의 baseline 결과와 들어맞는다).
- Jira는 이슈 하나를 통째로 하나의 벡터로 만든다. 임베딩 입력은 3000자에서 잘린다(Q2 참조). 이 때문에 description이 긴 이슈는 뒤쪽에 붙는 `[장애원인]/[해결방안]`이 임베딩에 들어가지 못할 수 있다.

### Gaps
- `metric_hourly_patterns`가 실제로 Dense 전용인지 Hybrid인지 이번 조사에서는 `aggregation_vector_client.py`의 `ensure_collection(..., hybrid=?)` 호출을 직접 확인하지 못했다. ADR-011과 main-server/CLAUDE.md의 기술이 서로 다르다.

## Q2. 임베딩·검색 파이프라인 — 한국어 BM25 토크나이징, RRF, reranker, 임계값, top-k, 질의 전처리

### Takeaway
Dense는 bge-m3 ONNX(1024차원, 3000자 절단)이고 품질이 좋다. 문제는 Sparse다. `Qdrant/bm25`는 **영어 Snowball 스테머와 공백·`\W` 기반 SimpleTokenizer**를 쓴다. 그래서 한국어는 형태소 분석 없이 어절 단위로 해시된다("배치가"≠"배치"). 융합은 Qdrant 내장 RRF(k=2)로 하고, Knowledge 3종은 그 위에 2차 RRF(k=60)와 corrected 보너스 +0.2를 더한다. reranker(bge-reranker-v2-m3 int8)는 챗봇 경로에서만 켜지고 점수 하한은 없다. 별도의 질의 전처리(rewrite/HyDE/형태소 분석)는 없고, ReAct LLM이 도구 인자로 넘기는 query가 사실상 유일한 재작성 단계다.

### Cited Findings
**Dense**
- `onnxruntime` + `tokenizers`로 `BAAI/bge-m3` ONNX를 직접 로드하고 `sentence_embedding` 출력(CLS+L2)을 쓴다. 출력이 없을 때는 CLS pooling으로 폴백한다 — [vector_client.py:287-309](main-server/services/log-analyzer/vector_client.py)
- `_EMBED_MAX_CHARS = 3000` 문자 절단은 dense와 sparse 모두에 적용된다 — [vector_client.py:282-290, 312-313](main-server/services/log-analyzer/vector_client.py)
- FastEmbed TextEmbedding이 bge-m3를 지원하지 않아 onnxruntime 직접 호출을 택했다. 2-core 실측은 Dense 35~90ms, Hybrid query 36ms — [.claude/memory/adrs.md:292-297](.claude/memory/adrs.md)
- 임베딩 전용 executor는 워커 2개(`EMBED_EXECUTOR_WORKERS`)이고 배치 청크 크기는 16 — [vector_client.py:364-390](main-server/services/log-analyzer/vector_client.py)

**Sparse(BM25), 한국어 처리 (직접 검증)**
- 사용 모델은 `SparseTextEmbedding("Qdrant/bm25")`이고 language 등 인자를 넘기지 않는다(기본값 그대로) — [vector_client.py:133-150](main-server/services/log-analyzer/vector_client.py)
- fastembed 0.8.0 `Bm25.__init__` 기본값: `language="english"`, `k=1.2`, `b=0.75`, `avg_len=256.0`, `token_max_length=40`. stopwords를 쓰고 `SnowballStemmer(language)`을 적용한다. 지원 언어 18개 목록에 **한국어가 없다** — `venv/lib/python3.11/site-packages/fastembed/sparse/bm25.py:25-44, 91-137`
- 토크나이저 `SimpleTokenizer.tokenize`는 `re.sub(r"[^\w]"," ", text.lower())` 후 공백으로 split한다 — `fastembed/sparse/utils/tokenizer.py` (SimpleTokenizer). 토큰 id는 `abs(mmh3.hash(token))` — `bm25.py` `compute_token_id`
- 직접 실행 결과(venv): `"결제 배치가 실패했습니다"` → `['결제','배치가','실패했습니다']`, `"결제배치 실패"` → `['결제배치','실패']`, `"DB connection pool 고갈 ORA-00060"` → `['db','connection','pool','고갈','ora','00060']`. 영어 스테머는 한국어 어절을 그대로 둔다(`'결제가'→'결제가'`, `'failed'→'fail'`). 정리하면 **조사·어미가 붙은 어절이 각각 다른 토큰이 되고, 복합명사 띄어쓰기 차이("결제배치" vs "결제 배치")도 매칭되지 않는다.**
- 코드베이스·문서 어디에도 kiwi/mecab/형태소 분석기 사용 흔적이 없다(전체 grep 0건). 유일한 언급은 사용자 메모리의 "Korean BM25 형태소(kiwi) 보류" — `~/.claude/projects/-Users-youwonji-workspace-ai-aoms/memory/project_v2_direction.md`
- **질의 쪽 sparse도 문서용 `embed()`로 만든다.** fastembed는 BM25 질의용 `query_embed()`(토큰별 가중치 1.0)를 따로 제공하지만 코드는 `model.embed([text])`만 호출한다. 그 결과 질의 벡터에도 문서 길이 정규화가 들어간 TF 가중치가 실린다 — [vector_client.py:312-326](main-server/services/log-analyzer/vector_client.py), 질의 호출부 예: [knowledge_vector_client.py:1123-1126](main-server/services/log-analyzer/knowledge_vector_client.py), [guides_vector_client.py:412](main-server/services/log-analyzer/guides_vector_client.py), [main.py:399](main-server/services/log-analyzer/main.py). fastembed 쪽 정의는 `bm25.py` `query_embed` 주석 "we don't need to use weights in the query"
- ADR-011이 내세운 Hybrid의 효과는 "에러 클래스명(NullPointerException, ORA-00060) 정확 매칭"이다. 즉 sparse는 영문·코드 토큰을 겨냥한 설계였다 — [.claude/memory/adrs.md:332](.claude/memory/adrs.md)

**융합(RRF)과 임계값**
- 1차(컬렉션 내): `/points/query`에 `prefetch` 2개(dense `limit*3`·`score_threshold=dense_prefetch_threshold`(기본 0.5), sparse `limit*3`·임계값 없음)를 넣고 `fusion: rrf` — [vector_client.py:473-518](main-server/services/log-analyzer/vector_client.py)
- Qdrant RRF는 `DEFAULT_RRF_K=2`, 점수 `1/(rank0+2)`, 상한 1.0. #1+#1=1.0, #1+#2=0.833, 한쪽만 1위면 0.5 — `~/.claude/projects/.../memory/reference_qdrant_rrf_scale.md` (원 출처: qdrant `lib/segment/src/common/reciprocal_rank_fusion.rs`. 이번 조사에서 직접 확인하지는 않음)
- 자동 분류 임계값: `classify_anomaly` duplicate 0.8 / recurring 0.5 / related 0.3 (RRF k=2), 알림성 인식 tier-2는 dense 단독 cosine 0.9, 재분류 일괄 반영 `find_similar_incidents`도 cosine 0.9 — [main-server/services/log-analyzer/CLAUDE.md "임계값 정리"](main-server/services/log-analyzer/CLAUDE.md), [vector_client.py:624-650, 773-819, 913](main-server/services/log-analyzer/vector_client.py)
- 2차(Knowledge federated): 소스별 순위로 `1/(60+rank+1)`을 매기고 소스 가중치를 곱한다(documents 2.0, jira 1.0, confluence 1.0, env로 조정 가능). 이어서 **corrected=True 항목에 +0.2**를 더하고 다시 정렬한다 — [knowledge_vector_client.py:50-59, 1040-1072, 1174-1183](main-server/services/log-analyzer/knowledge_vector_client.py)
- 질의 하나에서 나온 dense/sparse 벡터를 3개 컬렉션에 똑같이 쓰고, `asyncio.gather`로 병렬 검색한다 — [knowledge_vector_client.py:1121-1170](main-server/services/log-analyzer/knowledge_vector_client.py)

**top-k / over-fetch**
- `/knowledge/search`: rerank를 켜면 소스당 `max(ceil(rerank_top_k/n)*2, limit*2)`, 끄면 `limit*2` — [knowledge_vector_client.py:1131-1138](main-server/services/log-analyzer/knowledge_vector_client.py)
- `/incident/search`: rerank를 켜면 `limit*4`를 가져온 뒤 log와 metric을 합쳐 rerank한다 — [main.py:407-467](main-server/services/log-analyzer/main.py)
- `/guides/search` (그룹 모드): `min(limit*10,100)`개 청크를 가져오고 prefetch는 그 3배. 이후 guide_id 단위로 그룹화한다 — [guides_vector_client.py:416-431](main-server/services/log-analyzer/guides_vector_client.py)
- 챗봇 도구는 전부 `limit = min(args.limit or 5, 10)` — [admin-api/services/chat_tools/executors/qdrant.py:52, 128, 187, 249, 291, 354](main-server/services/admin-api/services/chat_tools/executors/qdrant.py)

**Reranker**
- 모델 bge-reranker-v2-m3(XLM-R large 계열, 568M), ONNX CPU, 쌍 입력 max_length 512 토큰, 문자 컷 3000 — [reranker.py:1-40, 121-160](main-server/services/log-analyzer/reranker.py)
- 운영은 `onnx/model_int8.onnx`(~544MB)를 쓴다(Dockerfile·compose의 env로 지정). 코드 기본값은 `onnx/model.onnx` — [main-server/services/log-analyzer/CLAUDE.md "RERANKER_ONNX_FILE"](main-server/services/log-analyzer/CLAUDE.md), [reranker.py:32](main-server/services/log-analyzer/reranker.py). reranker.py docstring에는 아직 "FP32, 정확도 손실 0%"라고 적혀 있다 — [reranker.py:1-11, 113](main-server/services/log-analyzer/reranker.py)
- **점수 하한(threshold)이 없다.** raw logit으로 정렬한 뒤 top_k만 자른다. 추론이 실패하면 원래 순서를 그대로 돌려준다 — [reranker.py:165-210](main-server/services/log-analyzer/reranker.py)
- Knowledge 쪽 rerank 후보는 상한 `RERANKER_CANDIDATE_CAP=20`, 타임아웃 20초. 후보 텍스트는 payload의 `title/page_title/text/description/question/answer/log_pattern`을 각각 500자로 잘라 `" | "`로 잇는다. **`correction_text`는 후보 텍스트에 들어가지 않는다** — [knowledge_vector_client.py:1185-1216](main-server/services/log-analyzer/knowledge_vector_client.py)
- 자동 분석 파이프라인(알림 분류)에는 reranker를 쓰지 않는다 — [main-server/services/log-analyzer/CLAUDE.md "Reranker"](main-server/services/log-analyzer/CLAUDE.md)
- int8 파일이 볼륨에 없으면 경고 로그만 남기고 rerank 없이 동작한다(장애로 드러나지 않음) — 같은 문서

**질의 전처리**
- 검색 엔드포인트는 `req.query` 원문을 그대로 임베딩한다. 정규화·동의어·rewrite·HyDE가 없다 — [main.py:399](main-server/services/log-analyzer/main.py), [knowledge_vector_client.py:1123-1126](main-server/services/log-analyzer/knowledge_vector_client.py)
- 챗봇에서는 ReAct decision LLM이 도구 `args.query`를 직접 만든다. 그래서 사용자 원문이 LLM을 거쳐 재서술된 형태로 들어갈 수는 있다. 다만 이를 지시하는 프롬프트 규칙은 없다 — [admin-api/services/prompts.py:119-154](main-server/services/admin-api/services/prompts.py)

### Inferences
- 한국어 질의에서 BM25 매칭은 사실상 "어절 문자열이 완전히 같을 때"만 일어난다. 그래서 sparse는 영문 에러코드나 고유명사에만 기여하고, 한국어 의미 매칭은 거의 dense가 떠맡는다. 그런데 RRF는 순위만 보고 섞기 때문에, 엉뚱한 sparse 순위가 그대로 융합 점수에 들어간다(노이즈).
- dense prefetch는 cosine 0.5 이상만 통과시키고 sparse는 임계값이 없다. 따라서 dense 후보가 0건이어도 sparse 결과만으로 RRF 결과가 나올 수 있다(한쪽 1위 = 0.5점).
- 2차 RRF(k=60) 점수는 최대 약 2.0/61 ≈ 0.033이다. 여기에 corrected 보너스 +0.2가 붙으면 **교정된 항목이 질의 관련성과 상관없이 거의 항상 최상위로 올라온다.** reranker를 켜면 rerank가 다시 정렬하지만, 후보 20개 컷에는 corrected 항목이 반드시 들어간다.
- 질의 sparse를 `embed()`로 만드는 문제는 BM25 표준(질의 가중치 1.0)과 다르다. 다만 RRF가 순위 기반이라 영향은 제한적일 수 있다(정량 미검증, 불확실).

### Gaps
- 운영 환경에서 sparse가 RRF 결과에 실제로 얼마나 기여하는지(Track C `with_scores` 디버그 출력 기반) 실측 데이터는 찾지 못했다.
- 쿼리 언어별 sparse hit 비율 같은 지표는 수집되지 않는다.

## Q3. 지식 수집(Ingestion) 경로

### Takeaway
수집 경로는 일곱 가지다. ① Jira 일일 증분 동기화(이슈 단위, 첨부는 파일명만) ② Confluence 일일 증분 동기화(섹션 청킹, 페이지 단위 delete→upsert) ③ 문서 업로드(PDF/DOCX/XLSX/PPTX/TXT/MD, 1500/200 청킹 + Tesseract kor+eng OCR) ④ 운영자 Q&A 노트 ⑤ 운영 가이드(draft/published) ⑥ 인시던트 피드백 승인 → postmortem 임베딩 ⑦ 로그·메트릭·집계의 자동 축적. HWP는 지원하지 않는다.

### Cited Findings
- **Jira**: 매일 04:00 KST 실행. JQL은 `project = X AND issuetype not in (subTaskIssueTypes()) AND updated >= "YYYY-MM-DD" ORDER BY updated ASC`(날짜 단위 증분), 요청은 Semaphore(1)로 직렬화 — [scheduler_tasks.py:383-470](main-server/services/log-analyzer/scheduler_tasks.py). 첨부는 `filename`만 저장하고 본문 OCR은 하지 않는다 — [scheduler_tasks.py:350](main-server/services/log-analyzer/scheduler_tasks.py). 커스텀 필드(장애개요/원인/조치/해결방안, SR통계 필드 등) 매핑 — [knowledge_vector_client.py:133-195](main-server/services/log-analyzer/knowledge_vector_client.py), 필드 ID 표는 `.claude/memory/jira-field-mapping.md`
- **Confluence**: 매일 04:30 KST 실행. CQL은 `space = X AND type = page AND lastModified >= ...`, `expand=body.storage,space,version` — [scheduler_tasks.py:494-546](main-server/services/log-analyzer/scheduler_tasks.py). 페이지마다 `delete_confluence_chunks_by_page_id` 후 upsert — [scheduler_tasks.py:559-590](main-server/services/log-analyzer/scheduler_tasks.py). version을 받아오지만 payload에는 저장하지 않는다 — [knowledge_vector_client.py:425-434](main-server/services/log-analyzer/knowledge_vector_client.py)
- **삭제 감지**: 매주 일요일 03:00(Jira) / 03:30(Confluence)에 원본에서 사라진 항목을 Qdrant에서 purge하고, dry_run을 지원한다 — [scheduler_tasks.py:635-1050](main-server/services/log-analyzer/scheduler_tasks.py), [main-server/services/log-analyzer/CLAUDE.md 스케줄러 표](main-server/services/log-analyzer/CLAUDE.md)
- **문서 업로드**: 허용 MIME은 pdf/docx/xlsx/pptx/text/plain/markdown — [admin-api/routes/knowledge.py:45-55](main-server/services/admin-api/routes/knowledge.py). file_hash는 `sha256(file_name:doc_type:첫 청크 200자)[:16]`이고, 같은 hash로 다시 올리면 기존 청크를 지운 뒤 새로 적재한다 — [knowledge_vector_client.py:485-493](main-server/services/log-analyzer/knowledge_vector_client.py)
- **청킹**: `chunk_text(max_chars=1500, overlap=200, min_chars=50)`. 경계는 단락(`\n\n`) → 줄바꿈(`\n`) → 공백 순으로 되돌아가며 찾는다 — [chunking.py:30-89](main-server/services/log-analyzer/chunking.py). XLSX는 시트 하나, PPTX는 슬라이드 하나를 한 청크로 만들고, 6500자를 넘으면 헤더나 제목을 복사해 분할한다 — [chunking.py:25](main-server/services/log-analyzer/chunking.py), [main-server/services/log-analyzer/CLAUDE.md "포맷별 전략"](main-server/services/log-analyzer/CLAUDE.md). 청크는 의미 단위가 아니라 문자 수 기준이다
- **OCR**: Tesseract `lang="kor+eng"`, 이미지당 timeout 3초. 10자 미만이거나 정상 문자 비율이 70% 미만이면 버린다. 결과는 `[이미지: ...]` 마커로 본문에 넣는다. PDF는 페이지당 이미지 10장까지 — [chunking.py:144-157, 428](main-server/services/log-analyzer/chunking.py), [ocr_worker.py:4](main-server/services/log-analyzer/ocr_worker.py). OCR 통계(attempted/succeeded/noise/failed)를 응답에 노출한다 — [main-server/services/log-analyzer/CLAUDE.md "OCR 통계 노출"](main-server/services/log-analyzer/CLAUDE.md). Vision LLM 교체 경로는 "향후 계획"으로만 언급돼 있다
- **운영자 노트**: `knowledge_documents`에 `doc_type=operator_note`로 저장. point_id는 `sha256(note:{question[:100]}:{created_at})`이므로 같은 질문을 다시 등록하면 **중복 포인트가 생긴다** — [knowledge_vector_client.py:126-128, 551-609](main-server/services/log-analyzer/knowledge_vector_client.py)
- **가이드**: 운영자가 직접 등록(POST)하면 published 상태로 즉시 인덱싱된다. 챗봇 도구 `admin_save_guide`는 항상 draft로 저장하고 인덱싱하지 않는다. publish/unpublish 시 인덱스를 추가하거나 삭제한다 — [main-server/services/admin-api/CLAUDE.md "Knowledge Guides"](main-server/services/admin-api/CLAUDE.md), 모델 `status` 컬럼 — [admin-api/models.py:677-694](main-server/services/admin-api/models.py). 인덱싱 시 보내는 값은 `guide_id, system_id, title, content`뿐이고 **`steps` JSONB·category·tags는 임베딩하지 않는다** — [admin-api/services/qdrant_guides.py:37-57](main-server/services/admin-api/services/qdrant_guides.py)
- **인시던트 피드백 → postmortem**: 승인하면 `root_cause=feedback.error_type`, `solution`, 알림 발췌 5건, 첨부 OCR 텍스트로 payload를 만들어 embed한다. 인시던트 하나에 point 하나를 유지하도록 기존 point_id를 재사용한다 — [admin-api/routes/incidents.py:690-745](main-server/services/admin-api/routes/incidents.py). 승인 후에는 관련 `log_incidents`/`metric_baselines` 포인트에 incident_id를 역으로 주입한다 — [admin-api/routes/incidents.py:61-81](main-server/services/admin-api/routes/incidents.py)
- **자동 축적**: 로그 template마다 결정적 id로 upsert(stored-wins)하고, 메트릭 신규 이상과 1시간·일·주·월 집계 LLM 요약도 저장된다 — [main-server/services/log-analyzer/CLAUDE.md "알림성 로그 자동 분류 흐름", "집계 처리 흐름"](main-server/services/log-analyzer/CLAUDE.md)

### Inferences
- 한국 기업 문서에서 비중이 큰 HWP/HWPX가 빠져 있어 실제 문서 커버리지에 공백이 생길 수 있다.
- Jira 첨부(스크린샷·로그 파일)와 Confluence 첨부 파일 본문은 색인되지 않는다. 이미지는 alt/filename 마커로만 남는다.
- 증분 기준이 날짜 단위라 같은 날 수정된 이슈는 매일 다시 처리된다(멱등 upsert라 정합성 문제는 없음).

### Gaps
- 문서 업로드 job 처리량과 실패율, 실제 적재 문서 수 등 운영 수치는 리포에 없다.

## Q4. 큐레이션·피드백 루프 — 있는 것과 없는 것

### Takeaway
있는 것: 가이드 draft→publish 승인, 인시던트 피드백 승인/반려/재등록(revision_count, 소프트 3 / 하드 5 리밋), 오답 교정(`knowledge_corrections` + Qdrant `corrected` 플래그), 알림 재분류와 유사 건 일괄 정보화, 자주 묻는 질문 클러스터링. 없는 것: 지식 버전 이력, 답변 유효성(👍/👎·해결 여부) 피드백, 중복 제거, 노후화(staleness) 관리, 소유자·검토주기. 그리고 교정 루프는 구조적 결함이 있다. **교정 텍스트가 검색 결과나 답변에 전달되지 않고, 재동기화하면 사라진다.**

### Cited Findings
- **오답 교정**: `POST /api/v1/knowledge/feedback`이 `knowledge_corrections`(question, wrong_answer, correct_answer, source_point_id, source_collection)에 INSERT하고, best-effort로 log-analyzer `/knowledge/correction`을 호출한다 — [admin-api/routes/knowledge.py:255-290](main-server/services/admin-api/routes/knowledge.py), 모델 [admin-api/models.py:619-634](main-server/services/admin-api/models.py)
- Qdrant 쪽은 `set_payload`로 `corrected=True, correction_text, corrected_at`만 병합한다. **다시 임베딩하지 않는다** — [knowledge_vector_client.py:614-638](main-server/services/log-analyzer/knowledge_vector_client.py)
- `correction_text`를 읽는 곳은 저장 코드뿐이다(전체 grep 결과 저장/전달 코드만 존재). 챗봇 도구 `_search_knowledge`의 결과 매핑은 `title/content(text|content|description)/score/...`만 내보내고 `correction_text`나 `corrected`는 빠져 있다 — [admin-api/services/chat_tools/executors/qdrant.py:315-335](main-server/services/admin-api/services/chat_tools/executors/qdrant.py)
- federated 검색은 corrected 항목에 +0.2를 준다 — [knowledge_vector_client.py:1177-1183](main-server/services/log-analyzer/knowledge_vector_client.py). 테스트 `test_corrected_item_promoted`가 이 승격을 검증한다 — [log-analyzer/tests/test_knowledge_vector_client.py:135](main-server/services/log-analyzer/tests/test_knowledge_vector_client.py)
- Jira 재동기화는 `PUT /points`로 전체 포인트를 upsert(payload 덮어쓰기)하고, Confluence와 문서 재업로드는 delete 후 insert한다 — [knowledge_vector_client.py:251-264, 452-460](main-server/services/log-analyzer/knowledge_vector_client.py), [scheduler_tasks.py:445-452, 579-586](main-server/services/log-analyzer/scheduler_tasks.py), [knowledge_vector_client.py:490-493](main-server/services/log-analyzer/knowledge_vector_client.py)
- **인시던트 피드백 승인 워크플로**: pending→approved/rejected. resubmit 시 `revision_count`가 늘고 `revision_reason`은 덮어쓴다. approved 상태에서 수정하면 Qdrant point를 삭제하고 재승인할 때 새로 만든다. 소프트 리밋 3에서 경고, 하드 리밋 5에서 409 — [main-server/services/admin-api/CLAUDE.md "피드백 등록 흐름 — Wave 2A"](main-server/services/admin-api/CLAUDE.md)
- **가이드 승인**: LLM 환각이 RAG를 오염시키지 않도록 챗봇이 저장한 가이드는 draft로 고정한다 — 같은 문서 "draft/publish 원칙 (P0-1)"
- **알림 재분류**: warning→info로 바꿀 때 유사한 실에러 후보(dense cosine 0.6 미리보기)를 보여주고, 사용자가 확인하면 일괄 정보화한다 — [main-server/services/admin-api/CLAUDE.md "LLM 분석 결과" 절](main-server/services/admin-api/CLAUDE.md)
- **자주 묻는 질문**: 최근 N일 사용자 질문을 bge-m3 cosine 0.80으로 클러스터링하고 centroid에 가장 가까운 질문을 대표로 고른다("한국어 의미 동치 질문은 0.78~0.83에 분포"라는 근거로 0.85에서 낮춤) — [admin-api/routes/knowledge.py:64-65, 340-361](main-server/services/admin-api/routes/knowledge.py)
- **품질 신호 수집**: `chat_messages.rag_top1_score`, `rag_sources_count`는 `qdrant_search_knowledge` 결과에서만 기록된다 — [admin-api/services/chat_agent.py:453-468](main-server/services/admin-api/services/chat_agent.py). 챗봇은 rerank=True가 기본이라 이 값은 대부분 **reranker raw logit**이다. 그런데 RAG 평가 README는 "rag_top1_score < 0.030"(k=60 RRF 스케일)을 저품질 질의 추출 SQL 기준으로 쓴다 — [docs/rag-eval/README.md "운영 데이터로 평가셋 누적"](docs/rag-eval/README.md)
- **지식 건강도 관련 필드**: payload에 `stored_at`이 있고 Jira에는 `updated_at`, `resolution_date`가 있다 — [knowledge_vector_client.py:263, 280-283](main-server/services/log-analyzer/knowledge_vector_client.py). 이 값들로 검색 시 감쇠(recency decay)를 하거나 오래된 지식을 걸러내는 로직은 코드에서 찾지 못했다
- 개선 아이디어 문서에 "해결책 검색: 재발 방지 효과 기반 정렬"이 미구현 아이디어로 남아 있다 — [docs/improve_idea.md:31](docs/improve_idea.md)

### Inferences
- 현재 교정 루프는 "교정된 문서를 상위로 올리지만, 교정 내용은 LLM에 전달하지 않는" 구조다. 사용자가 틀렸다고 지적한 원문 청크가 오히려 더 자주 근거로 쓰일 위험이 있다(코드상 추론, 운영 검증 안 됨).
- Jira/Confluence 항목에 대한 교정은 다음 동기화(Jira는 해당 이슈가 갱신될 때, Confluence는 페이지가 수정될 때) 때 payload가 덮어써지면서 사라진다. DB의 `knowledge_corrections` 이력은 남지만 Qdrant에 다시 적용하는 로직이 없다.
- 운영자 노트는 같은 질문이 중복 등록될 수 있고, 업로드 문서는 파일명이나 첫 200자가 바뀌면 다른 문서로 취급된다. 의미 기반 중복 제거는 어느 컬렉션에도 없다.
- 지식 버전 관리는 postmortem 재승인(삭제 후 재생성)과 Confluence 덮어쓰기 수준에 그친다. 이전 버전을 조회하거나 되돌릴 수 없다.

### Gaps
- 프론트엔드에 챗봇 답변 평가 버튼(👍/👎)이 있는지는 ChatMessage.tsx를 끝까지 확인하지 않았다(불확실). 백엔드 스키마에는 관련 컬럼이 보이지 않았다.

## Q5. 챗봇 RAG 도구와 출처(citation) 표시

### Takeaway
ReAct 챗봇(전체 47개 도구 중 qdrant 계열은 검색 6종 + 청크 조회 1종)이 질문 유형에 따라 도구를 고른다. 검색 결과가 부족하면 `qdrant_get_chunks`로 필요한 청크만 골라 가져오는 2단계 조회 패턴이 구현돼 있다. 반면 **답변 본문에 출처를 인용하는 규칙이 없고, UI도 도구 결과를 JSON 원문으로만 보여준다.** 문서 링크나 페이지 번호를 정리해 보여주는 출처 표시는 없다.

### Cited Findings
- 도구 목록과 라우팅 가이드(장애 이력 → `qdrant_search_incident_knowledge`, 사후분석 → `..._postmortem`, 매뉴얼/Jira/Confluence → `qdrant_search_knowledge`, 사용법 → `qdrant_search_guide`, 집계 → `..._aggregation_summary`/`..._hourly_patterns`) — [admin-api/services/prompts.py:56-73](main-server/services/admin-api/services/prompts.py)
- 청크 보강 규칙: `chunk_indexes`를 반드시 명시하고 1~3개만 가져오도록 한다. 호출 조건은 핵심 키워드 부재, 단계 누락, "전문" 요청 — [admin-api/services/prompts.py:91-108](main-server/services/admin-api/services/prompts.py)
- 기본 rerank: incident/aggregation/knowledge/guide는 True, hourly_patterns와 postmortem은 rerank 인자를 넘기지 않는다 — [admin-api/services/chat_tools/executors/qdrant.py:55, 133-136, 193, 259, 292-295, 357-363](main-server/services/admin-api/services/chat_tools/executors/qdrant.py)
- 결과는 LLM에 넘길 때 잘린다. knowledge `content[:500]`, guide `content[:1500]` — [qdrant.py:325, 390](main-server/services/admin-api/services/chat_tools/executors/qdrant.py)
- 최종 답변 프롬프트는 "수치·시간·서버명은 근거와 함께", "관측에 없는 내용은 '확인 필요'"만 요구한다. 출처 번호나 문서명 인용 규칙은 없다 — [admin-api/services/prompts.py:157-167](main-server/services/admin-api/services/prompts.py)
- 게스트(help_inquiry) 모드는 RAG 도구만 허용하고 비기술 사용자용 프롬프트를 쓴다(전문 용어에 괄호 설명) — [admin-api/services/prompts.py:172-199](main-server/services/admin-api/services/prompts.py), [main-server/services/admin-api/CLAUDE.md "게스트 채팅"](main-server/services/admin-api/CLAUDE.md)
- UI의 `ToolCallCard`는 도구 결과를 `JSON.stringify(result, null, 2)`로 그대로 출력한다 — [frontend/src/components/chat/ToolCallCard.tsx:109](main-server/services/frontend/src/components/chat/ToolCallCard.tsx). "출처"나 "citation"이라는 이름의 UI는 검색 검증 화면(`SearchVerifyDetailPanel`)과 운영자 노트 화면에만 있다(grep 결과)
- 관리자용 **검색 검증 화면**(`/knowledge/search-verify/chatbot|collections`)은 컬렉션별 결과, dense/sparse 점수 분해, rerank 전후 순위를 보여준다. LLM은 호출하지 않는다 — [main-server/services/admin-api/CLAUDE.md "챗봇 검색 검증"](main-server/services/admin-api/CLAUDE.md), [admin-api/routes/knowledge_verify.py](main-server/services/admin-api/routes/knowledge_verify.py)
- `/knowledge/search`(federated)를 외부 API처럼 쓰는 경로도 있다: admin-api `knowledge_service.call_federated_search` — [admin-api/services/knowledge_service.py:277](main-server/services/admin-api/services/knowledge_service.py)

### Inferences
- 근거 추적성(어느 문서 몇 페이지에서 나온 답인지)은 사용자가 도구 JSON을 직접 열어봐야 확인할 수 있다. 상용 RAG 제품이 흔히 제공하는 문장별 인용이나 원문 미리보기 기능은 없다.
- 챗봇 도구는 결과를 최대 10건 × 500자로 자르고, 이력 창은 20턴이다. 따라서 LLM 컨텍스트 예산은 작게 유지되지만, 긴 절차 문서는 `qdrant_get_chunks`로 따로 가져오지 않으면 일부만 보인다.

### Gaps
- 검색 결과에 원문 URL(Confluence `url`, Jira URL)이 payload에는 있지만 챗봇 도구 결과에는 포함되지 않는다(`page_id`, `file_hash`만 포함). UI에서 링크로 렌더링되는지는 확인하지 못했다.

## Q6. 보류(deferred) 항목 — Korean BM25, 질의 전처리

### Takeaway
"한국어 BM25 형태소(kiwi)"와 "질의 전처리(LLM rewrite/HyDE)"는 2026-04-28 V2 결정 때 **운영 신호를 보고 결정**하기로 하고 보류됐다. 이후 진척을 보여주는 문서나 코드는 없다. 경영진 발표 자료에는 "중기 확장"으로 올라가 있다.

### Cited Findings
- "🔲 Korean BM25 형태소 (kiwi): 운영 후 신호 보고 결정", "🔲 Query 전처리 (LLM rewrite/HyDE): V2 운영 후 short query 실패율 보고 결정". 같은 메모에서 Reranker와 Chunking은 완료로 표시돼 있다 — `~/.claude/projects/-Users-youwonji-workspace-ai-aoms/memory/project_v2_direction.md`
- 로드맵 "중기 확장: 한국어 임베딩 품질 개선 (Korean BM25, 쿼리 전처리)" — [docs/presentation_v1.2_executive.md:753](docs/presentation_v1.2_executive.md)
- 보류 판단에 쓰기로 한 "short query 실패율"을 측정하는 코드나 대시보드는 찾지 못했다. 근접한 신호는 `rag_top1_score` 통계(관리자 챗봇 통계의 `top1_avg_score`)뿐이다 — [admin-api/routes/chat.py:364](main-server/services/admin-api/routes/chat.py), [admin-api/routes/knowledge.py:312](main-server/services/admin-api/routes/knowledge.py)
- RRF 스케일 오해(k=60이라고 가정)를 바로잡은 이력: classify_anomaly 임계값을 0.032/0.025/0.015에서 0.8/0.5/0.3으로 보정(2026-05-31, 커밋 7679f5e) — [.claude/memory/adrs.md:314](.claude/memory/adrs.md), `reference_qdrant_rrf_scale.md`

### Inferences
- 보류 근거로 삼은 "운영 신호"를 실제로 수집하는 장치가 없다. 그래서 지금 구조로는 보류를 해제할 계기가 생기기 어렵다. 게다가 rag_top1_score는 rerank logit과 RRF 점수가 섞여 있고 knowledge 도구에서만 기록된다.
- fastembed BM25가 한국어를 공식 지원하지 않는다는 점(Q2)은 보류 메모에 명시돼 있지 않다. 보류 당시 이 제약을 정량적으로 평가했는지는 확인되지 않는다(불확실).

### Gaps
- kiwi/mecab 도입 시 폐쇄망 패키징 비용이나 성능을 검토한 문서는 리포에 없다.

## Q7. 검색 품질 평가·정확도 측정

### Takeaway
36문항 한국어 평가셋과 `scripts/eval_rag.py`(Recall@5/10, MRR, NDCG@5, 키워드 부분문자열 매칭)가 있다. 그러나 결과 파일은 2026-04-25 `/incident/search` baseline 하나뿐이고 **Recall@5 = 0.0278(1/36)** 이다. reranker를 도입한 뒤의 A/B 결과, knowledge·guide 엔드포인트 측정, 사람이 라벨링한 정답 doc id는 없다. 단위 테스트는 mock 기반 기능 검증이며 품질을 측정하지 않는다.

### Cited Findings
- 평가셋: 36문항, 카테고리는 운영절차 8 / 장애대응 8 / 정책 6 / 메트릭 4 / 비즈니스 4 / cross-lingual 4 / 모호 2, 길이는 short 6 / medium 21 / long 9. 매칭 규칙은 `expected_keywords` 중 하나라도 결과 텍스트(소문자)에 들어 있으면 정답 — [docs/rag-eval/korean-eval-set.json:1-25](docs/rag-eval/korean-eval-set.json), [docs/rag-eval/README.md](docs/rag-eval/README.md)
- 권장 기준은 Recall@5 ≥ 0.70, Recall@10 ≥ 0.85, MRR ≥ 0.50, NDCG@5 ≥ 0.55 — [docs/rag-eval/README.md "메트릭 정의"](docs/rag-eval/README.md)
- 실측 결과(유일): `endpoint=http://localhost:8000/incident/search`, top_k=10, overall recall@5 = recall@10 = MRR = NDCG@5 = 0.0278. 카테고리별로는 cross-lingual만 0.25이고 나머지는 모두 0.0 — [docs/rag-eval/results/baseline_20260425.json](docs/rag-eval/results/baseline_20260425.json)
- 평가 스크립트는 `/knowledge/search` 응답 형식을 "향후"용 placeholder로만 지원한다 — [scripts/eval_rag.py:52, 81, 194-196](scripts/eval_rag.py)
- README가 스스로 밝힌 한계(키워드 매칭의 FP/FN)와 개선 방향(정답 doc id, graded relevance, LLM-as-judge)은 아직 미이행이다 — [docs/rag-eval/README.md "매칭 한계와 향후 개선"](docs/rag-eval/README.md)
- 관련 테스트: `test_reranker.py`(정렬·폴백·rank 필드, 실모델 테스트 1건), `test_knowledge_vector_client.py`(point id, RRF 공식, corrected 승격), `test_search_guides_rerank.py`, `test_score_decomposition.py`, `test_chunking*.py` 및 admin-api `test_knowledge_verify.py`, `test_guides_search_grouping.py` 등 — [main-server/services/log-analyzer/tests/](main-server/services/log-analyzer/tests), [main-server/services/admin-api/tests/](main-server/services/admin-api/tests)
- 평가 커밋은 `0544c6e feat(log-analyzer): cross-encoder 리랭커 + 문서 청킹 모듈 추가` 하나뿐이다(git log, docs/rag-eval)

### Inferences
- baseline 0.0278은 ① 당시 로컬 Qdrant에 평가 도메인 문서(매뉴얼·정책)가 적재되지 않았을 가능성과 ② 평가 대상 엔드포인트가 로그 template 컬렉션이었다는 점이 겹친 결과로 보인다. 즉 "검색 엔진 성능"이 아니라 "평가 대상과 데이터의 불일치"를 측정했을 가능성이 높다(불확실. 당시 컬렉션 상태 기록 없음).
- 따라서 현재 Synapse에는 한국어 지식검색 정확도에 대한 **신뢰할 만한 정량 baseline이 사실상 없다.** 상용 제품과 비교하거나 BM25·reranker 변경의 효과를 판단하려면 knowledge·guide 엔드포인트 대상의 doc-id 라벨 평가셋이 먼저 필요하다.

### Gaps
- 운영 환경의 컬렉션별 포인트 수, 질의 로그 분포, 평균 rag_top1_score 실측값은 리포에서 찾을 수 없다.
- reranker int8과 FP32의 정확도 차이를 측정한 기록이 없다(docstring에는 FP32 기준 "손실 0%"만 적혀 있음).
