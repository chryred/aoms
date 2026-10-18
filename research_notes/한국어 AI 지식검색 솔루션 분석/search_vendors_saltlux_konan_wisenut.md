# 국내 전통 검색엔진 3사(솔트룩스·코난테크놀로지·와이즈넛)의 한국어 지식검색/RAG 제품 분석 (기준 2026-10)

> **출처 태그 범례**
> - `[rea]` — 2026-10-19 rea MCP(`inspect_web_page`, accessibility text)로 벤더 공식 제품 페이지를 직접 캡처한 내용. 벤더 자기 서술이므로 **마케팅 주장**이다.
> - `[PDF]` — 벤더 공식 PDF(브로슈어, IR 자료)를 내려받아 pdftotext로 추출한 내용
> - `[기사]` — 언론 기사 WebFetch
> - `[스니펫]` — 검색 결과 요약 스니펫만 확인했고 원문은 열람하지 못함(**미검증**)
> - 캡처 상태: 솔트룩스 홈·Knowledge Studio·Search Studio·A.RAG·LUXIA Cloud, 코난 홈·RAG-X·Konan Search, 와이즈넛 홈·WISE iRAG·SF-1 V7·SF-1 V7 Vector Edition·WISE LLOA 페이지 캡처 성공. 와이즈넛 `/sub/search/sch.php`는 404였다. 코난 Konan Search 페이지와 와이즈넛 홈의 숫자 카운터는 애니메이션이라 "0"이나 빈 값으로 잡혔으므로 수치를 확인하지 못했다.
> - 독립 제3자 검증 자료(학술 벤치마크, 공인 시험 성적서 원문)는 찾지 못했다. 아래 정확도·성능 수치는 별도 표기가 없으면 모두 벤더 주장이다.

---

## 1. 시장 지위: 고객/레퍼런스, 점유율·순위, 2025~2026 최신 버전명

### Takeaway
세 회사 모두 25년 안팎 된 공공·금융 검색엔진 강자다. 2024~2026년에 "검색엔진 → RAG 솔루션 → 에이전트 플랫폼" 순서로 제품군을 재편했다. 솔트룩스는 LUXIA(루시아) LLM, 온톨로지 기반 A.RAG, 루시아 온 어플라이언스를, 코난은 Konan LLM ENT-11(2025-03 출시. 2026-04 브로슈어 라인업에는 ENT-20·PRO-20도 있으나 상세 미확인), RAG-X, Konan Search(6)를, 와이즈넛은 WISE iRAG(V2), Search Formula-1 V7, WISE LLOA, WISE Agent Sphere를 내세운다. 점유율 수치는 와이즈넛의 "조달청 디지털서비스몰 판매액 기준" 하나만 있고, 시장 전체 점유율 자료는 없다.

