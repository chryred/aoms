# 한국 AI 스타트업의 한국어 특화 엔터프라이즈 지식검색/RAG 제품 분석 — 올거나이즈 · 포티투마루 · 스켈터랩스 (기준 2026-10)

> 출처 표기 규칙: **[rea]** = 2026-10-19 격리 Chrome(포트 9302)에서 `mcp__rea__inspect_web_page`(include_accessibility_text=true)로 공식 페이지 접근성 텍스트를 직접 캡처한 내용. **[web]** = WebSearch/WebFetch로 확인한 내용. 벤더 페이지 내용은 마케팅 자료이므로 "주장"으로 읽어야 하며, 제3자 검증 여부를 따로 적었다.
> rea 캡처 대상: allganize.ai/ko/home, /ko/products/alli-documents, /ko/products/alli-onprem, /ko/blog-posts-ko/acl-2026-rare-rag-evaluation, 42maru.ai/en/, 42maru.ai/kr/, skelterlabs.com/, skelterlabs.com/blog/hybrid-search, skelterlabs.com/blog/bella-qna-a-to-z. 9개 모두 캡처 성공(실패 없음). 스크린샷은 디코딩하지 않음.

## 1. 시장 위치 — 고객·순위·투자/IPO·2025-2026 최신 제품명

### Takeaway
세 회사 중 2026년 기준 제품·사업 모두 활발한 곳은 올거나이즈 하나다. 2026-11-04 도쿄증권거래소 그로스 상장이 예정돼 있고, 제품 라인업도 "Alli Works / Coworker / Documents 2.0 / Deep Research"로 개편됐다. 포티투마루는 LLM42·RAG42·MRC42 브랜드로 정부 인증과 제조 AX 영업을 이어가지만 웹사이트는 2022년 수준에 멈춰 있다. 스켈터랩스는 BELLA 제품 브랜드보다 "Gen AI Offerings"라는 SI·패키지형 서비스 회사 쪽으로 무게가 옮겨간 것으로 보인다.

