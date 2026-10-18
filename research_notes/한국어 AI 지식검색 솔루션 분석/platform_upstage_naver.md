# 한국어 LLM·문서 AI 플랫폼의 지식 자산화/RAG — 업스테이지 vs 네이버클라우드 (2026-10 기준)

> 출처 표기 규칙: **[rea]** = 2026-10-19 rea MCP(`inspect_web_page`, 접근성 텍스트)로 격리 Chrome(포트 9303)에서 직접 캡처한 공식 페이지 내용. **[web]** = WebSearch/WebFetch 결과. 마케팅 문구는 "(벤더 주장)"으로 구분.
> rea 캡처 대상: upstage.ai/products/document-parse, upstage.ai/products/studio, console.upstage.ai/docs/capabilities/embed, console.upstage.ai/docs/capabilities/parse/document-parsing, guide.ncloud-docs.com/docs/clovastudio-overview, guide.ncloud-docs.com/docs/rag-overview, api.ncloud-docs.com/docs/clovastudio-reranker, api.ncloud-docs.com/docs/clovastudio-segmentation, api.ncloud-docs.com/docs/clovastudio-embeddingv2. (upstage.ai/products/solar-llm, /solar-pro-4, console file-search 경로, api.ncloud-docs.com/docs/clovastudio-rag는 404였음 → WebFetch로 보완)

## 1. 시장 위치와 2025-2026 제품 라인업 (국가대표 AI 파운데이션 모델 사업 포함)

### Takeaway
업스테이지는 독자 AI 파운데이션 모델(독파모) 사업 2차 평가까지 통과해 Solar Open 2(250B 오픈 웨이트, 2026-07)와 상용 Solar Pro 4(2026-08)를 내놓았고, Document Parse를 중심으로 한 문서 AI 회사로 자리잡았다. 네이버클라우드는 2026-01 독파모 1차 평가에서 탈락한 뒤 재도전하지 않았다. 대신 HyperCLOVA X SEED 오픈소스 모델과 뉴로클라우드(폐쇄망) 기반 공공·금융 구축 사업에 집중하고 있다.