### Cited Findings
**솔트룩스**
- `[rea]` 홈페이지 문구: "에이전트, 온톨로지, LLM, AI 플랫폼까지 모든 기술을 직접 설계하고 구현하며, 대한민국의 소버린 AI를 주도". 자기 소개 헤딩으로 "AI 전문기업 / 최고 기술 등급 / 국내 최대 특허 / 최다 구축사례"를 쓴다(근거 수치는 캡처되지 않음). 제품 메뉴: LUXIA 플랫폼, 에이전트, A.RAG(arag), 문서(document), Goover(goover), 날리지(knowledge), 루시아 온(on), 스크래핑, 서치(search), 보이스. 2026-10 현재 "AI 서버 '루시아 온'" 프로모션 배너가 걸려 있다. — [솔트룩스 홈](https://www.saltlux.com/ko/index)
- `[rea]` Search Studio 레퍼런스 목록: 헌법재판소(일상용어로 판례 검색), 대학 학사정보 통합검색, 디지털집현전 지능형 통합검색, 빅카인즈(뉴스 빅데이터), 지능형 법령정보서비스, 트레이드내비, 원자력안전규제 KMS, 현대기아자동차, 용산구청, 금융결제원 그룹웨어·KMS 통합검색, 청와대 업무시스템 검색, 강원도청 통합검색, 금융데이터 거래소 등. 연도는 표기되지 않았다. — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[rea]` Knowledge Studio 레퍼런스: 농협은행 지능형 KMS(노후 KMS를 AI 기반으로 개편), 특허 IP-Biz 플랫폼(국내외 특허 500만 건 이상 공개, 13개 기관 300만 건 연계), 1·2금융권 상품정보 지식그래프 QA, KT 기가지니 심층 QA, 부산국제영화제, 경기도청 LOD 등. — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[기사]` 루시아 A.RAG가 TTA GS인증 1등급을 획득했다(2025-08). — [바이라인네트워크 2025-08](https://byline.network/2025/08/82891/), [디지털데일리](https://www.ddaily.co.kr/page/view/2025082810135127742)
- `[기사]` 자체 LLM "루시아3.0"을 탑재한 서비스(구버, 기사 표기 'Gooby')가 있다(2025-10 기사). 루시아2와 구버는 2024-05에 공개됐다(검색 결과 제목으로만 확인). — [바이라인 2025-10](https://byline.network/2025/10/10113/), [바이라인 2024-05](https://byline.network/2024/05/30-303/)
- `[rea]` LUXIA Cloud 페이지에 모델명 "luxia3-llm-32b"와 "루시아 3 챗"이 나온다. 2026-10 기준 최신 공개 계열은 LUXIA 3다. — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[기사]` 이경일 대표의 2026-05-28 기조연설: AI 에이전트가 "2~3년 내 800억 개 이상"으로 늘어난다고 전망하고 뉴로심볼릭 AI를 강조했다. 제품 사양은 언급하지 않았다. — [다음/뉴스 2026-05-28](https://v.daum.net/v/20260528114300289)

**코난테크놀로지**
- `[rea]` 제품군은 Agentic AI(Agent-X), On-Device AI(VisionFlow, Lingo-X, Konan AIStation), Knowledge AI(Konan RAG-X, Konan Search)로 나뉜다. Tech 메뉴에는 Foundation Model(LLM/VLM/VLA), Text AI, 벡터검색, 그래프검색, NL2SQL, Doc AI, Speech AI가 있다. 산업은 에너지, 공공·지자체, 국방, 법률, 제조, 의료. — [코난 홈](https://www.konantech.com/)
- `[rea]` 2026년 뉴스: 국방 AI 서밋(2026-10-13, ARGOS), Lingo-X 네팔 법무부 시연(2026-10-08), AI FESTA 26 국방AI특별관(2026-09-28), 경남 피지컬 AI 국책사업(2026-09-18), 국방부 OSINT 분석 플랫폼 구축(2026-09-14), "코난 AI 서밋 2026"(2026-09-09). — [코난 홈](https://www.konantech.com/)
- `[rea]` Konan Search: "행안부·방위사업청·KB국민은행 등 2,000여 고객사", "25년 검색 기술력". 사례로 금융권 6개 핵심 시스템 통합검색(15년 이상 파트너), 방위사업청 교육포털 자연어 검색, 행안부 정보공개포털을 든다. — [Konan Search](https://www.konantech.com/products/search)
- `[rea]` RAG-X: "GS인증 1등급 (2025.09) — 조달청 우선구매 대상 지정". 사례(고객명 미표기): 주거복지 상담 RAG, 가스안전 지식 RAG(KGS Code·VOC·법령), 대용량 소장자료 RAG(100만 건에서 800만 건으로 증가), 수사자료 RAG와 보고서 자동화. — [Konan RAG-X](https://www.konantech.com/products/ragx), [바이라인 2025-09](https://byline.network/2025/09/9051/)
- `[PDF]` 2026-04 Konan LLM 브로슈어: 모델 라인업은 OND(AIStation), PRO-10/PRO-20(AIStation Server), ENT-11/ENT-20(On-Premise + RAG-X). 도입사례는 한국남부발전(2024-07~2025-08, 내부직원용 생성형 AI), 한림대학교의료원 등. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[스니펫]` ENT-11은 2025-03에 출시된 32B "국내 최초 일반·추론 통합 모델"이다. — [아시아경제 2025-03-26](https://view.asiae.co.kr/article/2025032610441885095), [유니콘팩토리 2025-09](https://www.unicornfactory.co.kr/article/2025091613333511410)

**와이즈넛**
- `[rea]` 홈 제품 구분: RAG Solutions "WISE iRAG", 인공지능 Solutions "WISE i Chat", 통합검색 Solutions "Search Formula-1". AI Agent 메뉴에는 WISE Agent Sphere, WISE iRAG, WISE LLOA, 벡터 검색이 있다. 대표 사례로 "화성시, 초거대 AI 기반 민원상담 어시스턴트"를 노출한다. 설립연도·매출·고객사 수 카운터는 캡처되지 않았다. — [와이즈넛 홈](https://www.wisenut.com/)
- `[rea]` WISE iRAG 레퍼런스: 한국도로공사 생성형 AI 챗봇(법·규정·수발신 문서 기반, 사내 메신저 연동), 화성시 초거대 AI 민원상담 어시스턴트, 우리은행 비정형데이터 자산화 사업, 고용노동부 업무지원 생성형 AI 챗봇과 유사검색, "G"은행 요약·Q&A. — [WISE iRAG](https://www.wisenut.com/sub/rag/irag.php)
- `[rea]` SF-1 V7: "국내 2200여 사이트 검증 제품", "국내 유일 해외 수출 사례 보유", SP인증 2단계와 GS인증. 레퍼런스는 법무부 법무샘 포털(2021), 행정안전부 지방세정 포털 등. — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` SF-1 V7 Vector Edition 레퍼런스: 국회사무처 e의안시스템, 한국산업인력공단 국가자격 문항 유사검색, 근로감독관 생성형 챗봇과 유사검색. — [Vector Edition](https://www.wisenut.com/sub/AIAgent/Vector.php)
- `[PDF]` IPO IR북: 파일명은 20260514이지만 **내용은 2025-01 상장 추진 당시 자료**다(수요예측 2025-01-03~09, 2023년 실적 기준). 이 자료에 따르면 매출액은 351.7억 원(2023)이고 누적 고객사는 5,500곳이다. **"시장점유율 1위: 검색 분야 47.9%, 챗봇 분야 67.5%"의 근거는 각주 "조달청 디지털서비스몰 분야별 상위업체 판매액(2023년 기준)"이다.** 즉 공공조달몰 판매액 비중이며 전체 시장 점유율이 아니다. 10년 이상 사용 고객 비율은 81%다. — [와이즈넛 IR북](https://file.alphasquare.co.kr/media/pdfs/company-ir/20260514_IPO-%EC%99%80%EC%9D%B4%EC%A6%88%EB%84%9B_IR_BOOK.pdf)
- `[기사]` WISE iRAG는 2023-11에 처음 출시됐고 V2는 2025-01-23에 출시됐다. — [바이라인 2025-01](https://byline.network/2025/01/24-367)

### Inferences
- 세 회사 모두 "25년 검색 노하우 + 자체 LLM + 온프레미스 RAG + 에이전트"라는 같은 서사를 쓴다. 차별점은 솔트룩스가 온톨로지/지식그래프, 코난이 국방·공공 대규모 색인과 3-Source(내부·외부·고객 전용) 통합, 와이즈넛이 검색·챗봇 조달 점유율과 RAGOps 관리도구다.
- 레퍼런스 대부분이 공공기관 내부 규정·민원 상담과 금융 KMS다. "내부 규정·매뉴얼·이력 문서 기반 Q&A"가 이 시장의 표준 유스케이스라는 뜻이다. Synapse의 운영 매뉴얼·장애 이력 RAG와 구조가 같다.

### Gaps
- 국내 엔터프라이즈 검색이나 RAG **전체 시장 점유율**을 다룬 독립 조사(IDC, KOSIS 등)는 찾지 못했다.
- 와이즈넛 실제 상장 여부와 2024~2025 실적을 확인하지 못했다(IR북은 상장 전 자료). 솔트룩스·코난의 DART 사업보고서 원문도 확인하지 못했다.
- 솔트룩스 **GoldenRetriever, Lucy**: 2025~2026 자료를 전혀 찾지 못했다. 2026-10 홈페이지 제품 메뉴에도 없다. 단종이나 리브랜딩 여부는 알 수 없다.
- 코난 ENT-20·PRO-20: 2026-04 브로슈어 라인업(`LLM ENT-11 LLM ENT-20 On-Premise(+ RAG-X)`, `LLM PRO-10 LLM PRO-20 AIStation Server`)에 이름만 나온다. 출시 시점, 파라미터, 성능은 확인하지 못했다.
- 와이즈넛 고객 수가 자료마다 다르다. IR북 안에서도 "5,500곳(누적)", 연혁의 "고객사 2,000개 돌파", "약 3,000여개 고객사"가 함께 나오고, SF-1 페이지는 "2,200여 사이트"라고 한다. 5,500은 누적 기준이라 활성 고객 수와 다를 수 있다.
- 와이즈넛 iRAG V2가 GS인증을 받았는지(2025-01 기사 시점에는 "진행 중")는 확인하지 못했다. "국내 최초 GS인증 RAG"가 어느 회사인지 판정할 근거가 없다.

---

## 2. 한국어 처리: 형태소 분석기, Korean BM25/sparse, 복합명사·띄어쓰기·동의어 사전, 도메인 용어사전

### Takeaway
세 회사 중 공개 자료로 사전 관리 기능을 가장 구체적으로 확인할 수 있는 곳은 와이즈넛이다. SF-1 V7에 자체 한글 형태소 분석기, 사용자·동의어·불용어·금칙어 사전 편집 도구, 한자/한글 변환 색인, 오타 보정, 형태소 외 다른 방식의 색인이 명시돼 있다. 코난은 "25년 축적 언어 분석 기술 기반 고정밀 형태소 분석"을 주장한다. 솔트룩스는 A.RAG에서 렉시컬 검색에 BM25와 SPO 트리플을 쓴다고 밝혔지만 형태소 분석기 정보는 공개하지 않았다.

### Cited Findings
**와이즈넛 (SF-1 V7 / Vector Edition)**
- `[rea]` "자체 기술 한글 형태소 분석기를 이용한 정확한 검색 기능, 다양한 최신의 색인 기법 다수 적용", "다수의 랭킹 알고리즘 최적화 조합 가능 (근접도, 빈도수, 사용자 평점 등)". — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` 언어 처리 기능: "다국어 형태소 분석 지원 (한국어/중국어/일본어/영어)", "컬렉션 문서 별 다국어 형태소 분석 자동 처리", "유니코드 기반의 색인/검색", "**사전(사용자/동의어/불용어/금칙어) 편집 도구**". — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` 색인 기능: "대소문자 구별, 한자/한글 변환, 특수문자, 지정 필드 색인", "형태소 분석 외 다양한 방식의 색인 지원". 검색 기능: "오류(오타) 검색어 보정", "절단검색, 불리안검색, 인접검색", "소프트 매칭 기능", "의미기반 검색", "중복문서 그룹핑". — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` 아키텍처 모듈 중 "Language Analyzer: 언어 분석 구성 및 언어 처리"가 Indexer·Searcher와 분리된 독립 모듈이다. — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` Vector Edition 비교표에서 "동의어 및 유사 표현 대응" 항목을 키워드 검색 단독보다 키워드+벡터 조합이 낫다고 표시한다. — [Vector Edition](https://www.wisenut.com/sub/AIAgent/Vector.php)
- `[rea]` WISE LLOA: "25년간 고품질 한국어 코퍼스를 학습한 한국어 특화 초거대 언어모델". — [WISE LLOA](https://www.wisenut.com/sub/AIAgent/Llm.php)

**코난테크놀로지**
- `[rea]` Konan Search: "25년 이상 축적된 언어 분석 기술 기반의 고정밀 형태소 분석 지원"(이 문구 옆 "독보적인 검색 정확도 __% 이상" 수치는 미캡처). 행안부 사례에서 "형태소 분석 엔진이 정책 자료와 법령 정보를 정확도 순으로 최적화". 관리도구로 "인기 검색어, 검색 결과 미존재 키워드 등 사용자 행동 데이터 분석". — [Konan Search](https://www.konantech.com/products/search)
- `[PDF]` Konan LLM 아키텍처도에 "언어모델 토큰사전", "벡터·청크 저장소", Konan Search 연동 벡터검색이 나온다. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[스니펫]` 코난서치 6 구조에 "형태소 분석, 키워드 추출, N-Gram, Word2vec, FastText 등의 벡터 언어 모델"이 포함된다. 코난서치 4는 "국내 최대 규모의 형태소 사전"을 썼다고 한다(구버전 정보, 연도 미상). PDF가 리다이렉트돼 원문을 확인하지 못했다. — [코난서치6 제품소개서(스니펫)](https://brochure.konantech.com/wp-content/uploads/2025/04/코난서치6_제품소개서_코난테크놀로지.pdf)

**솔트룩스**
- `[rea]` A.RAG 렉시컬 서치: "재구성된 쿼리에서 SPO 트리플을 추출해 구조화된 키워드 검색을 수행하고, BM25 알고리즘과 최신성 부스팅을 적용". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` A.RAG: "한/영 쿼리 자동 확장으로 언어 장벽 없이 벡터 검색의 정확도를 높입니다", "한국어·영어 유사 쿼리를 자동 생성". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` Search Studio 헌법재판소 사례: "지능형 학습데이터를 구축 후 일반 생활용어로 검색하더라도 판례 및 법률 정보를 제공", "단어 중심의 기존 판례 검색의 한계를 넘어 의미 기반". 전문용어와 일상어 사이의 어휘 불일치를 학습데이터로 해결한 사례다. Search Studio는 "LANGUAGE STUDIO와의 연동을 통해 도메인별로 전문화된 언어모델을 제공"한다. — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[rea]` 문서 자동분류 엔진은 "기계학습과 규칙 기반의 하이브리드 엔진"이다. — [Search Studio](https://www.saltlux.com/ko/solution/search)

### Inferences
- 세 회사 모두 sparse 측은 **"자체 형태소 분석기 + 사전(사용자/동의어/불용어) + BM25 계열 랭킹"**이고, dense는 그 위에 얹은 형태다. CLAUDE.md 기준으로 Synapse는 sparse에 `Qdrant/bm25`를 쓴다. 이 모델은 한국어 형태소 분석을 하지 않는 것으로 알려져 있다(Synapse 쪽 전처리 코드는 미확인). 조사·어미가 붙은 한국어 어절("디스크가", "디스크를")이 서로 다른 토큰이 되므로 sparse 재현율이 떨어질 수 있다. 와이즈넛의 사전 편집 도구 구성(사용자/동의어/불용어/금칙어)이 Synapse가 보류 중인 "Korean BM25" 과제의 기능 범위를 정할 때 참고 기준이 된다(추론).
- 와이즈넛의 "한자/한글 변환 색인"과 "오타 보정", 솔트룩스의 "일상용어 → 전문용어" 학습데이터 접근은 운영 도메인의 약어·영문 혼용(예: OOM, GC, 커넥션풀/connection pool)에 대응하는 동의어 사전과 같은 문제를 푼다(추론).
- 솔트룩스의 한/영 쿼리 자동 확장은 한영 혼용이 많은 운영 로그·매뉴얼 검색에 바로 적용할 수 있는 패턴이다(추론).

### Gaps
- 솔트룩스가 쓰는 한국어 형태소 분석기(자체 여부, 제품명)와 BM25 토크나이저 상세는 공개 자료에 없다.
- 세 회사 모두 복합명사 분해 정책과 띄어쓰기 교정을 구체적으로 설명하지 않았다(와이즈넛 "소프트 매칭"이 관련 있을 수 있으나 정의가 없다).
- 형태소 분석기 정확도 수치는 확인하지 못했다(코난 수치는 카운터 미캡처).
- 도메인 용어사전을 운영하는 방식(누가, 어떤 주기로, 검수 절차)은 공개 자료에 없다.

---

## 3. 문서 수집/파싱: HWP/HWPX, PDF 표·이미지, OCR, 청킹, 메타데이터·권한(ACL)

### Takeaway
HWP(아래한글) 지원을 공개 페이지에 명시한 곳은 와이즈넛 SF-1 V7("MS Office, 아래한글, PDF")뿐이다. 솔트룩스 LUXIA Document Parse는 PDF·DOCX·이미지의 표·다단 레이아웃·OCR 처리와 "원문 정보 계층 보존"을 내세운다. 와이즈넛 iRAG는 "Document AI + 중복 제거 및 최적 청크화"를, 코난은 Doc AI를 기술 메뉴로 둔다. ACL은 코난(사용자별 열람권한 체크 후 벡터 질의)과 와이즈넛(문서 권한 정보 컬렉션 별도 구성, 권한별 결과 제한, 벡터DB 권한 처리)이 명시했다. 청크 크기 같은 구체 파라미터는 세 회사 모두 공개하지 않았다.

### Cited Findings
**솔트룩스**
- `[rea]` LUXIA Document Parse: "PDF·DOCX·이미지에서 텍스트·표·레이아웃을 정확히 추출", "일반 파서가 놓치는 복잡한 표 구조, 다단 레이아웃, 이미지 내 텍스트(OCR)까지 처리", "원문의 정보 계층과 구조를 그대로 살려 추출", "추출된 결과는 RAG 파이프라인, 검색 인덱싱… 즉시 연결". — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[rea]` Topic Summary: "핵심 주제별 계층 요약", "수천 건의 VOC 데이터도 주제별로 분류·정리". Scrap Web: URL 기반 본문 추출, 광고·메뉴 제거. — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[rea]` Search Studio 데이터 저장소: Oracle, MySQL(MariaDB), DB2, MongoDB, Cassandra, FTP/HTTP/NAS 파일 저장소, 실시간 저장소 연결 상태 관리, 수집 쿼리 관리, 작업 스케줄 관리. — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[rea]` Knowledge Studio: "정형/비정형 문서로부터 온톨로지 데이터를 자동 추출, 변환, 통합", "강력한 자연어 처리 엔진과 LLM 기반을 통해 다양한 문서로부터 지식을 추출". 정보추출 도구 KENT.V와 지식베이스 QA 도구 DeepQA를 둔다. — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[기사]` A.RAG는 텍스트, 이미지, 비정형 데이터를 지원하고 민감정보·개인정보 입출력을 필터링하는 "시큐리티 가드레일"을 적용한다. — [바이라인 2025-08](https://byline.network/2025/08/82891/)

**코난테크놀로지**
- `[rea]` RAG-X Internal Sources: "사내 문서·내부 DB·레거시 시스템 (인사·회계 등)". External: "실시간 웹사이트·커뮤니티, 공공기관·뉴스 자료, 학술 데이터". "LLMOps 기반 RAG 파이프라인 — 파이프라인 운영 관리 / 접근 권한 제어", "보안 격리 설계". — [Konan RAG-X](https://www.konantech.com/products/ragx)
- `[PDF]` "코난 LLM은 사용자별로 열람권한을 체크하여 정보 유출 위험을 줄이고, 접근권한이 있는 경우에는 프롬프트와 해당 업무문서를 결합". 도식: 질의 → 권한 관리 → 권한 있음이면 Konan Search6 벡터 질의, 권한 없음이면 접근 제한. 아키텍처에 "SSO / 권한", "유해콘텐츠" 필터, "개인정보 Safety Filter"가 있다. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[rea]` Konan Search: "대용량 정형·비정형 데이터에 최적화된 초고속 인덱싱", "TB급 데이터 환경", "자동 압축 기술". — [Konan Search](https://www.konantech.com/products/search)

**와이즈넛**
- `[rea]` SF-1 V7: "다양한 DBMS, 파일(MS Office, **아래한글**, PDF 등) 검색 지원", "다양한 첨부파일 내용 검색", "갱신된 데이터만 선택적으로 수집하는 동적 색인", "색인 중단 시 중단 시점부터 재 색인", "실시간 색인… 저장 및 색인 후 1초 이내", "**문서 권한 정보 컬렉션 별도 구성 가능**", "**권한에 따른 검색결과 제한**", "색인 데이터 이중화". — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` WISE iRAG: "다양한 포맷과 복잡한 구조의 어떤 문서도 처리할 수 있는 Document AI 기술", 강점으로 "**중복 제거 및 최적 청크화**". — [WISE iRAG](https://www.wisenut.com/sub/rag/irag.php)
- `[rea]` Vector Edition 비교 항목: "이미지, 표 내 텍스트 검색 확장성". — [Vector Edition](https://www.wisenut.com/sub/AIAgent/Vector.php)
- `[기사]` iRAG V2: "전처리 기능 강화", "벡터DB 기반 카테고리 검색 및 권한 처리 기능". — [바이라인 2025-01](https://byline.network/2025/01/24-367)

### Inferences
- 세 회사 모두 ACL을 **검색 단계(색인 필터)에서 강제**한다. 생성 단계에서 거르는 방식이 아니다. 와이즈넛은 권한 정보를 별도 컬렉션으로 두고, 코난은 질의 전에 권한을 확인한다. Synapse로 옮기면 Qdrant payload의 `system_id`/`system_name` 필터를 사용자 권한(담당 시스템)과 묶어 검색 시점에 강제하는 방식이다(추론).
- "동적 색인(변경분만)", "중단 시점부터 재색인", "실시간 색인 1초 이내"는 운영 문서와 장애 이력이 계속 늘어나는 Synapse의 증분 색인 설계에 그대로 적용할 수 있는 요건이다(추론).
- 와이즈넛이 청크화와 함께 "중복 제거"를 강조한 점, 솔트룩스가 "원문 계층 보존" 파싱을 강조한 점을 보면, 청킹 품질 차이는 크기 튜닝보다 구조 보존과 중복 제거에서 더 크게 난다는 것이 벤더들의 공통 인식이다(추론).

### Gaps
- 솔트룩스·코난의 HWP/HWPX 지원 여부는 공개 페이지에서 확인하지 못했다(LUXIA Document Parse는 PDF·DOCX·이미지만 명시).
- 세 회사 모두 청크 크기, 오버랩, 계층형(부모-자식) 청킹 여부를 공개하지 않았다. 와이즈넛 V2의 "최대 8000어절" 벡터 모델이 청크 길이 상한과 관련 있을 수 있으나 확인하지 못했다.
- 솔트룩스의 문서 ACL(권한 필터) 방식은 공개 자료에 없다.
- OCR 엔진(자체·서드파티)과 정확도 수치는 세 회사 모두 없다.

---

## 4. 검색: 하이브리드 결합, 리랭커, 쿼리 재작성·확장, 출처 표시, 할루시네이션 억제/답변 거부

### Takeaway
공개된 파이프라인 사양은 **솔트룩스 A.RAG가 가장 구체적**이다. 최근 2턴 대화로 쿼리를 재구성하고, 한·영 유사 쿼리를 만들어 Milvus 벡터 검색(최신성 부스팅, 멀티쿼리 상위 50)을 하고, SPO 트리플 + BM25 렉시컬 검색과 Google 메타서치를 함께 돌린 뒤, 결과를 통합해 중복을 제거하고 BERT 리랭킹으로 상위 10~15개를 생성 단계에 넘긴다. 코난 RAG-X는 "하이브리드(벡터+키워드) 정밀 랭킹 + 모든 답변 출처 명시 + 추천 질문 + 에이전틱 멀티스텝"을, 와이즈넛은 "하이브리드 검색 + Reranker 모델 관리·서빙 + Retrieval 학습용 데이터셋으로 임베딩 모델 개선"을 내세운다. 명시적인 "답변 거부" 정책은 세 회사 모두 공개하지 않았다.

### Cited Findings
**솔트룩스 A.RAG (Agentic RAG Studio)**
- `[rea]` 구성: "실시간 메타서치, 벡터 검색, 렉시컬서치, 통합 리랭킹… 검색의 전 과정을 하나의 파이프라인으로 지원". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` 쿼리 재작성: "**최근 2턴의 대화 이력을 반영해 쿼리를 재구성**하고, 한국어·영어 유사 쿼리를 자동 생성해 **Milvus DB** 등 벡터 DB에서 최적의 결과를 도출합니다. **최신성 부스팅**을 적용해 **멀티쿼리 기준 상위 50개**의 풍부한 검색 결과를 확보". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` 렉시컬: "재구성된 쿼리에서 **SPO 트리플을 추출**해 구조화된 키워드 검색을 수행하고, **BM25** 알고리즘과 최신성 부스팅을 적용… 시맨틱 서치와 상호 보완". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` 메타서치: "Google CustomSearchAPI를 통해 외부 웹 데이터를 실시간으로 수집", "스니펫 검색과 전체 본문 검색을 병행". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` 결합·리랭킹: "메타서치·시맨틱서치·렉시컬서치의 결과를 통합하고 **중복 문서를 제거**한 후, **BERT 기반 리랭킹 모델**로… 재배열합니다. **최종 상위 10~15개 문서를 압축해 답변 생성 단계로 전달**, 근거와 함께". "답변과 함께 참조 문서와 근거를 함께 제공". — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` Agentic RAG 패턴: "검색 결과가 부족하면 질의를 재구성해 추가 탐색한 뒤, 최종적으로 요약·비교·보고서 초안 작성까지"(검색 → 재탐색 → 근거 정리 → 문서 생성). — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` 페이지가 적용 시나리오로 든 예 중 "**IT 운영 장애 대응 에이전트** — 장애 티켓, 운영 매뉴얼, 유사 사고 이력을 종합해 원인 분석과 대응 절차를 추천… '최근 비슷한 장애가 있었는지', '어떤 대응 절차를 먼저 밟아야 하는지'를 물으면… 유사도 높은 사례를 추려 우선순위 있는 대응안을 정리"가 있다. 페이지는 "국내외 사례: 롯데쇼핑, AWS"라고 병기하지만, 이것이 솔트룩스 고객이라는 서술은 없다(업계 사례 예시로 보임). 같은 형식으로 "자연어 기반 데이터 분석 에이전트(NL2SQL)", "제조 현장 장애 이력 검색", "규제·품질(SOP, CAPA)"도 든다. — [A.RAG](https://www.saltlux.com/ko/solution/arag)
- `[rea]` LUXIA: "통합 지식 그래프와 사실 기반 출력(Factual Output) 기술로 환각 현상을 구조적으로 최소화", "RAG 응용 시 문서 파싱, 주제 요약, 비전 기능과 연동하여 외부 근거 기반의 답변". — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[rea]` Search Studio: "문장 벡터 기반 맥락검색", "MRC(기계독해) 기반 정답 검색 — 문서 내 핵심 답변을 빠르게 추출", "대용량 병렬 분산 검색", 문서 요약/비교. — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[rea]` Knowledge Studio: "온톨로지 RAG를 통한 사용자 질의에 대한 답변과 근거 제공", "RDF 기반 온톨로지… 추론(RDFS, OWL, OWL2)". — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[기사]` 온톨로지는 "에이전틱 AI에 데이터를 이해시키는 틀"이다. LLM이 비정형 데이터에서 지식을 추출해 온톨로지를 자동 구축하면 추론의 기반이 되어 환각이 줄어든다. — [바이라인 2025-10](https://byline.network/2025/10/10113/)

**코난 RAG-X / Konan Search**
- `[rea]` "**하이브리드 검색(벡터+키워드) 기반 정밀 랭킹**", "**모든 답변에 출처 명시 + 추천 질문 자동 제공**", "에이전틱 RAG — 멀티스텝 추론 기반 복합 질의 자동 처리", "출처 투명성 기반의 신뢰도 높은 답변". 기존 검색 AI의 한계로 "출처 불명확, 할루시네이션 빈번", "단순 키워드 검색 - 복합 질의 처리 불가"를 든다. — [Konan RAG-X](https://www.konantech.com/products/ragx)
- `[rea]` 사례 패턴: 검색 결과에서 "필수 조건 항목을 추출해 자격 판정 대화로 연결"(주거복지), "근거 자료 링크 제공"(가스안전), "근거(출처) 정보 및 요약"(소장자료). — [Konan RAG-X](https://www.konantech.com/products/ragx)
- `[rea]` Konan Search: "벡터 검색과 생성형 AI 기반 RAG로 근거 있는 답변을 제공하는 기업용 검색엔진", "Konan LLM과 통합한 검색증강생성". — [Konan Search](https://www.konantech.com/products/search)
- `[PDF]` 에이전틱 구성: Planner → Supervisor → Researcher(검색·크롤링) → Fileworker(업로드 파일 분석) → Reporter(보고서 생성)로 이어지는 다중 에이전트 협업. 코난 AI Agent의 핵심 기능은 Deep Research와 NL2SQL이고, "자체 검토를 통해 정보 공백과 오류를 찾아 수정"한다고 설명한다. MCP로 외부·레거시 시스템을 연동한다. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)

**와이즈넛 WISE iRAG / SF-1 V7 Vector Edition**
- `[rea]` iRAG 강점: "25년 노하우가 담긴 정확하고 안정적인 하이브리드 검색", "자체 언어모델 포함 / 다양한 LLM의 유연한 연계". RAGOps: "**Retrieval 학습을 위한 데이터셋 관리 — 학습된 데이터 기반 임베딩 모델 성능 개선**", "검색엔진 컬렉션 관리 — 키워드/벡터검색 사용을 위한 컬렉션관리", "**Reranker 모델 관리 및 서빙 — 검색 정확도 향상**". — [WISE iRAG](https://www.wisenut.com/sub/rag/irag.php)
- `[rea]` Vector Edition 결합 전략: "**명확한 키워드 질의에는 키워드 검색을, 질문형이나 장문의 자연어 질의에는 문맥 기반의 벡터 검색**… 사용자의 검색 유형과 데이터 특성에 따라 키워드 검색과 벡터 검색을 유연하게 조합". 예시 질의는 '하루에 송금 가능한 최대 금액'. — [Vector Edition](https://www.wisenut.com/sub/AIAgent/Vector.php)
- `[rea]` SF-1 V7 랭킹: 근접도·빈도수·사용자 평점 조합, 검색결과 부스팅, 개인별 검색 랭킹, 카테고리 인덱스, 가상 컬렉션. — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[기사]` iRAG V2의 "자체 튜닝 벡터검색 모델: 최대 8000어절까지 문맥 의미 파악 가능". — [바이라인 2025-01](https://byline.network/2025/01/24-367)
- `[PDF]` IR북(2025-01 시점) 비교표: 생성형 AI 단독의 한계를 "최신정보 제안 불가능, 할루시네이션 현상 발생, 보안에 취약"으로, 검색 연계의 효과를 "최신정보 제공, 할루시네이션 최소화, 내부 온프레미스 구축 기반 도메인 특화 생성형 AI"로 정리한다. — [와이즈넛 IR북](https://file.alphasquare.co.kr/media/pdfs/company-ir/20260514_IPO-%EC%99%80%EC%9D%B4%EC%A6%88%EB%84%9B_IR_BOOK.pdf)

### Inferences
- **Synapse와 비교(추론)**: Synapse는 Dense(bge-m3) + Sparse(BM25) Hybrid → RRF(k=2) → bge-reranker-v2-m3 구조다. A.RAG에는 아래 요소가 명시돼 있다. Synapse에 이미 있는지는 **Synapse 코드를 확인하지 않았으므로 검증이 필요하다**(47개 도구를 쓰는 ReAct 챗봇이 도구 호출 과정에서 사실상 쿼리를 재구성하고 있을 수도 있다).
  1. 멀티턴 쿼리 재구성(최근 2턴): 챗봇에서 이어지는 질문의 검색 품질에 직결된다.
  2. 한·영 멀티쿼리 확장
  3. 최신성 부스팅: 장애 이력은 최근 것일수록 관련성이 높다.
  4. 리랭킹 전 후보 풀 크기(50)와 생성 단계 전달 수(10~15)의 명시적 분리
  5. 다중 소스 통합 후 중복 제거
- 와이즈넛의 "질의 유형별 키워드/벡터 가중 전환(키워드형 → sparse 우선, 질문형 → dense 우선)"은 고정 RRF 대신 쿼리 분류에 따라 가중치를 바꾸는 방식이다. 운영 환경에서는 에러코드·호스트명 같은 정확 매칭 질의와 "왜 느려졌나" 같은 서술형 질의가 섞이므로 적용 가치가 있다(추론).
- 와이즈넛 RAGOps의 "Retrieval 학습용 데이터셋 → 임베딩 모델 개선"과 "Reranker 모델 관리·서빙"을 보면, 국내 벤더들은 임베딩과 리랭커를 고객 도메인 데이터로 파인튜닝하는 것을 표준 운영 절차로 둔다(추론).
- "답변 거부"는 세 회사 모두 "출처 명시"와 "근거 기반"으로만 표현한다. 근거가 부족할 때 거부하는 임계값 정책은 공개하지 않았다(추론: 구축 프로젝트마다 커스터마이징하는 영역일 가능성).

### Gaps
- 코난·와이즈넛의 하이브리드 점수 결합 공식(RRF, 가중합 등)과 리랭커 모델 종류는 공개되지 않았다.
- 세 회사 모두 근거 점수 임계값에 따른 답변 거부나 "모르겠습니다" 응답 정책은 공개 자료에 없다.
- 솔트룩스 "Factual Output" 기술의 구체 메커니즘(제약 디코딩, 검증 단계 등)은 설명되지 않았다.
- 출처 표시 단위(문서, 페이지, 문단 하이라이트)는 확인하지 못했다.

---

## 5. 지식 자산화: 큐레이션·검수, 피드백 루프, 버전 관리, FAQ 자동생성, 지식 그래프

### Takeaway
지식 그래프·온톨로지로 자산화하는 쪽은 **솔트룩스**가 독보적이다. Knowledge Studio는 RDF/OWL 추론, 문서에서 온톨로지 자동 추출, 변환 규칙 편집기, 그래프 DB를 갖추고, A.RAG와 연동한다. 와이즈넛은 RAGOps GUI(프롬프트·학습데이터셋 관리, 검색·답변 시뮬레이션, "나만의 AI 학습")로 운영 중 개선 루프를 제공하고, 코난은 LLM Studio(노코드 MLOps, 프롬프트 갤러리, 배치 평가)와 Konan Search 검색로그 분석(미존재 키워드)을 제공한다. 사용자 피드백(좋아요/정정)이 재색인이나 재학습으로 이어지는 자동 루프를 명시한 곳은 없다. 다만 솔트룩스 Search Studio의 "Active Learning 기반 지속 학습"이 가장 가깝다.

### Cited Findings
**솔트룩스**
- `[rea]` Knowledge Studio: "기업 및 조직 내에 있는 지식을 효율적으로 구축하고 관리하기 위한 STUDIO", "의미상으로 연결된 자산 데이터". 세부기능은 플러그인 관리, 사용자 함수 자동완성(데이터 정제·결합), "타당성 검증을 위한 변환규칙 편집", 데이터 변환·테스트, 다양한 뷰어, 프로젝트 관리. 그 밖에 "Graph Data 저장 및 추론", 정보추출 도구 KENT.V, 지식베이스 QA 도구 DeepQA, 데이터 통합관리. — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[rea]` "실시간으로 수집/변경되는 지식에 대한 실시간 반영과 분석", "그래프 인덱스 생성기, 사용자/시간대/토픽/관심사별 지식네트워크 분석기", "아시아 최초 AI와 Graph DB 기술의 융합 및 상용화", "초대용량 그래프 데이터 처리", "강력한 추론엔진 내장". — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[rea]` 금융 사례: 1·2금융권 상품정보를 수집하고 정제해 상품통합DB를 만든 뒤 "지식그래프로 변환 저장되어 질의응답(QA) 서비스로 활용". — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[rea]` Search Studio: "**Active Learning 기반의 초거대 언어모델 지속적인 학습을 통해 점점 똑똑해지는 지능형 검색**", "LANGUAGE STUDIO와의 연동… 클러스터링, 문맥 요약, 맥락검색, 정답검색의 품질이 지속적으로 높아지는". — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[rea]` LUXIA Cloud: "모델 형상·버전 관리와 전주기 LLMOps 체계", "프롬프트 파인튜닝과 증분 학습을 적용하면 조직 고유의 언어와 규칙을 학습". — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)

**코난테크놀로지**
- `[PDF]` 코난 LLM 스튜디오(노코드 MLOps): 대시보드(컨테이너 상태, 전체 GPU 사용량, 시간대별 LLM 사용 현황), 모델 관리, 프롬프트 갤러리(템플릿), 플레이그라운드(모델 비교), "Batch·평가 — 대량의 프롬프트를 일괄 처리 / LLM을 활용한 평가 / 파인튜닝을 위한 학습 데이터 생성 / 데이터 확장". — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[rea]` Konan Search "지능형 검색 관리 및 분석 — 인기 검색어, **검색 결과 미존재 키워드** 등 사용자 행동 데이터를 분석하는 직관적인 관리 도구". RAG-X "LLMOps 기반 RAG 파이프라인 운영 관리". — [Konan Search](https://www.konantech.com/products/search), [Konan RAG-X](https://www.konantech.com/products/ragx)
- `[rea]` 기술 메뉴에 "그래프검색"이 있다(상세 미캡처). — [코난 홈](https://www.konantech.com/)

**와이즈넛**
- `[rea]` RAGOps: "GUI 기반의 직관적 시스템… 생성형 추론/모델 학습, **답변 시뮬레이션**, 모델관리, 프롬프트 관리", "① 답변 생성을 위한 프롬프트 관리 ② LLM 학습을 위한 데이터셋 관리 ③ 검색 및 답변 시뮬레이션 기능". 한국도로공사 사례에는 "나만의 AI 학습 기능"이 있다. — [WISE iRAG](https://www.wisenut.com/sub/rag/irag.php)
- `[rea]` SF-1 V7 "중복문서 그룹핑", 텍스트 마이닝·분류·요약·토픽 추출 연동. — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php)
- `[rea]` WISE LLOA "고객 데이터를 효과적으로 반영하기 위한 다양한 학습 기법 지원 (추가 학습, 테스크 학습, 파인튜닝)". — [WISE LLOA](https://www.wisenut.com/sub/AIAgent/Llm.php)
- `[rea]` iRAG 레퍼런스 표에 "우리은행 비정형데이터 자산화 사업"이 있다. — [WISE iRAG](https://www.wisenut.com/sub/rag/irag.php)

### Inferences
- 국내 벤더의 "지식 자산화"는 두 갈래다. ① 구조화(솔트룩스: 문서 → 온톨로지/SPO 트리플 → 그래프 추론), ② 운영 루프(와이즈넛·코난: 검색로그·답변 시뮬레이션·학습데이터셋 → 임베딩·리랭커·LLM 재학습). Synapse에 바로 옮기기 쉬운 쪽은 ②다. 그중 코난의 "검색 결과 미존재 키워드" 분석은 지식 공백(문서화가 필요한 장애 유형)을 찾는 저비용 신호로 쓸 수 있다(추론).
- 솔트룩스 A.RAG가 렉시컬 검색에 SPO 트리플을 쓰는 방식은 장애 이력을 (시스템, 증상, 원인/조치) 트리플로 정규화해 색인하는 아이디어로 확장할 수 있다. 다만 구축·유지 비용이 크다(추론).
- 와이즈넛의 "답변 시뮬레이션"은 프롬프트나 모델을 바꿀 때 회귀를 확인하는 도구다. Synapse에서는 고정 질의셋 기반 RAG 회귀 테스트에 해당한다(추론).

### Gaps
- 좋아요/정정 피드백이 재색인이나 재학습에 반영되는 자동화 흐름은 세 회사 모두 공개하지 않았다.
- 지식 검수·승인 워크플로(작성 → 검토 → 게시)와 문서 버전 관리 방식은 확인하지 못했다.
- FAQ 자동생성 기능을 명시한 자료는 찾지 못했다(코난 "추천 질문 자동 제공"이 가장 가깝다).

---

## 6. 정확도 평가: 자체 벤치마크·수치, 평가 데이터셋 운영

### Takeaway
공개된 정확도 수치는 모두 **벤더 자체 주장**이고 독립 검증은 없다. 예로 솔트룩스 KT 기가지니 심층 QA "정답확률 94%"(연도 미상), 코난 ENT-11 "ENT-10 대비 4.5%p 향상, 자체 평가 MT-Bench에서 DeepSeek-R1 대비 8개 항목 우위", 와이즈넛 고객사례 "88% / 96.8% / 86.5%"(어느 사례의 어느 지표인지 매핑 불명)가 있다. RAG 검색 정확도를 측정하는 방법론이나 평가 데이터셋 운영은 와이즈넛(Retrieval 학습 데이터셋, 답변 시뮬레이션)과 코난(LLM Studio 배치 평가, LLM-as-judge)이 도구 수준으로만 언급한다. GS인증 1등급(솔트룩스 A.RAG 2025-08, 코난 RAG-X 2025-09)은 TTA의 소프트웨어 품질 인증이지 검색 정확도 인증이 아니다.

### Cited Findings
- `[rea]` 솔트룩스: KT 기가지니 백엔드 QA가 "지속적인 학습을 통해 **정답확률 94%수준**의 일반 도메인, 생활정보, 일반상식, 전문 심층질의응답까지 제공"한다(연도 미표기, 오래된 사례로 추정). — [Knowledge Studio](https://www.saltlux.com/ko/solution/knowledge)
- `[rea]` 솔트룩스 LUXIA Cloud: "Claude Sonnet 대비 1/18, GPT 4o 대비 1/12 수준의 토큰 비용으로 동일한 LLM 품질", "월 10억 토큰… luxia3-llm-32b 기준 월 약 70만 원", "100만 이상 이용자가 검증". 모두 마케팅 주장이고 "동일 품질"의 근거 벤치마크는 제시하지 않았다. — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[PDF]` 코난 ENT-11: "자체 평가한 벤치마크에서 DeepSeek-R1 모델 대비 작문, 역할극, 추론, 코딩 등 8개 항목에서 우위". 비교 대상은 Konan LLM 32B(ENT-11), DeepSeek-R1-32B, DeepSeek-R1-671B이고 지표는 "Konan MT Bench(한국어) / MT Bench(영어)"다. "이전 ENT-10 모델 대비 4.5%p 향상"이라고 한다. 학습 데이터는 펄스K용으로 수집한 문서 250억 건 중 양질의 약 20억 건이다. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[rea]` 코난 Konan Search: "동일 서버 구성 대비 4배 많은 데이터 처리로 인프라 비용 최대 75% 절감". "독보적인 검색 정확도 __% 이상"의 수치는 미캡처다. — [Konan Search](https://www.konantech.com/products/search)
- `[PDF]` 와이즈넛 IR북(2025-01): 고객 사례 지표로 "유사문서 군집재현율 / 연관검색 정확도 / 민원 만족도 / 반복업무개선"과 "88%, 96.8%, 86.5%, 260개 항목, 4만 명, 44,000시간"이 나열돼 있다. pdftotext 레이아웃 추출 과정에서 수치와 사례의 대응이 뒤섞여 **어느 수치가 어느 고객·지표인지 특정할 수 없다**. 벤더 주장이다. — [와이즈넛 IR북](https://file.alphasquare.co.kr/media/pdfs/company-ir/20260514_IPO-%EC%99%80%EC%9D%B4%EC%A6%88%EB%84%9B_IR_BOOK.pdf)
- `[기사]` GS인증 1등급: 솔트룩스 루시아 A.RAG(2025-08), 코난 RAG-X(2025-09). — [바이라인 2025-08](https://byline.network/2025/08/82891/), [바이라인 2025-09](https://byline.network/2025/09/9051/)
- `[스니펫]` 공개 리더보드에 솔트룩스 luxia-21.4b-alignment-v1.0/v1.2와 Ko-Llama3-Luxia-8B가 Open Ko-LLM Leaderboard 등에 등재돼 있다(구버전 모델). — [benchmarklist.com/saltlux](https://benchmarklist.com/providers/saltlux/)

### Inferences
- 세 회사 모두 **검색 단계 지표(Recall@k, nDCG, MRR)를 공개하지 않는다**. LLM 벤치마크나 업무 효과(시간 절감)만 내세운다. Synapse가 자체 평가셋(질의-정답 문서 쌍)으로 Recall@k를 측정하면 벤더 비교보다 실질적인 품질 근거가 된다(추론).
- 코난의 "LLM을 활용한 평가 + 배치 처리"와 와이즈넛의 "검색·답변 시뮬레이션"은 상용 제품에서도 LLM-as-judge와 회귀 시뮬레이션을 평가 표준 도구로 쓴다는 신호다(추론).

### Gaps
- 독립 제3자(NIA, TTA 성능시험, 학술)가 세 회사의 RAG 검색 정확도를 비교한 자료는 찾지 못했다.
- 평가 데이터셋 구축·운영 절차(규모, 라벨링 주체, 갱신 주기)는 공개되지 않았다.
- 솔트룩스 LUXIA 3의 공개 벤치마크(Ko-MMLU, LogicKor 등) 수치는 확인하지 못했다.

---

## 7. 배포: 온프레미스/폐쇄망, GPU 요구사항, sLLM

### Takeaway
세 회사 모두 **온프레미스·폐쇄망 구축을 기본 옵션**으로 제공한다. 코난은 모델을 크기별로 나눠(OND: AIStation, PRO: AIStation Server, ENT: On-Premise + RAG-X) 어플라이언스와 온프레미스를 함께 팔고, "작은 모델은 CPU에서도 동작"한다고 한다. 솔트룩스는 클라우드 API(LUXIA Cloud)와 어플라이언스(루시아 온)를 함께 운영하며 "클라우드와 폐쇄망 환경 모두"를 명시했다. 와이즈넛은 SF-1 V7 온프레미스·멀티클라우드와 양자화 경량 LLM(WISE LLOA)을 제공한다. 구체적인 GPU 사양은 세 회사 모두 공개하지 않았다.

### Cited Findings
- `[rea]` 솔트룩스 LUXIA Cloud: 공공기관 민원 응대 시나리오에 "**클라우드와 폐쇄망 환경 모두에서** 민원 분류, 문서 요약, 서식 작성 등 행정 업무를 자동화". "양자화, GPU 동적 확장 등 자체 인프라 최적화". 단일 게이트웨이로 GPT·Gemini·Claude·Perplexity와 이미지·음성·번역 API를 함께 호출한다. — [LUXIA Cloud](https://www.saltlux.com/ko/platform/luxia)
- `[rea]` 솔트룩스 홈 배너: "AI 서버 '루시아 온'"(어플라이언스형 제품, 2026-10 프로모션). — [솔트룩스 홈](https://www.saltlux.com/ko/index)
- `[rea]` 솔트룩스 Search Studio: "분산 색인과 분산 검색", "Scale-Out 할 수 있는 유연한 구조". — [Search Studio](https://www.saltlux.com/ko/solution/search)
- `[PDF]` 코난: "OND, PRO, ENT 모델을 바탕으로 AI Appliance(AIStation/AIStation Server)부터 On-Premise(RAG-X)까지", "작은 모델은 CPU에서도 원활히 동작해 전력 소비를 줄이고, 큰 모델은 GPU 연산으로 성능 극대화", "‘온프레미스 솔루션’으로 제공하여 민감 정보에 대한 안전을 보장". ENT-11은 일반·추론 통합 모드로 "더 적은 GPU 비용"을 내세우고, 크기는 32B다. — [Konan LLM 브로슈어 2026-04](https://www.konantech.com/storage/ai-agent/2026/04/30/bss256jbUGLeC5O8QGBS0pi3y3a9U4sQ7GcNjUXZ.pdf)
- `[스니펫]` ENT-11은 일반·추론 모델을 따로 두는 경쟁사 대비 GPU 사용량을 약 절반으로 줄인다고 하며, DeepSeek R1(671B)보다 20배 이상 작다. — [아시아경제 2025-03-26](https://view.asiae.co.kr/article/2025032610441885095)
- `[rea]` 코난 RAG-X: "보안 격리 설계 — 내부 데이터 보호와 외부 정보 활용을 동시에 실현", "민감 내부 정보를 보호하면서 생성형 AI를 보안 리스크 없이 전사 도입". — [Konan RAG-X](https://www.konantech.com/products/ragx)
- `[rea]` 와이즈넛 SF-1 V7: "AWS, Google Cloud, Azure, Naver Cloud 등 클라우드 플랫폼 어디에서나… 또한 On-Premise에서도 다운로드하여 실행", 로드밸런싱과 Fault Tolerance, 색인 배포. 홈에는 "클라우드서비스 보안인증"이 표기돼 있다. — [SF-1 V7](https://www.wisenut.com/sub/ai/sch.php), [와이즈넛 홈](https://www.wisenut.com/)
- `[rea]` 와이즈넛 WISE LLOA: "진일보한 양자화 기반 경량화 기술 적용으로 효율적인 경량형 모델 제공 (경량화모델 추가학습 가능)", "도메인 특화된 고객 맞춤형 Reasoning Model 제공". — [WISE LLOA](https://www.wisenut.com/sub/AIAgent/Llm.php)

### Inferences
- 세 회사 모두 "검색엔진(CPU) + 임베딩·리랭커(소형 모델) + 중형 sLLM(약 32B, 양자화)"을 폐쇄망의 표준 조합으로 본다. Synapse의 폐쇄망 구성(CPU ONNX 임베딩·리랭커 + 외부 DevX/Claude LLM)은 LLM 측만 다르고 검색 스택은 같은 방향이다(추론).
- 코난의 "작은 모델 CPU / 큰 모델 GPU" 계층화는 Synapse의 FastEmbed ONNX int8 리랭커처럼 검색 보조 모델을 CPU에서 돌리는 설계가 상용 업계에서도 쓰인다는 방증이다(추론).

### Gaps
- 세 회사 모두 권장 GPU 사양(모델별 VRAM, 장비 수), 최소 하드웨어 요건, 동시접속 대비 처리량을 공개하지 않았다.
- 폐쇄망에서 모델 업데이트와 재학습 절차(오프라인 반입 방식)는 확인하지 못했다.
- 루시아 온(어플라이언스) 하드웨어 구성과 가격 정보는 확인하지 못했다(홈 배너 문구만 있음).