### Cited Findings
**올거나이즈 (Allganize)**
- 2026 홈페이지 제품 메뉴: "알리 코워커 NEW, 알리 웍스, 알리 웍스 데스크톱, 알리 딥리서치, Documents 2.0, AX 리포트". 도입 방식은 "알리 SaaS / 알리 온프레미스", 산업 메뉴는 금융·보험·증권·공공·제조·에너지·통신 — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home)
- 홈 문구: "한국·미국·일본 300+ 엔터프라이즈 도입 경험 (*현재 운영 중인 고객사 중심 · 2017년 이후)", 인증 표기 SOC 2 / HIPAA / ISO 27001 — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home)
- 숫자 불일치: 2026-05-26자 자사 블로그는 고객을 "한국, 미국, 일본 3개국에서 200개 이상의 기업 고객"이라고 적어 홈의 "300+"와 다르다(홈은 2017년 이후 누적으로 보임) — [rea] [ACL 2026 블로그](https://www.allganize.ai/ko/blog-posts-ko/acl-2026-rare-rag-evaluation)
- 홈에 실린 사례: KT Device("PoC 후 2026년 연장 결정"), 한화생명("FP 상담 지원 AI — 온프레미스 + SaaS + MCI 연동"). 고객 인용으로 Mitsubishi Chemical("직원 및 고객 문의의 75% 이상 자동화"), Nomura("4개 주요 벤더 비교 후 … 응답 정확도가 가장 높고"), Ezaki Glico("고객문의 30% 감소 목표 초과 달성"), Geospace — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home) (자사 인용이며 제3자 검증은 없음)
- 홈에 노출된 에이전트 사례 수치: 수금 자동화 "제조 대기업, 처리 시간 −75%", 제안서 생성 "식음료 글로벌, 준비 시간 −30%" — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home) (마케팅 주장)
- IPO: 올거나이즈홀딩스가 도쿄증권거래소 그로스 마켓 상장 승인을 받았고 상장 예정일은 2026-11-04. 한국인 창업 기업의 일본 상장은 넥슨(2011)·라인(2016) 이후 처음. 2023년 KB인베스트먼트가 리드 투자 — [web] [딜사이트 2026-10-01](https://dealsite.co.kr/articles/169956)
- 올거나이즈코리아 채용공고(마감된 공고, 게시일 미표기. "2024년 기준" 문구로 보아 2025년 전후 작성 추정) 기준: 시리즈 B까지 누적 3,500만 달러(약 468억 원) 투자 유치, "2024년 기준 일본 'AI 앱 개발 로우코드·노코드 플랫폼' 부문 점유율·매출 1위", 고객사로 KB증권과 SMBC 금융그룹. 회사 소개는 "산업 특화 온프레미스 LLM 모델부터 Agent RAG, 노코드 LLM 앱 빌더 및 앱 마켓까지" — [web] [원티드 채용공고](https://www.wanted.co.kr/wd/377746) (회사가 직접 쓴 문구)
- "Alli LLM App Market"이라는 이름은 채용공고의 "노코드 LLM 앱 빌더 및 앱 마켓" 문구로만 확인했다. 2026 홈페이지에서는 "앱 둘러보기"와 Coworker(노코드 AI 앱·에이전트 생성, Slack/Teams 배포)로 바뀐 것으로 보인다 — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home); [web] [원티드](https://www.wanted.co.kr/wd/377746)

**포티투마루 (42Maru)**
- 2026-01-13: "2026 대한민국 신흥 AI+X Top 100"에 6년 연속 선정(크로스 인더스트리 융합 부문, NLP 기반 AI 플랫폼). 대표 김동환. 핵심 기술 LLM42(전문산업 특화 경량 언어모델), RAG42, MRC42와 기업용 "프라이빗 모드" — [web] [벤처스퀘어 2026-01-13](https://www.venturesquare.net/?p=1032343)
- 2026-09-10: 천안 "제1회 2026 AI·디스플레이 포럼"(약 150명 참석)에서 "경량 언어모델(sLLM) + 보안 RAG 기반 기업 내부 데이터" 연계, 설비 매뉴얼·품질 데이터 연결, 출처 제시, 엔지니어가 직접 워크플로를 설계하는 에이전틱 AI를 발표. 고객사 이름은 공개되지 않음 — [web] [벤처스퀘어 2026-09-10](https://www.venturesquare.net/1112436/)
- 공식 웹사이트(국/영문): 고객 로고는 LG U+, SK Innovation, Korea Telecom, DSME, Nonghyup Bank, Kia Motors. 수상 이력은 "SQuAD 2.0 공동(구글) 1위", Techstars London 2018, AWS AI Challenge Award, KGCCI Innovation Awards 2019, ACL 논문(HCVAE). 최신 뉴스는 2022년("챗42 GS인증 1등급", WIS 2022)에서 멈춰 있음 — [rea] [42maru.ai/kr](https://www.42maru.ai/kr/), [42maru.ai/en](https://www.42maru.ai/en/)
- 홈페이지 회사 소개: "사용자의 질의 의도를 의미적으로 이해하고 방대한 비정형 데이터에서 '단 하나의 정답'만을 도출해내는 딥 시맨틱 TA/QA 플랫폼". 메뉴는 "AI 기반 검색 / AI 기반 NLU 챗봇 / AI 기반 OCR-NLP" — [rea] [42maru.ai/kr](https://www.42maru.ai/kr/)
- AI 제품·서비스 검증 제도에 따른 정부 인증 취득 보도가 있음 — [web] [디지털투데이](https://www.digitaltoday.co.kr/cn/view/104373/fortytwomaru-wins-government-certification-under-ai-product-service-verification-scheme) (날짜와 세부 내용은 확인하지 못함)

**스켈터랩스 (Skelter Labs)**
- 2026 홈 메인 카피 "Specialized AI for Enterprise — 기업의 맥락을 이해하는 특화 AI 솔루션". 오퍼링 5종: "AI Agent를 활용한 비즈니스 자동화 / RAG 기반 맞춤형 애플리케이션 개발 / AICC 구축을 위한 STT 및 TTS 모델 제공 / Private Data 기반 기업향 LLM 모델 구축 / 노코드 AI 챗봇 빌더 구축 및 운영 지원". 최신 글은 2026-06-29 "토큰을 많이 쓰는 기업보다, 가치를 만드는 기업이 이깁니다"이고, 푸터는 "© 2025" — [rea] [skelterlabs.com](https://www.skelterlabs.com/)
- 홈 메인에는 BELLA라는 브랜드명이 보이지 않는다. BELLA는 블로그 URL(bella-qna-*, bella-llm-sllm, introduce-bella)에만 남아 있다 — [rea] [skelterlabs.com](https://www.skelterlabs.com/)
- BELLA("Business Empowering LLM Application")는 2023-06 출시. BELLA QNA는 그 하위 Q&A 챗봇 제품이다 — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z)
- 2025년 현장 리포트에 나온 고객: 신한투자증권(온프레미스 RAG, 사내 규정·리포트 검색), "K증권"(사전 정의 Q&A + RAG 하이브리드 챗봇, 폐쇄망 보안 검증), KB국민카드(혜택 정보 생성형 Q&A), 요기요(월 1.7만 건 이상 문의 처리), 분당서울대병원(실시간 STT), 익명 건설사(멀티모달 문서 추출 정확도 57.62%→90.92%) — [web] [스켈터랩스 2025 AI 현장 리포트](https://www.skelterlabs.com/blog/2025-ai-onsite-report) (자사 사례, 수치는 검증되지 않음)
- 경찰청: BELLA LLM 기반 sLLM으로 진술서 작성 지원, 경찰관서·해바라기센터 등 239개소에 온프레미스로 배포 — [web] [bella-llm-sllm](https://www.skelterlabs.com/blog/bella-llm-sllm)

### Inferences
- 올거나이즈는 2024년의 "LLM 올인원 + 앱마켓" 포지셔닝에서 2026년 "에이전트 플랫폼(Coworker) + 공통 RAG 엔진(Alli RAG)"으로 브랜딩을 바꿨다. 지식검색은 이제 독립 제품이 아니라 모든 제품 밑에 깔린 공통 엔진으로 위치가 내려갔다.
- 포티투마루는 "MRC(기계독해) 기반 단일 정답"이라는 정체성을 유지한 채 sLLM + RAG + 프라이빗 배포로 제조·공공 시장을 공략하는 것으로 보인다. 웹사이트가 갱신되지 않아 제품 세부 확인이 어렵다.
- 스켈터랩스는 SaaS 제품(BELLA QNA)보다 금융권 온프레미스 RAG, AICC, sLLM 구축 같은 프로젝트형 사업 비중이 커진 것으로 보인다.

### Gaps
- 세 회사의 2025-2026 매출, 공모가, 시가총액은 확인하지 못했다(딜사이트 기사에도 없음).
- 포티투마루의 최근 투자 라운드와 IPO 계획은 2025-2026 신뢰 출처에서 찾지 못했다.
- 스켈터랩스의 2025-2026 투자·재무 현황, BELLA 브랜드 공식 단종 여부는 확인되지 않았다.

## 2. 한국어 처리 — 형태소/토크나이저, 한국어 BM25, 사전, 임베딩·리랭커

### Takeaway
세 회사 모두 한국어 형태소 분석기 종류, 한국어 BM25 토크나이저, 동의어·도메인 사전 운영 방식을 공개 자료에서 밝히지 않는다. 공개된 것은 올거나이즈의 "ElasticSearch BM25 + bge-m3 같은 다국어 임베딩 + 제목/페이지 벡터 가중 결합"과 스켈터랩스의 "OpenAI 임베딩 + BM25 계열 키워드 검색의 alpha 가중 결합"(2024-02 기준) 정도다. 한국어 정확도의 차별화는 모델 자체보다 파싱, 청킹 단위, 도메인 평가셋 쪽에서 만들어지고 있다.

### Cited Findings
- 올거나이즈 키워드 검색: "Using ElasticSearch and the BM25 algorithm…". 운영 임베딩 후보는 "OpenAI Embedding, nomic-embed-text, bge-m3, gte-large-en, all supporting up to 8192 tokens". 과거에는 BERT 계열, Longformer, BigBird를 시험했다 — [web] [Allganize 블로그 "Retriever optimization strategies"](https://www.allganize.ai/en/blog/retriever-optimization-strategies-for-successful-rag) (WebFetch는 게시일을 2026-07-06으로 표시했으나 내용상 2024년 글을 재게시한 것으로 의심됨)
- 같은 글: 질의 언어와 문서 언어가 다르면 페이지 벡터 가중치를 높이는 교차언어 처리. 한국어 형태소 분석기나 사전 언급은 없다 — [web] [동일](https://www.allganize.ai/en/blog/retriever-optimization-strategies-for-successful-rag)
- 올거나이즈는 금융 특화 자체 LLM "Alpha-F (EEVE)", "Alpha-F (OpenSolarKO)" 등 3종을 금융 리더보드에 올렸다(2024-04-03 기준 3·4위, 1·2위는 Claude 3·GPT-4). 한국어 오픈 LLM(EEVE, OpenSolar-Ko)을 파인튜닝한 것이다 — [web] [유니콘팩토리 2024-04-08](https://www.unicornfactory.co.kr/article/2024040810375680365)
- 스켈터랩스 BELLA QNA(2024-02 기준): "OpenAI의 Embedding 모델을 활용하여 문서 조각들을 임베딩", 생성은 "ChatGPT 3.5 turbo", HyperCLOVA X 연동 예정. 키워드 검색은 "BM25 알고리즘 주로 사용" — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z), [hybrid-search](https://www.skelterlabs.com/blog/hybrid-search)
- 스켈터랩스는 KorQuAD MRC 관련 글도 블로그에 두고 있다(URL /blog/korquad-mrc) — [rea] [skelterlabs.com 링크 목록](https://www.skelterlabs.com/) (본문은 미확인)
- 포티투마루 RAG42: "스마트 Embedding, 딥러닝 기반의 Retrieval, 인스트럭트 튜닝을 통한 Prompt Engineering 등 자체 보유 기술"이라는 문구는 **검색 결과 요약에만 있고 원문은 확인하지 못했다**. 해당 URL(벤처스퀘어 953973, 2025-01-13 "이머징 AI+X 톱 100 5년 연속 선정")에는 이 문구가 없다. 원문에서 확인된 것은 LLM42 "전문 산업분야에 특화된 경량화 언어모델", RAG42 "검색증강생성 기술", MRC42 "인공지능 독해 기술", "기업용 Private 모드"뿐이다 — [web] [벤처스퀘어 2025-01-13](https://www.venturesquare.net/953973/)
- 포티투마루의 한국어 역량 근거로 공개된 것은 SQuAD 2.0 공동 1위(영어 MRC), ACL 논문(HCVAE, QA 데이터 생성) 같은 과거 이력이다 — [rea] [42maru.ai/kr](https://www.42maru.ai/kr/)
- 참고(제3자 공개 모델): `dragonkue/bge-reranker-v2-m3-ko`, `sigridjineth/ko-reranker-v1.1` 등 bge-reranker-v2-m3 기반 한국어 리랭커가 HF에 공개돼 있다. 세 회사가 이를 쓴다는 근거는 찾지 못했다 — [web] [HF dragonkue](https://huggingface.co/dragonkue/bge-reranker-v2-m3-ko/blob/main/README.md), [HF sigridjineth](https://huggingface.co/sigridjineth/ko-reranker-v1.1/commit/c2dce2d5e69875e680cffaea0860cfc410569873)

### Inferences
- 올거나이즈가 bge-m3를 운영 후보로 명시했다는 점은 Synapse의 현재 선택(bge-m3 + BM25 하이브리드)이 업계 선도사 구성과 같은 계열이라는 근거가 된다. 차이는 올거나이즈가 BM25를 ElasticSearch(nori 등 한국어 분석기 사용 가능)로 돌린다는 점이다. Synapse의 `Qdrant/bm25`가 한국어 형태소 분석 없이 동작한다면 이 부분이 격차일 수 있다. 다만 nori 사용 여부는 공개되지 않아 추정이다.
- 세 회사 모두 "한국어 특화 임베딩 자체 개발"을 내세우지 않는다. 한국어 정확도를 파싱 품질과 도메인 평가로 확보한다는 메시지가 공통이다.

### Gaps
- 형태소 분석기(nori/mecab-ko/Kiwi), 동의어·도메인 사전 운영 방식, 자체 한국어 임베딩·리랭커 공개 여부는 세 회사 모두 공개 자료가 없다.
- 올거나이즈의 2025-2026 리랭커 사용 여부와 모델명은 확인하지 못했다.

## 3. 문서 수집·파싱 — HWP/PDF 표·이미지, OCR, 청킹, 메타데이터·권한

### Takeaway
올거나이즈는 "Allganize Parser(페이지 단위)"와 Documents 2.0(PDF·docx·xlsx·PPT·**한글** 업로드, 발행일·버전·부서·문서유형 메타데이터 자동 인식, 버전 비교)을 전면에 내세운다. 청킹은 고정 토큰이 아니라 페이지 단위다. 스켈터랩스(2024)는 txt/docx/pdf/html의 텍스트만 추출하고 마침표·줄바꿈 기준으로 토큰 청킹한 뒤 유효기간·카테고리 메타데이터를 붙인다. 이후 멀티모달(PDF→이미지) 추출로 확장했다. 포티투마루는 "OCR-NLP"와 표·그래프·도면 이해를 주장한다.

### Cited Findings
- 올거나이즈 Documents 2.0: "Word · PDF · Excel · PPT · 한글 — 포맷 무관", "업로드만 하면 발행일·버전·담당 부서·문서 유형 같은 메타데이터를 자동으로 인식… 수작업 태깅 없이 지식베이스가 쌓입니다", "AI가 질문의 의도를 파악해 필터를 자동으로 적용하고, 관련 구간을 출처와 함께", "문서 버전별 변경사항을 자동으로 추출하고 비교", "새 문서가 추가되면 자동으로 통합" — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents)
- 데모 예시: "2024년 하반기 식약처 고시 관련 SOP 중 최신 버전만 찾아줘 → 최신 버전 그룹으로 정리", 문서 상태 라벨("갱신 필요", "대체됨", "검증됨") — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents)
- Alli RAG를 "내부 지식 연결, 권한 기반 검색, 답변 근거 추적을 Works 전 제품에 공통 제공"하는 엔진으로 소개 — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents), [alli-onprem](https://www.allganize.ai/ko/products/alli-onprem)
- 권한: 역할별(관리자·구성원·뷰어) 권한, "부서 단위 문서 공간 분리", 외부 공유 범위 통제, SAML 기반 Entra ID·Okta·Google Workspace 연동 — [rea] [alli-onprem](https://www.allganize.ai/ko/products/alli-onprem)
- 대용량 정형 데이터: "MAPREDUCE NO-CODE — 100만 행 엑셀, 분산 처리로 완결" — [rea] [alli-onprem](https://www.allganize.ai/ko/products/alli-onprem)
- 리더보드 구성에서 Alli 스택은 "Allganize Parser(페이지 단위) + Hybrid Search", 비교 대상 LangChain은 pypdf + chunk 1000/overlap 200 — [web] [HF RAG-Evaluation-Dataset-KO](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO)
- 올거나이즈 청킹: "Chunking at document page level rather than fixed token counts", 의미 없는 제목이면 제목 벡터 가중치를 0으로 — [web] [Allganize retriever 블로그](https://www.allganize.ai/en/blog/retriever-optimization-strategies-for-successful-rag)
- 스켈터랩스 BELLA QNA(2024-02 기준): txt·docx·pdf 업로더와 plain text·html 문서 추가 API 지원, csv·콘텐츠 DB는 계획 단계. "순수 텍스트 데이터만을 추출", HTML은 "광고심의필" 같은 불필요 부분 삭제, "마침표나 줄바꿈을 기준으로" 토큰 단위 청킹, 청크에 "유효기간, 카테고리, 용도 등의 메타데이터" 포함 — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z)
- 스켈터랩스 2025: 건설사 문서 "PDF→이미지 + 텍스트" 멀티모달 처리로 문서당 80개 이상 항목 추출, 정확도 57.62%→90.92%. 무역서류는 AI-OCR + NER로 JSON 표준화 — [web] [2025 AI 현장 리포트](https://www.skelterlabs.com/blog/2025-ai-onsite-report)
- 포티투마루: 메뉴에 "AI 기반 OCR-NLP" — [rea] [42maru.ai/kr](https://www.42maru.ai/kr/). LLM42가 "멀티모달(표, 그래프, 차트, 도면 등)의 이해·분석 및 생성"까지 수행한다는 주장은 **검색 결과 요약 기반이며 원문은 확인하지 못했다**(953973 기사에는 해당 문구 없음)
- HWP 일반 맥락(제3자): HWP를 PDF로 변환해 파싱하면 표 구조가 깨지므로 원본 직접 파싱(HWP 5.0 바이너리/HWPX XML)이 필요하다. 오픈소스 dochan, libhwp, hwpers가 있다 — [web] [한컴 AX Insight](https://blog.hancom.com/en/?p=1862), [PyPI dochan](https://pypi.org/project/dochan)

### Inferences
- 올거나이즈의 핵심 자산화 패턴은 "업로드 → 메타데이터(발행일·버전·부서·유형) 자동 추출 → 질의에서 필터 자동 추론 → 최신/대체됨 상태 관리"다. 운영 모니터링 RAG에 옮기면 런북·장애보고서의 버전과 유효성 관리, "최신 버전만" 필터에 해당한다.
- 페이지 단위 청킹은 표·이미지가 섞인 문서에서 문맥이 끊기는 것을 줄이는 실용적 선택이다. Synapse의 1500자 고정 청크와 대비된다.

### Gaps
- Allganize Parser의 HWP/HWPX 처리 방식(직접 파싱인지 변환인지), OCR 엔진, 표를 마크다운/HTML로 바꾸는지 여부는 공개 자료에서 확인하지 못했다.
- 포티투마루 RAG42의 파싱·청킹 세부와 스켈터랩스의 현재(2025-2026) 파서 구성은 찾지 못했다.

## 4. 검색 — 하이브리드 결합, 리랭커, 질의 재작성, 멀티턴, 인용, 답변 불가 처리

### Takeaway
올거나이즈는 BM25 + 제목 벡터 + 페이지 벡터 3개 점수를 정규화해 결합하고, 그 위에 "Agentic RAG(답변 → 검증 → 재탐색 자기 교정)"를 얹는다. 스켈터랩스 BELLA QNA는 alpha 가중 하이브리드 → LLM에 문서-질의 관련성을 다시 묻는 "Consensus" 재선별(LLM-as-reranker) → 문서 한정 답변 프롬프트 → 출처 없으면 재검색 또는 "모른다" 응답의 다층 구조다. 포티투마루는 MRC로 "단 하나의 정답" 구간을 뽑는 방식을 RAG와 결합한다.

### Cited Findings
- 올거나이즈 하이브리드: "(1) BM25 score (2) Cosine similarity (query vs. document title vectors) (3) Cosine similarity (query vs. document page vectors) — These three scores were normalized and combined" — [web] [Allganize retriever 블로그](https://www.allganize.ai/en/blog/retriever-optimization-strategies-for-successful-rag)
- 올거나이즈 차별점 4종: "PLUGIN ARCHITECTURE / AGENTIC RAG / MAPREDUCE NO-CODE / GROUNDED ANSWERS". Agentic RAG는 "답변 → 검증 → 재탐색 자기 교정" — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home), [alli-onprem](https://www.allganize.ai/ko/products/alli-onprem)
- Documents 2.0: 질문 의도에서 필터 자동 적용(=self-query/메타데이터 필터 추론), 출처·버전 포함 답변, "답변 생성 과정 보기" UI — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents)
- 스켈터랩스: "alpha는 0~1, 0은 순수 키워드, 1은 순수 시맨틱", "하이브리드 검색을 돌린 후 한 번 더 챗GPT에게 문서와 질의 사이의 연관성을 물어보고 최종 문서들을 결정" — [rea] [hybrid-search](https://www.skelterlabs.com/blog/hybrid-search)
- 스켈터랩스 환각 방지 4단계: ① RAG ② "주어진 문서에서만 답을 찾도록 강제하는 답변 반환 프롬프트" ③ "질문 연관성이 확실한 문서만 콕 집어 남기는 Consensus 과정" ④ "출처 포함 답변 — 출처가 없는 답변이 생성되면 재검색… 관련 정보가 명백히 없는 경우에는 정보가 더 필요하다고 안내". 적절한 문서가 없으면 "'모르는 것은 모른다고' 솔직하게 답변" — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z)
- 스켈터랩스 멀티턴: "Clear Context(대화 맥락 초기화)", 의도 분류로 대화 방향 전환을 감지해 이전 검색 문서에 고착되지 않게 함, 문서 분류기, CoT 프롬프팅. 정량 지표는 없다 — [web] [multiturn-rag](https://www.skelterlabs.com/blog/multiturn-rag)
- 스켈터랩스 생성형 AI UX 패턴 연재(인용, 피드백, AI 고지, 로딩) — [rea] [skelterlabs.com 블로그 링크](https://www.skelterlabs.com/) (URL만 확인)
- 포티투마루: "딥 시맨틱 TA/QA … '단 하나의 정답'", 홈 슬로건 "ANSWERING AI — SINGLE SPECIFIC ANSWER" — [rea] [42maru.ai/kr](https://www.42maru.ai/kr/). RAG42와 MRC42를 결합해 환각을 완화하고 출처를 제공한다는 설명 — [web] [벤처스퀘어 2026-09-10](https://www.venturesquare.net/1112436/)

### Inferences
- 세 회사의 공통 패턴은 (a) 하이브리드 1차 검색, (b) 2차 재선별(올거나이즈: 에이전틱 검증·재탐색, 스켈터: LLM Consensus, 42Maru: MRC 구간 추출), (c) 출처 강제와 답변 불가 시 거절이다. Synapse가 이미 RRF + bge-reranker로 (a)(b)를 갖췄다면, 남은 격차는 (c)의 "근거 부재 시 재검색/거절" 루프와 메타데이터 필터 자동 추론으로 보인다.
- 올거나이즈의 "제목 벡터를 별도 점수로 결합"하는 방식은 런북 제목·장애 제목처럼 짧고 신호가 강한 필드를 별도 벡터로 다루는 아이디어로 옮겨볼 만하다.

### Gaps
- 올거나이즈의 정규화 방식(min-max/z-score)과 가중치 값, 리랭커 모델 여부는 공개되지 않았다.
- 2025-2026 기준 BELLA QNA가 여전히 GPT-3.5와 OpenAI 임베딩을 쓰는지는 확인하지 못했다(근거는 2024-02 자료).

## 5. 지식 자산화 — 큐레이션·검수, 피드백 루프, FAQ 생성, 버전관리, 에이전트 빌더

### Takeaway
"지식 자산화"를 가장 체계적으로 제품에 녹인 곳은 올거나이즈다. Documents 2.0(메타데이터 자동 태깅, 버전 그룹, 대체됨/갱신 필요 상태, 문서 간 관계 자동 구성), Coworker(노코드 에이전트·웹앱·포털, Slack/Teams 배포), 감사 로그·가드레일이 있다. 스켈터랩스는 백오피스(대화 설정, 히스토리, 통계)와 사전 정의 Q&A + RAG 하이브리드 구조를 쓴다. 포티투마루는 공개 자료가 빈약하다.

### Cited Findings
- 올거나이즈 거버넌스: "역할 기반 접근 제어 / 감사 로그 & 추적 / 콘텐츠 가드레일" — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home)
- Documents 2.0: "문서 간 관계와 참조를 자동으로 구성", "개정 전후 비교 — 버전별 변경사항 자동 추출", 상태 라벨 "대체됨·갱신 필요·검증됨" — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents)
- Alli Coworker: "Slack·Teams에서 코드 없이 AI 앱을 만들고 즉시 배포", "ERP·DB·API를 노코드로 연결", "폐쇄망·온프레미스" 지원. 사례로 "Slack 사내 검색 에이전트 — 사내 채널·문서·데이터를 자연어 하나로 검색" — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home)
- 올거나이즈 블로그 제목 "데이터 파이프라인 세 개의 관문 현장 리포트"(/blog-posts-ko/data-pipeline-three-gates-field-report) — [rea] [allganize.ai/ko/home 링크](https://www.allganize.ai/ko/home) (본문 미확인)
- 스켈터랩스 BELLA QNA: 문서 추가·삭제·관리 외부 API, 백오피스에서 "대화 설정, 히스토리, 통계" 접근 — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z)
- 스켈터랩스 "K증권": 사전 정의 Q&A(큐레이션 답변)와 RAG를 결합한 하이브리드 챗봇 — [web] [2025 AI 현장 리포트](https://www.skelterlabs.com/blog/2025-ai-onsite-report)
- 스켈터랩스 오퍼링 "AI 솔루션 개발 및 배포 — 체계적인 품질 관리와 실시간 피드백을 통해 지속적으로 개선", "성능 평가 및 유지 보수 — 24시간 모니터링과 정기 진단" — [rea] [skelterlabs.com](https://www.skelterlabs.com/) (서비스 문구라 구체성이 없음)
- 포티투마루: 엔지니어가 직접 워크플로를 설계하는 에이전틱 AI — [web] [벤처스퀘어 2026-09-10](https://www.venturesquare.net/1112436/)

### Inferences
- 운영 RAG에 옮길 만한 패턴: 문서 상태(유효/대체됨/검증 필요) 필드, 버전 그룹핑, "최신만" 기본 필터, 사전 정의 Q&A(운영자 검수 답변)를 RAG보다 먼저 매칭하는 하이브리드 구조.
- FAQ 자동 생성 기능은 세 회사 모두 2026 공개 자료에서 명시적으로 확인되지 않았다.

### Gaps
- 사용자 피드백(좋아요/싫어요)을 검색·임베딩 개선에 어떻게 반영하는지, 그 루프의 구체 구현은 공개되지 않았다.
- FAQ 자동 생성과 지식 검수 워크플로(승인 단계)의 공개 근거를 찾지 못했다.

## 6. 정확도 평가 — Allganize RAG 리더보드, RARE, 평가셋 운영

### Takeaway
올거나이즈는 한국어 RAG 평가에서 공개 자산이 가장 많다. ① 2024-08 공개 "RAG-Evaluation-Dataset-KO"(5개 도메인 × 60문항 = 300문항, PDF 63개, 문단/표/이미지 컨텍스트, LLM 판정 4개 투표). ② 2024-04 금융 LLM 리더보드(아레나형 선호 투표). ③ 2026 ACL 메인 채택 논문 RARE(고유사도 기업 문서용 중복 인지 평가). RARE는 자사 RAG 평가 솔루션 "Ralli"에 탑재됐다. 리더보드 1위가 자사(Alli)라는 점은 이해충돌로 보고 읽어야 한다.

### Cited Findings
- 데이터셋 구성: 금융·공공·의료·법률·커머스 5개 도메인, 도메인당 60문항(총 300), PDF 63개(금융 10개/301쪽, 공공 12/258, 의료 20/276, 법률 12/291, 커머스 9/211). 금융은 "문단 30(50%), 표 10(17%), 이미지 20(33%)" — [web] [HF allganize/RAG-Evaluation-Dataset-KO](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO)
- 판정: TonicAI answer_similarity(threshold=4), MLflow answer_similarity/v1, MLflow answer_correctness/v1(각 threshold=4), Allganize Eval(answer_correctness/claude3-opus) 4개 판정의 투표로 O/X 결정. 금융 도메인 사람 평가와 비교한 오류율 "약 8%" — [web] [HF 데이터셋 카드](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO)
- 결과(카드 최초 공개 2024-08-09, alpha-ko-202411 행으로 보아 2024-11 이후 갱신). 비교 스택은 LangChain(pypdf, chunk 1000/200, OpenAI 임베딩), OpenAI Assistant File Search, Cohere(chunk 500/200, embed-multilingual-v3.0), Upstage(solar-embedding-1-large). 주요 행(금융/공공/의료/법률/커머스/평균):
  - Alli(claude3.5-sonnet) 0.85 / 0.983 / 0.85 / 0.767 / 0.783 / **0.847**(254/300)
  - Alli(claude3-opus) 0.817 / 0.95 / 0.9 / 0.75 / 0.767 / 0.837
  - Alli(gpt-4o) 0.8 / 0.9 / 0.817 / 0.683 / 0.717 / 0.783
  - Alli(alpha-ko-202411-32B, 자체 한국어 LLM) 0.8 / 0.85 / 0.75 / 0.717 / 0.733 / 0.77
  - Upstage(gpt-4-turbo) 0.617 / 0.85 / 0.833 / 0.6 / 0.817 / 0.743
  - OpenAI Assistant(gpt-4-turbo) 0.533 / 0.883 / 0.733 / 0.733 / 0.783 / 0.733
  - Alli(Llama-3-Alpha-Ko-8B-Instruct-Pro) 0.673, Alli(KONI-Llama3-8B) 0.647, Upstage(solar) 0.633
  - LangChain(gpt-4-turbo) 0.617 / 0.517 / 0.667 / 0.567 / 0.683 / 0.61
  - Cohere(command-r-plus) 0.553, LangChain(gpt-3.5-turbo) 0.393, Anything LLM(gpt-4-turbo) 0.29
  — [web] [HF 데이터셋 카드](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO)
- 같은 LLM(gpt-4-turbo)끼리 비교하면 Alli 0.773 > Upstage 0.743 > OpenAI Assistant 0.733 > LangChain 0.61. 파서·검색 스택 차이만으로 최대 약 16%p 차이가 난다. 차이가 가장 큰 도메인은 금융(표·이미지 33%+17%)으로, Alli 0.783 대 OpenAI Assistant 0.533 — [web] [HF 데이터셋 카드](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO) (수치에서 직접 계산)
- 판정 도구 수 불일치: 보도는 "5개 평가 도구", HF 카드는 4개 판정 투표 — [web] [씬디스](https://seenthis.kr/newspageeng/908?page=28) vs [HF 카드](https://huggingface.co/datasets/allganize/RAG-Evaluation-Dataset-KO)
- 보도: "국내 최초 RAG 리더보드", 표·이미지 데이터를 테스트셋에 포함, HF에서 공개 — [web] [씬디스](https://seenthis.kr/newspageeng/908?page=28)
- 금융 LLM 리더보드(2024-04): 금융 용어·약어·복합 추론 평가, 한국은행·기획재정부 보고서 기반 RAG 데이터, 수식·표·차트, 번역된 영어 금융 데이터셋 포함. 익명 모델 쌍을 비교 투표하는 실시간 랭킹. 2024-04-03 기준 1 Claude 3, 2 GPT-4, 3 Alpha-F(EEVE), 4 Alpha-F(OpenSolarKO) — [web] [유니콘팩토리 2024-04-08](https://www.unicornfactory.co.kr/article/2024040810375680365)
- RARE(ACL 2026 Main, 2026-05-26 블로그): 논문 "RARE: Redundancy-Aware Retrieval Evaluation Framework for High-Similarity Corpora", 1저자 조한준(올거나이즈), 공저 서울대 이재윤 교수. 리뷰어 3명과 AC 전원이 Accept에 합의 — [rea] [ACL 2026 블로그](https://www.allganize.ai/ko/blog-posts-ko/acl-2026-rare-rag-evaluation); arXiv [2604.19047](https://arxiv.org/pdf/2604.19047)
- RARE 핵심 수치: 같은 검색 모델의 PerfRecall@10이 위키피디아 77.9% → 금융 8.5% → 법률 5.0%로 떨어진다 — [rea] [ACL 2026 블로그](https://www.allganize.ai/ko/blog-posts-ko/acl-2026-rare-rag-evaluation) (접근성 노드 StaticText "77.9%", "8.5%", "5.0%"로 확인. WebFetch 결과와 일치)
- RARE 3요소: "Atomic Fact Decomposition"(문서를 최소 사실 단위로 분해해 문서 간 중복 추적), "Redundancy-Aware Labeling"(같은 사실이 있는 어떤 문서를 가져와도 정답 인정), "CRRF(Criterion-wise Prompting with Reciprocal Rank Fusion)"(LLM 평가 데이터 생성 품질 기준을 독립 평가한 뒤 순위 합산, NDCG@3 0.419→0.463). 금융·법률·특허 3개 도메인 벤치마크 "RedQA" 구축. "자사 문서를 기반으로 맞춤형 RAG 벤치마크를 자동 구축" — [rea] [ACL 2026 블로그](https://www.allganize.ai/ko/blog-posts-ko/acl-2026-rare-rag-evaluation)
- RARE 평가 기능은 RAG 성능 평가 전용 솔루션 "Ralli"에 탑재 — [rea] [ACL 2026 블로그](https://www.allganize.ai/ko/blog-posts-ko/acl-2026-rare-rag-evaluation) (StaticText "Ralli" 노드로 확인. 'Alli' 오독이 아님)
- 스켈터랩스·포티투마루는 공개 RAG 평가셋이나 리더보드를 찾지 못했다. 스켈터는 프로젝트 단위 정확도(57.62%→90.92%)만 공개 — [web] [2025 AI 현장 리포트](https://www.skelterlabs.com/blog/2025-ai-onsite-report)

### Inferences
- RARE의 문제 설정(구조가 거의 같은 분기 보고서, 반복되는 유사 조항)은 운영 모니터링 데이터와 매우 비슷하다. 같은 유형의 장애 보고서, 거의 같은 알림 템플릿, 반복 런북이 그렇다. 정답 문서 1개만 인정하는 평가를 쓰면 검색 성능이 왜곡될 수 있으므로, Synapse 평가셋에도 "중복 정답 허용" 라벨링을 적용할 근거가 된다.
- 2024 리더보드 방법론(LLM 판정 다수결 + 사람 샘플 대조로 오류율 측정)은 소규모 내부 평가셋을 운영할 때 바로 따라 할 수 있는 패턴이다.
- 리더보드는 2024 시점 스냅샷이고 자사 제품이 상위를 차지하므로, 독립 벤치마크로 쓰기보다는 방법론 참고용으로 읽는 것이 맞다.

### Gaps
- 2025-2026에 리더보드가 갱신됐는지, 최신 순위는 확인하지 못했다(HF 카드는 2024-08 기준).
- RARE 논문의 실험 대상 검색 모델 목록과 한국어 데이터 포함 여부는 확인하지 못했다(arXiv 본문 미열람).

## 7. 배포 — 온프레미스·폐쇄망·sLLM

### Takeaway
세 회사 모두 폐쇄망·온프레미스와 sLLM을 지원한다고 밝힌다. 올거나이즈는 "SaaS와 온프레미스, 하나의 코드베이스"를 내세우며 에어갭, 승인 기반 패치, LLM 모델 선택·전환을 명시한다. 스켈터랩스는 경찰청 239개소 온프레미스 sLLM(LoRA + 양자화)과 증권사 폐쇄망 RAG 사례가 있다. 포티투마루는 "프라이빗 모드"와 sLLM(LLM42)을 내세운다.

### Cited Findings
- 올거나이즈 온프레미스: "PLUGIN ARCHITECTURE — SaaS와 온프레미스, 하나의 코드베이스", "망분리·폐쇄망 운영 — 에어갭", "외부 연결 없이 운영하거나, 승인된 절차로 업데이트·패치", "NO EGRESS", AI Engine "Agentic RAG · LLM 사내 운영", LLM 모델은 고객이 "사용 모델 선택·전환 결정". 구축 기간은 SaaS가 "일주일 이내", 온프레미스는 "요건 검토 후 일정 확정 (수주~수개월)". 하이브리드 구성도 가능 — [rea] [alli-onprem](https://www.allganize.ai/ko/products/alli-onprem)
- 한화생명 사례: "온프레미스 + SaaS + MCI 연동" 하이브리드 — [rea] [allganize.ai/ko/home](https://www.allganize.ai/ko/home)
- Alli Works 데스크톱: "로컬·온프레미스로 구성하면 데이터가 회사 밖으로 나가지 않습니다" — [rea] [alli-documents](https://www.allganize.ai/ko/products/alli-documents)
- 스켈터랩스 경찰청 sLLM: LoRA, 양자화, 템플릿 기반 학습, 동국대와 협업한 합성데이터, 239개소 온프레미스 — [web] [bella-llm-sllm](https://www.skelterlabs.com/blog/bella-llm-sllm)
- 스켈터랩스 신한투자증권 온프레미스 RAG, K증권 폐쇄망 검증 — [web] [2025 AI 현장 리포트](https://www.skelterlabs.com/blog/2025-ai-onsite-report)
- 스켈터랩스 BELLA QNA는 2024-02 시점 "SaaS 솔루션" — [rea] [bella-qna-a-to-z](https://www.skelterlabs.com/blog/bella-qna-a-to-z)
- 포티투마루: 기업용 "프라이빗 모드", LLM42 경량 모델 — [web] [벤처스퀘어 2026-01-13](https://www.venturesquare.net/?p=1032343). DIPS 2025 Global Tech-Con(2025-10-28)에서는 LLM42 "산업별 특화 경량화 모델"로 프라이빗 모드를 운영해 "내부 데이터 및 민감한 고객 정보를 안전하게 관리"할 수 있다고 소개하며 Agentic AI를 강조 — [web] [벤처스퀘어 2025-10-28](https://www.venturesquare.net/1011054). ("프라이빗 및 온프레미스 환경 기반의 안전한 운영 사례"라는 문구는 검색 요약에만 있고 원문은 확인하지 못했다)

### Inferences
- 폐쇄망 운영 관점에서 올거나이즈의 "승인 절차 기반 패치 채널", "모델 선택·전환을 고객이 결정"은 Synapse의 폐쇄망 + Strategy 패턴 LLM 라우팅(ADR-001)과 같은 방향이다.
- 한국 금융·공공 시장에서 온프레미스는 이미 기본 요건이 됐다. 차별화는 파싱, 평가, 거버넌스(권한 기반 검색, 감사 로그)로 옮겨가고 있다.

### Gaps
- 각 사 온프레미스 배포에 쓰는 LLM 종류(자체 sLLM 또는 오픈모델), GPU 요구 사양, 임베딩 모델 번들 방식은 공개되지 않았다.