### Cited Findings
**업스테이지**
- 2026-10 기준 상단 메뉴에 노출된 제품: Solar Pro 4, Solar Mini 4, Syn Pro, Document Parse, Information Extract, Studio. 배너 문구: "New: Solar Mini 4 is live on Console. 50% off through Oct 22 (UTC)" — [rea: Upstage Document Parse 페이지](https://www.upstage.ai/products/document-parse)
- Solar Pro 4: 2026-08-06 출시. 컨텍스트 512K, 출력 최대 128K. Reasoning 모드 지원. 영어·한국어·일본어 지원. "flagship model, specialized for agentic use". 파라미터 수와 아키텍처는 공개하지 않았고 오픈 웨이트도 아님 — [web: Solar Pro 4 docs](https://console.upstage.ai/docs/models/solar-pro-4.md)
- 독파모 1차 평가(2026-01-15) 결과 LG AI연구원·SK텔레콤·업스테이지 3팀이 2차에 진출했다 — [web: 뉴시스](https://mobile.newsis.com/view/NISX20260115_0003478404)
- Solar Open 2: 2026-07-22 'Solar Open Weight Day'에서 공개. 250B 규모 오픈 웨이트로 Hugging Face에 게시됐다. K-Domain(한국어) 83.1점으로 Claude Haiku 4.5, GPT-5.4 Mini, DeepSeek V4 Flash와 비슷한 수준이라고 한다. "GPU 2장으로 실무형 AI 구현"(벤더 주장). 독파모 2차 결과물이며 전작은 Solar Open 100B. 사무 업무 강화학습 환경 'OfficeVerse'(Excel/Word/PPT/PDF 시나리오)도 함께 소개했다 — [web: 아이뉴스24](https://inews24.com/v/mtl/1987913)
- 2차 평가 통과 소식, 250B 총 파라미터·15B 활성(MoE) 구조, 3차에서 포털 다음(Daum)을 활용할 예정이라는 보도 — [web: 검색 요약, digitalmarketer](https://www.digitalmarketer.co.kr/insights/upstage-solar-open-2-solar-pro-4); [web: dealsite](https://dealsite.co.kr/articles/167792) (2차 언론 인용. 활성 파라미터 수치는 1차 출처에서 확인하지 못함)
- Upstage Studio: 문서 워크플로 AI 에이전트 제품(PO·인보이스 매칭, 운임 정산, 통관 감사, 보험 청구, 언더라이팅, 제조 품질문서 등). 연동 대상은 Amazon S3·Azure Blob·SharePoint·Google Drive. SOC 2 Type 1, ISO 27001/27701, HIPAA를 내세운다. 카피는 "Every hunt for money builds your company's memory", "Keep it current" — [rea: Upstage Studio](https://www.upstage.ai/products/studio)
- 산업 솔루션 메뉴: 보험·헬스케어·제조·금융 — [rea: Upstage 사이트 내비게이션](https://www.upstage.ai/products/document-parse)

**네이버클라우드**
- 독파모 1차 평가에서 네이버클라우드와 NC AI가 탈락했다. 사유는 옴니모달 모델에 Qwen 비전 인코더를 동결(frozen) 상태로 사용해 독자성을 인정받지 못했기 때문이다 — [web: 뉴시스 2026-01-15](https://mobile.newsis.com/view/NISX20260115_0003478743)
- 네이버는 추가 공모(패자부활전)에 참여하지 않겠다고 밝혔다 — [web: 뉴시스](https://www.newsis.com/view/NISX20260115_0003478770); [web: 헤럴드경제](https://www.heraldk.com/article/2026011516564306799)
- HyperCLOVA X THINK(추론 모델) 완성 발표는 2025-06-30. HyperCLOVA X SEED 14B Think는 2025-07에 상업 이용 가능한 오픈소스로 공개됐다. 2025-12에는 SEED 8B Omni(네이티브 옴니모달)와 SEED 32B Think가 오픈소스로 공개됐다 — [web: 네이버 보도자료 모음](https://navercorp.com/tech/hyperclovax)
- CLOVA Studio 릴리스 노트: 2025-04-17 Chat Completions v3(텍스트+이미지), 라우터 API, OpenAI 호환 API. 2025-07-17 익스플로러에 리랭커·RAG Reasoning 추가, UI/UX 전면 개편, HCX-005·HCX-DASH-002 PEFT 튜닝. 2025-07-29 HCX-007 추론 모델과 Structured Outputs. 2026-01-22 문제 해결 가이드 — [web: CLOVA Studio 릴리스 노트](https://api.ncloud-docs.com/docs/clovastudio-releasenote.md)
- 공공·금융 구축 사례: 미래에셋증권 온프레미스 금융 sLLM(HCX-DASH 기반), 한국은행 전용 생성형 AI 플랫폼(뉴로클라우드 for HyperCLOVA X), 한국수력원자력 원전 특화 AI 플랫폼 — [web: ITWorld](https://www.itworld.co.kr/news/311946); [web: 네이버 보도자료](https://navercorp.com/media/pressReleasesDetail?seq=32047)
- 네이버웍스: HyperCLOVA X 기반 메일 요약, 안 읽은 메시지 요약, 메일 작성 보조 등 — [web: 네이버 보도자료](https://navercorp.com/media/pressReleasesDetail?seq=31838) (작성 시점 2023-2024 무렵으로 보임. 사내 문서 'AI 검색'의 2026년 현황은 확인하지 못함)

### Inferences
- 업스테이지는 "문서 파싱 → 추출 → 에이전트(Studio)"를 수직으로 묶어 '문서에서 업무 기억(company memory)을 만든다'는 방향으로 움직이고 있다. 네이버는 "HCX 모델 + CLOVA Studio API 도구 + NCP RAG 서비스 + 뉴로클라우드(폐쇄망)" 조합으로 인프라형 공급에 무게를 둔다.
- 네이버의 독파모 탈락은 모델 독자성 판정 문제였다. 한국어 RAG 도구(임베딩·리랭커·문단 나누기)의 품질 문제와는 별개로 봐야 한다.

### Gaps
- Syn Pro의 정체(용도·스펙)는 메뉴에만 있었고 상세 문서를 찾지 못했다.
- 기업·공공 고객 수, 국내 시장 점유율 순위를 담은 객관적 자료는 찾지 못했다.
- 네이버웍스의 2026년 사내 문서 AI 검색 기능 세부 사항은 확인하지 못했다.

## 2. 한국어 처리: 토크나이저·임베딩·Sparse/BM25·동의어

### Takeaway
양사 모두 1024차원·8K 토큰 dense 임베딩을 제공한다. 한국어 sparse/BM25, 형태소 분석, 동의어 사전은 공개 API에서 찾을 수 없었다. 업스테이지 Solar Embedding 2는 자체 사전학습 모델이 아니라 microsoft/harrier-oss-v1-0.6b를 파인튜닝한 모델이라고 공식 문서에 적혀 있다.

### Cited Findings
- **Upstage Solar Embedding 2**: `solar-embedding-2-query` / `solar-embedding-2-passage`(질의·패시지 비대칭 모델), 1,024차원, RPM/TPM 100 / 300,000, 8k 컨텍스트, "fine-tuned versions of microsoft/harrier-oss-v1-0.6b". 출력은 정규화 벡터라서 내적과 코사인이 같다. 배치당 최대 100개 텍스트, 요청당 204,800 토큰 — [rea: Upstage Embeddings docs](https://console.upstage.ai/docs/capabilities/embed)
- Solar Embedding 1(`embedding-query`/`embedding-passage` 별칭이 가리키는 `solar-embedding-1-large-*`)은 2026-12-31(UTC)에 완전 폐기될 예정이고, 별칭은 아직 v1을 가리킨다 — [rea: 같은 페이지](https://console.upstage.ai/docs/capabilities/embed)
- **CLOVA Studio 임베딩 v2**: 입력 최대 8,192 토큰, 출력은 1,024개 float. 전용 '토큰 계산기(임베딩 v2)' API가 있다 — [rea: CLOVA Studio 임베딩 v2](https://api.ncloud-docs.com/docs/clovastudio-embeddingv2)
- LangChain 통합 문서에는 CLOVA 임베딩 기본 모델로 `clir-emb-dolphin`이 나온다 — [web: LangChain Naver embeddings](https://docs.langchain.com/oss/python/integrations/embeddings/naver)
- Upstage File Search 문서에는 사용 임베딩 모델도, 하이브리드/키워드 검색 여부도 적혀 있지 않다 — [web: File Search docs](https://console.upstage.ai/docs/capabilities/search/file-search.md)
- Document Parse의 문자 지원: "Alphanumeric, Hangul, Hanja, Katakana, and Hiragana", Hanzi/Kanji는 베타 — [web: Input requirements](https://console.upstage.ai/docs/capabilities/parse/input-requirements.md)

### Inferences
- Synapse가 쓰는 bge-m3(1024차원, 8K)와 양사 임베딩의 차원·컨텍스트 스펙이 같다. 스펙만으로는 교체할 이유가 약하고, 장점이 있다면 폐쇄망 외부 API 의존이 없다는 쪽이다. 두 벤더 모두 query/passage 비대칭(업스테이지) 외에 한국어 고유의 추가 기법을 공개하지 않았다.
- 한국어 BM25(형태소 기반 sparse)는 양사 공개 API에 없다. Synapse의 `Qdrant/bm25` sparse 경로는 자체적으로 개선해야 하는 영역으로 남는다(벤치마킹할 레퍼런스 없음).

### Gaps
- HyperCLOVA X·Solar의 토크나이저 어휘 크기와 한국어 토큰 효율 수치는 공식 문서에서 찾지 못했다.
- CLOVA 임베딩 v2의 베이스 모델과 학습 방식은 공개되지 않았다(rea 캡처에도 없음).
- 동의어·사용자 사전 기능은 양사 모두 찾지 못했다.

## 3. 문서 수집·파싱·청킹 (Document Parse, CLOVA OCR, 문단 나누기)

### Takeaway
업스테이지 Document Parse는 HWP/HWPX를 포함한 17개 포맷을 받는다. 레이아웃 요소를 검출하고 읽기 순서대로 직렬화한 다음 HTML/Markdown으로 출력하며, standard/enhanced/auto 3가지 모드를 둔다. 네이버는 범용 파서 대신 CLOVA OCR(표 추출, 특화 문서 모델)과 CLOVA Studio '문단 나누기'(의미 기반 토픽 세그멘테이션 + 길이 후처리) API를 제공한다. 이 문단 나누기 API는 청킹 레퍼런스로 바로 참고할 만하다.

### Cited Findings
- **Document Parse 처리 방식**: "detects layout elements such as paragraphs, tables, images, and more ... serializes the elements according to reading order, and finally converts the document into structured text"(HTML/Markdown). 동기 API는 요청당 최대 100페이지, 비동기는 최대 2,000페이지 — [rea: Document parsing docs](https://console.upstage.ai/docs/capabilities/parse/document-parsing)
- 모드: `standard`(텍스트 위주, 단순 표), `enhanced`(복잡한 표·이미지·차트), `auto`(페이지별로 자동 분류). 부가 기능으로 Chart Recognition, Merge multipage table, 요소 좌표(Element coordinates), Document OCR이 있다 — [rea: 같은 페이지](https://console.upstage.ai/docs/capabilities/parse/document-parsing); [rea: 제품 페이지](https://www.upstage.ai/products/document-parse)
- 활용 사례로 "Build RAG pipelines that store unstructured documents in a database while preserving their structural information"을 든다 — [rea: Document parsing docs](https://console.upstage.ai/docs/capabilities/parse/document-parsing)
- 지원 포맷: JPEG, PNG, BMP, TIFF, HEIC, WEBP, PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, CSV, TSV, **HWP, HWPX**. 크기 제한은 동기 100MB, 비동기 500MB. 페이지당 2억 픽셀 — [web: Input requirements](https://console.upstage.ai/docs/capabilities/parse/input-requirements.md)
- Enhanced mode는 시각 요소(복잡한 표, 체크박스, 차트, 다이어그램)를 직접 이해하는 방식으로 파싱을 확장한다(2025) — [web: Upstage blog](https://upstage.ai/blog/en/document-parse-enhanced). 2025-12-17 글 "Document Parse got stronger: Better at forms, rotation, and complex tables" — [rea: 제품 페이지 Related posts](https://www.upstage.ai/products/document-parse)
- 속도: 페이지당 평균 0.6초, 100페이지를 1분 이내에 처리, "5–10x faster than competitors"(벤더 주장) — [rea: 제품 페이지](https://www.upstage.ai/products/document-parse)
- LangChain `UpstageDocumentParseLoader(file_path, ocr="force")` 통합 예제가 공식 페이지에 있다 — [rea: 제품 페이지](https://www.upstage.ai/products/document-parse)
- Upstage File Search 청킹은 "Only `auto` is supported"이며 세그먼트 크기를 조절할 수 없다. 파이프라인은 Parse→Chunk→Embed→Store — [web: File Search docs](https://console.upstage.ai/docs/capabilities/search/file-search.md)
- Information Extract 계열 문서: Universal extraction, Prebuilt extraction, Document split(한 파일 안의 여러 문서를 분리·분류) — [web: Upstage llms.txt](https://console.upstage.ai/llms.txt); [rea: Embeddings 페이지 관련 링크](https://console.upstage.ai/docs/capabilities/embed)
- **CLOVA Studio 문단 나누기** (`/v1/api-tools/segmentation`): "문장 간 유사도를 파악하여 주제 단위로 글의 단락을 구분"한다. 입력은 1~120,000자(한글 기준, 공백 포함). `alpha`(-1.5~1.5, -100이면 자동, 값이 클수록 문단 수 증가), `segCnt`(-1이면 자동), `postProcess`(원하는 길이로 문단을 합치거나 나눔), `postProcessMaxSize`(기본 1,000자), `postProcessMinSize`(기본 300자, -1이면 자동). 출력은 `result.topicSeg`와 `result.span`(분할 인덱스) — [rea: CLOVA Studio 문단 나누기](https://api.ncloud-docs.com/docs/clovastudio-segmentation)
- **CLOVA OCR**: Document OCR 특화 모델(사업자등록증, 신용카드, 영수증, 신분증, 명함 → key-value 추출). 표 추출 기능이 있으며, 표가 인식되면 텍스트 추출 비용과 표 추출 비용이 함께 부과된다 — [web: NCP OCR 상품 페이지](https://m.ncloud.com/product/aiService/ocr); [web: CLOVA OCR FAQ](https://guide.ncloud-docs.com/docs/clovaocr-faq)
- "CLOVA OCR 한국어 인식률 97~99%, 한국 OCR 시장 1위"라는 주장은 제3자 경쟁 제품(lido.app) 마케팅 페이지에서 나온 것이다. 원 출처와 측정 방법이 없어 검증되지 않은 수치다 — [web: lido.app](https://www.lido.app/kr/clova-ocr-daean)
- NCP RAG 서비스 콘솔에서 "Retrieval 과정에서의 텍스트 분할 방식, 모델 구성, 출처 표시 개수 등을 직접 설정"할 수 있다 — [rea: NCP RAG 개요](https://guide.ncloud-docs.com/docs/rag-overview)

### Inferences
- Synapse의 knowledge_guides 고정 1500자 청크와 비교할 때, CLOVA 문단 나누기의 "의미 경계 분할 → min/max 길이 후처리(기본 300~1,000자)" 2단계 구조는 외부 API 없이 직접 구현할 수 있는 청킹 패턴이다. 예를 들어 bge-m3 문장 임베딩으로 인접 문장 유사도가 낮아지는 지점을 경계로 잡고 길이를 보정하는 방식이다.
- 운영 문서(장애 보고서, 표 중심 런북, HWP 공문)를 넣을 때는 표를 HTML/Markdown으로 보존하고 페이지를 넘어가는 표를 병합하는 Document Parse 방식이 기준이 된다. 다만 폐쇄망에서는 클라우드 API를 쓸 수 없으므로 온프레미스 라이선스가 필요하다(7절 참고).

### Gaps
- Document Parse의 한국어/HWP 전용 정확도 수치는 찾지 못했다(DP-Bench에 한국어 문서가 들어 있다는 언급 없음).
- 업스테이지·네이버 모두 공식 "RAG 레퍼런스 아키텍처" 문서에서 청크 크기 권장값을 숫자로 제시한 경우는 찾지 못했다(CLOVA 문단 나누기 기본값만 있음).
- CLOVA OCR에 범용 문서 레이아웃→Markdown 변환 기능이 있는지 확인하지 못했다.

## 4. 검색 단계: 라우터·리랭커·Groundedness·Query rewriting·인용

### Takeaway
CLOVA Studio 리랭커는 점수만 매기는 일반 cross-encoder와 다르다. LLM이 관련 문서를 고르고, 답변을 생성하고, 인용 문서(`citedDocuments`)를 표시하며, 답이 없으면 재검색 추천어(`suggestedQueries`)까지 돌려준다. 업스테이지는 답변을 사후 검증하는 Groundedness Check API(grounded / notGrounded / notSure)를 제공한다.

### Cited Findings
- **CLOVA Studio 리랭커** (`/v1/api-tools/reranker`): "검색한 문서와 사용자 쿼리 간 연관도를 평가하여 관련성 높은 문서들을 선택하고, 그 결과를 요약 및 압축하여 RAG 답변을 생성", "토큰 소비를 효율적으로 절감". 입력은 `documents`(id, doc)와 `query`, `maxTokens`(<4096, 기본 1024). 최대 입력 128,000 토큰, 최대 출력 4,096 토큰. 응답은 `result.result`(답변), `result.citedDocuments`(인용 문서 id·원본), `result.suggestedQueries`("리랭커 모델이 검색한 문서 중 답변을 찾지 못한 경우에 표시"되는 재검색 추천어), `usage`. 답이 없을 때의 예시 응답: "검색 결과에는 날씨에 대한 정보가 제공되지 않아..." — [rea: CLOVA Studio 리랭커](https://api.ncloud-docs.com/docs/clovastudio-reranker)
- CLOVA Studio 기능군에는 라우터(생성, 버전 규칙, 테스트, 코드 확인, 샘플 라우터)와 스킬 트레이너(스킬셋/스킬 버전 관리, 외부 API를 도구처럼 쓰게 하는 학습)가 있다 — [rea: CLOVA Studio 개요](https://guide.ncloud-docs.com/docs/clovastudio-overview). 라우터 API는 2025-04-17, 리랭커·RAG Reasoning은 2025-07-17에 출시됐다 — [web: 릴리스 노트](https://api.ncloud-docs.com/docs/clovastudio-releasenote.md)
- **NCP RAG 서비스** "출처 표시 정책": 사용자가 지정한 데이터로 색인하고 결과에 출처를 표시해 할루시네이션 위험을 줄인다. 출처 표시 개수를 설정할 수 있다 — [rea: NCP RAG 개요](https://guide.ncloud-docs.com/docs/rag-overview)
- **Upstage Groundedness Check**: 생성된 답변을 참조 컨텍스트와 대조해 `grounded`/`notGrounded`/`notSure`로 분류한다. 별칭 `groundedness-check`는 `groundedness-check-240502`를 가리키고, 100 RPM / 100,000 TPM. 문서에 폐기 안내는 없다 — [web: Groundedness docs](https://console.upstage.ai/docs/others/groundedness-checking.md)
- Upstage File Search + Responses API: 관련 청크를 찾은 뒤 "generates an AI answer grounded in the retrieved context". 검색 결과는 1~20개(기본 5). 메타데이터는 객체당 16키, 값당 512자. 현재 **Beta**. 하이브리드·리랭킹·인용 형식은 문서화되지 않았다 — [web: File Search docs](https://console.upstage.ai/docs/capabilities/search/file-search.md)

### Inferences
- Synapse에 바로 적용할 만한 패턴은 세 가지다. (1) 답이 없을 때 "근거 없음"을 명시하고 재검색 추천어를 돌려주는 응답 계약(CLOVA 리랭커). (2) 응답에 사용한 문서 id 목록(citedDocuments)을 구조화해서 반환하는 방식. (3) 답변 생성 뒤 3분류 groundedness 판정을 두는 사후 검증 단계(Upstage). (3)은 기존 LLM(DevX/Claude)에 판정 프롬프트를 붙이는 것만으로 구현할 수 있다.
- CLOVA 방식은 리랭크와 생성을 한 번의 LLM 호출로 합쳐 토큰을 아낀다. Synapse는 이미 bge-reranker int8 cross-encoder를 쓰고 있으므로, 관련 없는 문서를 걸러내는 컷오프만 더하면 비슷한 효과를 얻을 수 있다.

### Gaps
- Query rewriting(질의 재작성) 전용 API는 양사 모두 찾지 못했다. CLOVA의 `suggestedQueries`가 가장 가까운 기능이다.
- CLOVA 라우터의 내부 동작(의도 분류 모델 여부, 라우팅 기준)은 목차 수준만 확인했다.

## 5. 지식 자산화: 지식베이스 관리 UI·갱신·버전·피드백 루프

### Takeaway
NCP RAG 서비스는 Object Storage나 API로 데이터를 연결하고, 웹 콘솔에서 서비스(Services)와 평가(Evaluations)를 관리한다. 자체 평가셋을 올리고 결과를 다운로드할 수 있다. CLOVA Studio는 라우터·스킬셋에 버전 규칙을 둔다. Upstage는 API 수준의 Vector Store(파일 추가·삭제)와 Studio 커넥터(S3/SharePoint 등) 위주이며, 세밀한 갱신·버전 관리 기능은 공개 문서에서 드러나지 않는다.

### Cited Findings
- NCP RAG: "자사의 검증된 데이터를 직접 API로 연동하거나 Object Storage 버킷에 저장된 데이터를 연동"한다. "데이터 검색 테스트와 데이터셋 평가를 웹콘솔 화면에서 간편하게". "데이터 품질 검증: 설정한 테스트 모델에 대한 자체 평가셋을 적용하여 간편하게 평가를 진행하고 평가 결과를 다운로드". 목차는 Services / Evaluations(평가 생성, 평가 진행) / RAG 리소스·권한 관리 / API 가이드. 한국 리전 전용이며 문서는 2026-09-17에 갱신됐다 — [rea: NCP RAG 개요](https://guide.ncloud-docs.com/docs/rag-overview); [web: 같은 페이지](https://guide.ncloud-docs.com/docs/rag-overview)
- CLOVA Studio: 라우터 버전 규칙·관리, 스킬셋 버전 규칙·관리 문서가 따로 있다 — [rea: CLOVA Studio 개요](https://guide.ncloud-docs.com/docs/clovastudio-overview)
- Upstage Vector Store API: create/list/retrieve/search, add-file/remove-file. 한도는 사용자당 50개 스토어, 스토어당 500개 파일, 배치당 50개 파일 — [web: llms.txt](https://console.upstage.ai/llms.txt); [web: File Search docs](https://console.upstage.ai/docs/capabilities/search/file-search.md)
- Upstage Studio는 "Keep it current", "Every hunt for money builds your company's memory"(벤더 주장)라는 카피를 쓰고, S3·Azure Blob·SharePoint·Google Drive 연동과 DB·DW 목적지를 지원한다 — [rea: Upstage Studio](https://www.upstage.ai/products/studio)

### Inferences
- Synapse에 옮길 만한 것은 NCP RAG의 '평가셋 업로드 → 평가 실행 → 결과 다운로드' 콘솔 흐름이다. 현재 Synapse에는 knowledge 컬렉션의 회귀 평가 UI가 없으므로 운영자가 쓰는 golden Q&A 셋 기반 평가 화면이 유력한 후보다.
- 사용자 피드백(좋아요·싫어요)으로 지식을 자동 갱신하는 루프는 양사 공개 문서 어디에도 나오지 않는다. 벤치마크 대상이 없는 영역이다.

### Gaps
- 문서 변경 시 증분 재색인, 버전 이력, 문서 만료 정책은 양사 모두 공식 문서에서 찾지 못했다.
- 사용자 피드백 루프 기능은 찾지 못했다.

## 6. 정확도 평가: 공개 벤치마크와 방법론

### Takeaway
업스테이지는 직접 공개한 DP-Bench(200개 문서, NID·TEDS·TEDS-S)로 파싱 정확도를 주장한다. 다만 데이터셋에 한국어 문서가 포함됐다는 언급이 없고, 제품 페이지 수치(TEDS 93.48)와 HF 리더보드 수치(TEDS 96.06, 2026-02-09)가 서로 다르다. 네이버의 RAG 정확도는 공개 벤치마크 없이 "고객이 직접 만든 평가셋으로 평가하는" 방식이다.

### Cited Findings
- DP-Bench 구성: 200개 문서(미 의회도서관 90, OER 90, Upstage 내부 20), 레이아웃 요소 1,817개, 12개 카테고리. 지표 NID(읽기 순서 직렬화), TEDS/TEDS-S(표 구조·내용). 2026-02-09 리더보드: Upstage enhanced TEDS 95.59 / TEDS-S 97.62 / NID 96.62 / 7.56s, Upstage standard 96.06 / 97.25 / 96.29 / 3.77s, AWS 95.48 / 96.99 / 95.97 / 7.95s, Unstructured 80.26 / 89.51 / 91.78 / 6.80s — [web: HF upstage/dp-bench](https://huggingface.co/datasets/upstage/dp-bench)
- 제품 페이지는 "5%+ higher layout & table recognition vs. document processing models (DP-Bench)", "TEDS: 93.48, TEDS-S: 94.16"라고 적고 있다 — [rea: 제품 페이지](https://www.upstage.ai/products/document-parse). **불일치**: HF 리더보드 수치와 다르다. 페이지 수치가 예전 버전 결과일 가능성이 있지만 확인하지 못했다. 또 HF 리더보드에서는 AWS와의 차이가 1%p 안팎이라 "5%+"와 맞지 않는다(벤더 자체 벤치마크).
- Solar Open 2 K-Domain 83.1(언론 보도, 벤더 발표 수치) — [web: 아이뉴스24](https://inews24.com/v/mtl/1987913)
- HyperCLOVA X THINK가 "한국어 통사·의미·화용에서 전문가 수준 평가"를 받았다는 발표(벤더 주장, 2025-06) — [web: 네이버](https://navercorp.com/tech/hyperclovax)
- NCP RAG: 자체 평가셋 기반으로 평가하고 결과를 다운로드한다(지표 종류는 미확인) — [rea: NCP RAG 개요](https://guide.ncloud-docs.com/docs/rag-overview)

### Inferences
- 공개 벤치마크는 두 벤더 모두 "자사가 정의한 데이터셋"이 중심이다. Synapse 도입 판단에는 운영 장애 문서로 만든 자체 평가셋(질의–정답 문서 쌍, Recall@k/MRR)이 꼭 필요하다는 점을 두 사례가 모두 보여준다.

### Gaps
- Ko-MMLU/KMMLU 등 한국어 LLM 벤치마크의 2026년 공식 수치(Solar Pro 4, HCX-007)는 찾지 못했다.
- 한국어 검색(retrieval) 벤치마크(예: 한국어 MTEB)에 양사 임베딩이 오른 결과는 찾지 못했다.

## 7. 배포 형태: 온프레미스·폐쇄망·가격·라이선스

### Takeaway
네이버는 '뉴로클라우드 for HyperCLOVA X'로 고객 데이터센터 안에 폐쇄 사내망형 생성형 AI를 공급한 사례(한국은행, 한수원, 미래에셋)가 있다. 업스테이지 Document Parse는 REST API·마켓플레이스·온프레미스 세 가지로 배포할 수 있고 API 가격은 페이지당 $0.01이다. 오픈 웨이트(Solar Open 2, HCX SEED)는 폐쇄망에서 직접 호스팅하는 선택지가 된다.

### Cited Findings
- Document Parse: "Deploy anywhere — cloud, API, or on-prem", REST API(SOC2·ISO 27001), AWS Marketplace, On-premises. 가격 표기는 "$0.01/page"와 "$17/hour or $3k/month" — [rea: 제품 페이지](https://www.upstage.ai/products/document-parse) (후자가 AWS Marketplace 시간제 요금인지 온프레미스 요금인지는 캡처 텍스트만으로 판별하지 못함)
- AWS Marketplace에 Upstage Document Parse 리스팅이 있다 — [web: AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-lv5bnpdco7xoq)
- Solar Open 2: Hugging Face 오픈 웨이트, "GPU 2장" 구동(벤더 주장), Nota AI의 양자화 버전 — [web: 아이뉴스24](https://inews24.com/v/mtl/1987913)
- 뉴로클라우드 for HyperCLOVA X: "고객사의 데이터센터 내부에 폐쇄된 사내망으로 네트워크 환경을 구성", 보안정책 준수와 데이터 유출 방지, 폐쇄망 안에서 HCX 기반 학습. 한국은행 전용 플랫폼, 한수원 원전 특화 플랫폼 — [web: ITWorld](https://www.itworld.co.kr/news/311946)
- 미래에셋증권: HCX-DASH 기반 금융 sLLM 온프레미스 구축 완료 — [web: 네이버 보도자료](https://navercorp.com/media/pressReleasesDetail?seq=32047)
- HyperCLOVA X SEED(14B Think, 8B Omni, 32B Think)는 상업 이용 가능한 오픈소스다 — [web: 네이버](https://navercorp.com/tech/hyperclovax)
- NCP RAG는 한국 리전·VPC 전용이다. 공공(gov-ncloud)과 금융(fin-ncloud)에는 CLOVA Studio·OCR 상품 페이지가 따로 있다 — [rea: NCP RAG 개요](https://guide.ncloud-docs.com/docs/rag-overview); [web: gov-ncloud CLOVA Studio](https://www.gov-ncloud.com/v2/product/aiService/clovaStudio); [web: gov-ncloud OCR](https://gov-ncloud.com/product/aiService/ocr)

### Inferences
- Synapse(폐쇄망 RHEL + Docker)는 퍼블릭 API(Upstage Console, CLOVA Studio API, NCP RAG)를 직접 호출할 수 없다. 현실적인 선택지는 세 가지다. (a) Document Parse 온프레미스 라이선스를 문서 수집 단계에 한정해 도입한다. (b) Solar Open 2 / HCX SEED 오픈 웨이트를 자체 호스팅한다. 단 ADR-012(Ollama 제거)와 GPU 자원을 함께 검토해야 한다. (c) 기능 패턴(문단 나누기, citedDocuments·suggestedQueries 응답 계약, groundedness 3분류, 평가셋 콘솔)만 직접 구현한다. 비용과 아키텍처 영향을 따지면 (c)가 가장 작다.

### Gaps
- 뉴로클라우드와 Document Parse 온프레미스의 가격·최소 계약 규모는 공개되지 않았다.
- CLOVA Studio의 토큰당 2026 단가는 확인하지 못했다.
