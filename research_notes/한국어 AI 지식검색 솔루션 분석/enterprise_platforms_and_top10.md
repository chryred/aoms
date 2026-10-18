# 국내 대기업 AI 지식 플랫폼 프로파일 + 한국어 최적화 엔터프라이즈 AI 지식검색/RAG Top 10 검증 (기준: 2026-10)

> 출처 표기 규칙
> - **[rea]** = 2026-10-19 rea MCP(`inspect_web_page`, 접근성 텍스트)로 공식 제품 페이지를 직접 캡처해 확인한 사실. URL은 캡처한 페이지.
> - **[웹]** = WebSearch/WebFetch로 확인한 언론·공식 보도.
> - 마케팅 문구(벤더 자기 주장)는 "(벤더 주장)"으로 따로 표시했다. 독립 검증된 정확도 수치는 이번 조사에서 **어느 벤더에 대해서도 찾지 못했다**.
> - rea 캡처 대상: 삼성SDS FabriX, LG CNS Agentic AI(AgenticWorks), LG CNS AX 플랫폼(DAP GenAI), LG AI연구원 EXAONE, 카카오 Kanana. 처음에 시도한 삼성SDS URL 2개(`/kr/genai/fabrix.html`, `/kr/brity-copilot/brity-copilot.html`)와 LG CNS `/business/ai/`는 404/오류 페이지였다. 그래서 홈페이지 링크에서 찾은 올바른 URL로 다시 캡처했다. 공식 페이지 FAQ의 답변 본문은 접힌 상태라 질문 제목만 잡혔다.

## Part A-1. 삼성SDS — FabriX(패브릭스) / Brity Copilot / Brity Works

### Takeaway
2026년 FabriX의 공식 포지셔닝은 "검색 엔진"이 아니라 **"기업을 위한 AI Agent 플랫폼"**이다. RAG·지식검색은 그 안의 한 기능으로 들어가 있다. 경쟁력은 RAG 알고리즘이 아니라 삼성 관계사 전체 도입 규모, 공공 대형 사업 수주(범정부 초거대 AI 공통기반, 정부24, 국회), 온프레미스·프라이빗 구성, MCP 기반 업무 시스템 연계에서 나온다. 한국어 형태소·sparse·청킹·리랭킹 같은 기술 세부는 공개 자료에서 거의 확인되지 않는다.

### Cited Findings
- **[rea]** 공식 페이지 타이틀은 "기업을 위한 AI Agent 플랫폼 FabriX 패브릭스"이고, 슬로건은 "AI Agent 개발부터 실행, 운영까지 하나의 플랫폼에서", "기업의 지식과 시스템을 연결해 AI Agent의 실행을 완성합니다"이다. 구성 요소로 AI Workspace, Marketplace("다양한 AI 자산을 통합 관리"), Governance("늘어나는 AI Agent의 현황을 한눈에 파악")를 내세운다. — [삼성SDS FabriX](https://www.samsungsds.com/kr/ai-fabrix/fabrix.html)
- **[rea]** 적합 고객으로 "분산된 사내 지식과 데이터의 통합 활용이 필요한 기업", "보안 요구 수준이 높은 환경의 기업"을 명시한다. 기능 설명은 "사내에 축적된 문서와 데이터를 AI 기반 검색 및 Q&A 기능으로 연결", "금융, 공공, 대기업 등 … On-premise 및 프라이빗 AI 구성"이다. — [삼성SDS FabriX](https://www.samsungsds.com/kr/ai-fabrix/fabrix.html)
- **[rea]** 권한: "Asset의 유형과 특성에 따라 접근 권한을 설정", "MCP Server를 통해 연계 … 데이터베이스, 파일 저장소, 그룹웨어 등과 연결된 경우 AI Agent는 권한 범위 내에서 필요한 정보를 조회"한다. FAQ 질문 목록에는 "어떤 LLM을 사용하나요?", "온 프레미스 버전도 제공하나요?", "멀티모달을 지원하는지요?", "사내 데이터가 외부(LLM 학습 등)로 유출될 위험은 없나요?"가 있다. 답변 본문은 캡처되지 않았다. — [삼성SDS FabriX](https://www.samsungsds.com/kr/ai-fabrix/fabrix.html)
- **[rea]** 같은 페이지의 인사이트 글 "공공 AX, 이제는 실행이다"에서 2026년 공공 AX 과제로 "지식 자산화, 에이전틱 행정, 공공 AI 보안"을 꼽는다. — [삼성SDS FabriX](https://www.samsungsds.com/kr/ai-fabrix/fabrix.html)
- **[웹]** FabriX는 24개 삼성 관계사 전체가 사용한다. 삼성SDS는 FabriX·Brity Copilot·Brity Automation을 "에이전틱" 단계로 끌어올렸다고 발표했고, 인천국제공항공사와 Brity Copilot 기반 협력을 맺었다. — [데일리안](https://www.dailian.co.kr/news/view/1357314/), [CIO Korea](https://www.cio.com/article/3521356/)
- **[웹]** Brity Copilot은 17개 삼성 관계사와 외부 고객사를 합쳐 18만 명 이상이 사용한다(메일·메신저·회의록·문서요약). 공공에서는 '범정부 초거대 AI 공통기반', 행정안전부 '지능형 업무관리 플랫폼 구축 사업'을 수주했다. — [딜사이트](https://dealsite.co.kr/articles/143252) (기사 날짜 미확인, 2025년 추정)
- **[웹]** 2026-06-24 NIA 주관 '2026 공공 AI 박람회' 설명회에서 법제처와 정부24가 FabriX로 AI 에이전트를 구축 중이라고 소개됐다. 패브릭스는 MCP 서버 구축, RAG 구성, 업무 시스템 연계를 노코드·코드 환경으로 지원한다. 정부24 AI 구조는 "답변 가능 여부를 먼저 판단 → RAG로 관련 정보 검색 → 질의 연결성 검증 → LLM 최종 응답"이며, 정보 관련성을 반복 검증해 환각을 줄이는 방식이다. — [ZDNet Korea 2026-06-24](https://zdnet.co.kr/view/?no=20260624173649)
- **[웹]** 2026-06-23 공공 AI 박람회에서 삼성SDS는 FabriX와 Brity Works로 AI 민원서포터, 정부24 AI 검색, 조달법령 해석 사례를 전시했다. 같은 자리에서 엔비디아 B300 기반 GPUaaS도 공개했다. — [ZDNet Korea 2026-06-23](https://zdnet.co.kr/view/?no=20260623173831)
- **[웹]** 한컴·삼성SDS 컨소시엄이 '국회 빅데이터 플랫폼(AI국회) 1단계'(약 116억 원)를 수주했다. 한컴의 RAG 기반 질의응답 솔루션 '한컴피디아'와 FabriX가 함께 들어간다. — [헬로티](https://www.hellot.net/news/article.html?no=97856), [byline](https://byline.network/2025/06/16-509/)
- **[웹]** 2026년 기준 FabriX는 200건 이상의 기업 PoC를 확보했다는 보도가 있다. 단일 보도 요약에 근거하므로 원문 재확인이 필요하다. — [ZDNet Korea 검색결과 요약](https://zdnet.co.kr/view/?no=20260624173649)
- **[웹]** Brity Works(협업)는 "전 세계 50만 삼성인"이 사용하며, Brity Copilot은 오피스 영역에서 정보 검색·요약, 문서 포맷 변환, 초안 생성 기능을 제공한다(벤더 페이지). — [Brity Works](https://www.samsungsds.com/kr/collaboration-solution/brity-works.html), [Brity Copilot](https://www.samsungsds.com/kr/copilot/brity-copilot.html)

### Inferences
- HWP 처리는 FabriX 공식 페이지에서 언급을 찾지 못했다. 국회 사업처럼 HWP 비중이 큰 공공 사업에서 한컴과 컨소시엄을 짠 점으로 보아, HWP 파싱·문서 RAG는 파트너(한컴)에 맡기는 구조로 보인다(추론).
- 정부24 구조(답변 가능성 판단 → RAG → 관련성 재검증)는 query routing과 self-check형 agentic RAG에 해당한다. 다만 정확도 수치는 공개되지 않았다.
- 시장 지위는 "솔루션 벤더"보다 **대형 SI·플랫폼 사업자**로 보는 편이 맞다. 대형 공공·그룹사 사업에서 RAG 전문 벤더(한컴·와이즈넛 등)를 하위 컴포넌트로 품는 구도가 반복된다(추론).

### Gaps
- FabriX의 기본 LLM 구성(Gauss·오픈모델·외부 API 비중), 한국어 형태소/sparse 검색 여부, 리랭커, 청킹 전략, 인용(citation) UI, 정확도 평가 체계는 공식 자료에서 확인하지 못했다. FAQ 답변 본문도 캡처되지 않았다.
- 외부(비삼성) 고객 수와 FabriX 매출 규모는 공개 수치가 없다.

## Part A-2. LG CNS — AgenticWorks / DAP GenAI Platform(Knowledge Lake)

### Takeaway
LG CNS는 2025년 하반기에 기존 **DAP GenAI Platform**(금융·공공 AX로 검증된 플랫폼) 위에 6개 모듈 풀스택 **AgenticWorks**를 출시했다. 그중 지식검색 핵심 모듈은 **AgenticWorks Knowledge Lake / DAP GenAI Knowledge Lake**이며, 공식 페이지에서 "벡터·하이브리드 검색", 거버넌스(보안·권한·표준), 온프레미스 지원을 명시한다. 모델은 EXAONE·Cohere·자체 추론형 LLM을 라우팅으로 고르는 방식이다.

### Cited Findings
- **[rea]** AgenticWorks는 6개 모듈로 구성된다. Refiner("데이터 생성부터 모델 평가까지"), **Knowledge Lake("기업 내부의 비정형 정보를 자산화하여 MCP로 활용가능한 지식 저장소")**, Router("성능과 비용을 고려한 최적의 AI 모델을 자동 선택/전환"), Builder, Hub, Studio(No/Low-Code 오케스트레이션). 공식 설명은 "데이터 커넥터, 지식검색 결합(RAG), 평가/모니터링, 권한 관리와 거버넌스"다. — [LG CNS Agentic AI](https://www.lgcns.com/kr/service/ai/agentic-ai.html)
- **[rea]** 파트너십: Cohere("보안·프라이버시 중심의 다국어 LLM과 RAG를 결합해 산업 특화 Agent"), Weights & Biases("프롬프트, 에이전트 실험/평가/관측 체계"), EXAONE("한국어·멀티모달 초거대 모델 … 온프레미스/하이브리드 배치"). 페이지는 "라우팅으로 기존 대비 10배 이상의 추론 비용이 드는 Agentic Workflow를 합리적인 비용으로" 제공하고, "온프레미스 내 확장을 제한없이 지원"한다고 적고 있다(벤더 주장). — [LG CNS Agentic AI](https://www.lgcns.com/kr/service/ai/agentic-ai.html)
- **[rea]** DAP GenAI Knowledge Lake 설명: "기업 내 분산된 정보를 의미 기반의 지식으로 통합 … 대량의 문서를 최적화된 파이프라인으로 지식화하고, 보안·권한·표준을 아우르는 거버넌스를 적용". 기능 항목은 "쉽고 빠른 지식 데이터 구축", "모니터링 및 거버넌스(활용 현황 모니터링)", "지식 기반 검색 — 벡터, 하이브리드 검색 및 다양한 LLM 모델을 사용한 답변"이다. FAQ에 "정보 왜곡 현상은 어떻게 해결하나요?"가 있다(답변 미캡처). 페이지는 "국내 최다 고객사를 보유"를 내세운다(벤더 주장, 근거 미제시). — [LG CNS AX 플랫폼](https://www.lgcns.com/kr/service/ai/ax-platform.html)
- **[rea]** DAP GenAI Text: AI Prompt(템플릿 공유), AI Service(로우코드), LLMOps(Owned LLM 파인튜닝·원클릭 배포), Enterprise fit Governance. — [LG CNS AX 플랫폼](https://www.lgcns.com/kr/service/ai/ax-platform.html)
- **[웹]** AgenticWorks는 DAP GenAI 플랫폼과 Cohere 기술협력을 기반으로 하며, EXAONE과 LG CNS·Cohere 공동개발 추론형 LLM을 활용한다. 같은 시기 'DevOn AIND' 개발 플랫폼도 출시됐다. — [Daum/현장 기사 2025-08-25](https://v.daum.net/v/20250825131316519), [LG 보도자료](https://www.lg.co.kr/media/release/30232)
- **[웹]** 2025년 3분기 누적 매출은 4조1939억 원, AI·클라우드 매출은 2조4692억 원(+14.7%)이다. AI 수주처는 외교부, 경기도교육청, 경찰청, 기상청, 인천국제공항공사, 한국해양진흥공사다. AgenticWorks는 "금융권 중심으로 다수 기업과 PoC", a:xink는 "LG 계열사와 외부 고객 약 20곳과 도입 논의" 단계였다(2025-10-30 기준). — [헬로티 2025-10-30](https://www.hellot.net/mobile/article.html?no=106679)
- **[웹]** 금융 AX 고객으로 NH농협은행, 미래에셋생명, 신한은행, KB금융그룹이 보도됐다. 공공 AI 플랫폼 수주로는 경기도교육청과 외교부가 있다. — [kharn 2026-06](https://www.kharn.kr/news/article.html?no=28576), [byline 2026-01](https://byline.network/2026/01/27-545/)
- **[웹]** 2026-06-23 공공 AI 박람회에서 LG CNS는 AgenticWorks와 EXAONE으로 AI 콜센터 상담 사례를 전시했다. — [ZDNet Korea 2026-06-23](https://zdnet.co.kr/view/?no=20260623173831)

### Inferences
- 국내 대기업 SI 중 **"하이브리드 검색"과 "지식 거버넌스(권한·표준·활용 모니터링)"를 공식 페이지에 가장 구체적으로 명시한 곳**은 LG CNS다. 실제 sparse 쪽이 한국어 형태소 기반인지는 공개되지 않았다.
- W&B 협업은 평가·관측(AgentOps) 체계를 플랫폼 기본 요소로 넣었다는 뜻이다. 정확도 평가 루프의 존재는 확인되지만 지표나 수치는 공개되지 않았다.

### Gaps
- Knowledge Lake의 문서 파서(HWP·표·OCR) 지원 범위, 청킹 방식, 리랭커, 인용 표시 방식은 확인하지 못했다.
- "국내 최다 고객사" 주장의 근거는 찾지 못했다.

## Part A-3. LG AI연구원 — EXAONE / ChatEXAONE / EXAONE 온프레미스

### Takeaway
LG AI연구원은 모델(EXAONE 4.5, K-EXAONE 2.0)과 사내 에이전트(ChatEXAONE), 튜닝 플랫폼(EXAONE Data Foundry)을 제공한다. 외부 기업용 RAG 납품은 주로 LG CNS(AgenticWorks)를 통해 이루어진다. ChatEXAONE은 LG 계열사 내부용 성격이 강하다.

### Cited Findings
- **[rea]** EXAONE 4.5는 "네이티브 멀티모달" 구조이며 "자체 Vision Encoder", "전문 문서 이해에 기반한 추론 성능 우수", "MTP 적용으로 기존 대비 약 1.5배 빠른 속도", "다국어 지원을 위한 vocabulary 추가"를 내세운다. 페이지는 "복잡한 문서 기반 작업과 한국어 및 한국의 시각적 맥락을 이해하는 데 독보적 강점"을 주장한다(벤더 주장). — [LG AI Research EXAONE](https://www.lgresearch.ai/exaone)
- **[rea]** 솔루션: "ChatEXAONE brings together documents, web, and data into one seamless agent", "EXAONE Data Foundry — 실제 문서에서 도메인 특화 QA 데이터를 생성하고 빠른 피드백 루프로 최적화하는 end-to-end LLM 튜닝 플랫폼". — [LG AI Research EXAONE](https://www.lgresearch.ai/exaone)
- **[웹]** ChatEXAONE은 정보 암호화와 개인정보 보호를 적용한 기업용 에이전트로 웹 검색, 문서 요약, 번역, 보고서, 데이터 분석, 코딩을 지원한다. RAG를 고도화했다고 밝혔으며, LG전자·LG이노텍·LG디스플레이 등 계열사에 적용됐다. '엑사원 온프레미스'는 외부 접속 없이 운영하는 풀스택 솔루션이다. — [딜사이트](https://dealsite.co.kr/articles/145062), [LG AI연구원 뉴스](https://www.lgresearch.ai/news/view?seq=462), [메트로서울 2025-07-22](https://www.metroseoul.co.kr/article/20250722500447)
- **[웹]** 독자 AI 파운데이션 모델 2차 평가(2026-08-18) 결과 업스테이지(Solar Open2), SK텔레콤(A.X K2), LG AI연구원(K-EXAONE 2.0)이 통과했고 모티프는 탈락했다. 평가는 벤치마크 40점, 전문가 35점, 사용자 25점으로 구성됐고, 3차 평가로 내년 초 최종 2개 팀을 뽑는다. — [머니투데이 2026-08-18](https://www.mt.co.kr/article/2026081812375747016), [byline 2026-08](https://byline.network/2026/08/0818-7/)

### Inferences
- EXAONE의 RAG 시장 내 역할은 "한국어 생성 모델 공급자"다. 검색 품질(형태소·sparse·리랭킹)은 상위 플랫폼(LG CNS 등)에서 결정된다.
- Data Foundry의 "문서→QA 데이터 생성→피드백 루프"는 지식 자산화와 평가 데이터 구축 관점에서 눈여겨볼 기능이다.

### Gaps
- ChatEXAONE의 외부 판매 여부·가격·고객 수, EXAONE 온프레미스의 실제 외부 구축 사례는 확인하지 못했다.

## Part A-4. 추가 프로파일 — 한컴(한컴피디아), 카카오 Kanana(참고)

### Takeaway
Part B 상위 후보 가운데 다른 연구자가 다루지 않는 곳으로 **한컴(한컴피디아)**을 골랐다. HWP 원천 포맷 보유사이고, 2025~2026년 대형 공공 AI 사업(국회, 행안부)에 연속으로 참여했다는 점에서 한국어 문서 RAG에서 의미가 크다. 카카오 Kanana는 rea로 확인한 결과 2026-10 현재 소비자(카카오톡)용 서비스와 오픈모델 중심이다. 엔터프라이즈 지식검색 상용 제품으로 보기는 어렵다.

### Cited Findings
- **[웹]** 한컴은 삼성SDS와 컨소시엄으로 '국회 빅데이터 플랫폼(AI국회) 1단계'(약 116억 원)를 수주했다. RAG 기반 질의응답 솔루션 '한컴피디아'로 국회사무처·국회도서관 의정자료 질의응답을 지원한다. 이후 행안부 '지능형 업무관리 플랫폼 구축'에 참여했고, 2025년 중 공공 AI 성과는 이것이 세 번째였다고 보도됐다. 한컴은 2026년을 "전사적 AI 내재화 원년"으로 삼았다. HWP는 AI 학습의 걸림돌로 지적돼 왔으나 포맷 개방으로 해소되고 있다는 보도가 있다. — [헬로티](https://www.hellot.net/news/article.html?no=97856), [byline 2025-02](https://byline.network/2025/02/12-378/), [byline 2025-06](https://byline.network/2025/06/16-509/), [뉴데일리 2025-12-09](https://biz.newdaily.co.kr/site/data/html/2025/12/09/2025120900159.amp.html), [MTN 2026-06-29](https://news.mtn.co.kr/news-detail/2026062913312310679)
- **[웹]** 사이냅소프트는 2026 공공 AI 박람회에서 Synap Assistant, 도큐애널라이저, OCR IX를 전시했고, RAG 기반 업무 지원(Ainex)으로 "환각 현상 감소"를 내세웠다. 문서 파싱 계층 공급사 성격이다. — [ZDNet Korea 2026-06-23](https://zdnet.co.kr/view/?no=20260623173831)
- **[rea]** kanana.ai 메뉴는 About/Service/Model로 구성되며, 항목은 "Kanana in KakaoTalk — 카카오톡에서 만나는 내 일상 속 AI", "Kanana Model — 오픈소스 모델 다운로드", "Kanana Safeguard", 테크블로그다. 기업용 지식검색 제품은 보이지 않는다. — [Kanana](https://kanana.ai/)
- **[웹]** 카카오는 공공 AI 박람회에서 Kanana와 'AI 국민비서'(카카오톡 기반 공공시설 예약, 전자증명서)를 전시했다. — [ZDNet Korea 2026-06-23](https://zdnet.co.kr/view/?no=20260623173831)
- **[웹]** SK AX(구 SK C&C)는 2026년 OpenAI 서비스 파트너 계약(5월)과 SAP 'AI 네이티브 엔터프라이즈' 협력(8월)을 발표했다. 에이전틱 플랫폼명은 'AXgenticWire NPO'로 보도됐다. 자체 한국어 RAG 검색 제품은 확인하지 못했다. 검색 결과에 나온 'Lucia A.RAG'는 솔트룩스 제품이다. — [SK AX 뉴스룸](https://www.skax.co.kr/company/news-room/sk-ax-openai%EC%99%80-%EC%86%90%EC%9E%A1%EA%B3%A0-%EA%B8%B0%EC%97%85%EB%93%A4%EC%9D%98-ai-%EC%A6%9D%EA%B0%95-%EB%8F%95%EB%8A%94%EB%8B%A4), [MTN 2026-08-26](https://news.mtn.co.kr/news-detail/2026082609243730979)

### Inferences
- 한컴피디아의 기술 세부(형태소, 하이브리드, 리랭킹)는 확인하지 못했다. 그래도 HWP/HWPX 원본 구조(표·개체)를 직접 해석할 수 있는 유일한 원천 포맷 보유사라는 점은 구조적 강점이다(추론).
- 대기업 SI(삼성SDS·LG CNS·SK AX)는 플랫폼·오케스트레이션을 맡고, 한국어 검색·문서 파싱은 전문 벤더(한컴, 와이즈넛, 사이냅 등)와 결합하는 분업 구도가 공공 박람회와 수주 사례에서 반복된다(추론).

### Gaps
- 한컴피디아 매출, 고객 수, 기술 구조는 공개 자료가 부족하다. 마음AI·다이퀘스트·비아이매트릭스·디노티시아는 이번 조사에서 프로파일링하지 못했다(시간 제약). 디노티시아는 Forbes 2026 AI 50에 "AI 데이터 인프라"(5위)로 올라 있다. — [Forbes Korea 2026 AI 50](https://www.forbeskorea.co.kr/news/articleView.html?idxno=402573)

## Part B. Top 10 검증 — 공신력 있는 순위 자료 존재 여부와 종합 Top 10

### Takeaway
**"한국어 엔터프라이즈 RAG/AI 지식검색 Top 10"을 직접 매긴 공신력 있는 시장 보고서(IDC Korea, KISDI, NIA, Gartner 등)는 이번 조사에서 찾지 못했다.** 영문 "Top RAG companies 2026" 목록은 모두 해외 개발사 중심의 SEO형 목록이고 한국 벤더는 빠져 있다. 아래 Top 10은 공공 인증(GS 1등급, AI 제품·서비스 확인제), 조달 등록·수주, 공개 매출·수주 규모, 정부 대표 프로젝트 참여, 대형 레퍼런스를 근거로 한 **연구자 판단 순위**다.

### Cited Findings — 순위 자료 탐색 결과
- 영문 "Top 10 RAG Development Companies 2026" 류(RaftLabs, LuMay, Sphere 등) 목록에는 한국 벤더가 없다. 한국 시장 판단에는 쓸 수 없다. — [Sphere 2026](https://www.sphereinc.com/blogs/best-enterprise-rag-platforms-2026), [RaftLabs](https://www.raftlabs.com/blog/top-rag-development-companies)
- Forbes Korea '2026 대한민국 AI 50'(2026-09-29 게재, 10월호)은 스타트업·중견 1,487곳을 특허·투자·인원·2025 매출·R&D와 정성평가로 평가했다. 기업용 AI 지식검색 관련 기업은 **업스테이지(9위), 포티투마루(24위)**, 디노티시아(5위, AI 데이터 인프라)다. 업스테이지 매출은 248억 원(국책과제 22억 원), 포티투마루는 매출 41억 원·국책과제 42억 원·53명이다. 솔트룩스·코난·와이즈넛 같은 상장·중견사는 이 목록에 없는데, 이는 대상 범위 차이 때문으로 보인다. — [Forbes Korea 2026 AI 50](https://www.forbeskorea.co.kr/news/articleView.html?idxno=402573)
- 전통 기업용 검색 시장에서는 와이즈넛과 코난테크놀로지가 1·2위를 다툰다는 보도가 있다. 다만 **오래된 자료(2000년대)**라 현재 점유율 근거로 쓰기는 부족하다. — [inews24(과거 기사)](https://www.inews24.com/view/316355)
- 와이즈넛 'WISE iRAG V2'는 국산 RAG 최초로 GS 1등급을 받았다(2025-05). 조달청 디지털서비스몰에 등록됐고, 경찰청이 디지털서비스몰로 구매했다(2025-12). — [디지털데일리 2025-05](https://m.ddaily.co.kr/page/view/2025050815462876576), [byline 2025-12](https://byline.network/2025/12/3-356/)
- 솔트룩스는 2026년 상반기 누적 수주 188.9억 원(별도), 매출 87억 원이다. LUXIA, A.RAG, 에이전트 스튜디오로 공공·금융·국방·제조에 적용하고 있다. — [drnews](https://drnews.co.kr/article/1023), [네이트(2026-08-14)](https://m.news.nate.com/view/20260814n19409)
- 코난테크놀로지는 '코난 RAG'를 탑재한 AI PC(TG삼보 협력, 코난 AI 스테이션)로 B2G 조달 시장을 겨냥했다(2025). — [AI타임스](https://www.aitimes.com/news/articleView.html?idxno=170410), [디지털데일리 2025-05](https://m.ddaily.co.kr/page/view/2025051421551531132)
- 포티투마루의 LLM42 v1.1과 RAG42 v1.3이 정부 'AI 제품·서비스 확인제'를 동시 인증받았다. 2026년 예금보험공사 AX와 식약처 AI 안전지킴이 사업을 수행한다. — [벤처스퀘어](https://www.venturesquare.net/1114112), [헬로티](https://www.hellot.net/news/article.html?no=115303)
- 올거나이즈는 업스테이지 컨소시엄 일원으로 독자 AI 파운데이션 모델(독파모) 1차를 통과했고(2026-01), 에이전트 RAG와 파인튜닝 역할을 맡는다. — [머니투데이 2026-01-19](https://www.mt.co.kr/future/2026/01/19/2026011909333594115)
- 독파모 2차(2026-08-18) 통과 팀은 업스테이지, SKT, LG AI연구원이다. — [머니투데이](https://www.mt.co.kr/article/2026081812375747016)
- 2026 공공 AI 박람회(2026-06-23, 56개 기관·기업)의 주요 전시 기업은 삼성SDS, LG CNS, NHN두레이, 카카오, 사이냅소프트 등이다. — [ZDNet Korea](https://zdnet.co.kr/view/?no=20260623173831)

### 종합 Top 10 (연구자 판단 — 순위 자체는 sourced 아님. 각 근거는 위 인용 또는 다른 연구자 노트 참조)

| 순위 | 벤더 / 제품 | 포함 근거 | 근거 성격 |
|---|---|---|---|
| 1 | 삼성SDS — FabriX / Brity Copilot | 삼성 24개 관계사 전체 도입, Brity Copilot 18만+ 사용자, 범정부 초거대 AI 공통기반·행안부·정부24·법제처·국회 사업 | sourced 사실 + 판단 |
| 2 | LG CNS — AgenticWorks / DAP GenAI Knowledge Lake (+EXAONE) | 금융(NH·신한·KB·미래에셋생명)·공공(외교부·경기도교육청·경찰청·기상청 등) 수주, 하이브리드 검색·거버넌스 명시 | sourced 사실 + 판단 |
| 3 | 와이즈넛 — WISE iRAG | 국산 RAG 최초 GS 1등급, 조달 디지털서비스몰 등록, 경찰청 구매, 전통 검색 1·2위권 | sourced(점유율은 오래된 자료) |
| 4 | 솔트룩스 — LUXIA / A.RAG | 2026 상반기 수주 189억 원, 공공·금융·국방 | sourced |
| 5 | 코난테크놀로지 — 코난 RAG / Konan LLM | 전통 검색 1·2위권, B2G AI PC 조달 | sourced(점유율 오래됨) + 판단 |
| 6 | 업스테이지 — Solar / Document AI | 매출 248억 원(Forbes AI 50 9위), 독파모 2차 통과, 금융·보험 문서 AI | sourced |
| 7 | 네이버클라우드 — HyperCLOVA X 기반 RAG | 다른 연구자 담당. 하이퍼스케일러 + 공공 클라우드 기반 포함 | 판단(이 노트에서 근거 미수집) |
| 8 | 올거나이즈 — Alli (Agentic RAG) | 독파모 업스테이지 컨소시엄 참여, 금융권 레퍼런스(다른 연구자 담당) | 일부 sourced + 판단 |
| 9 | 포티투마루 — RAG42 / LLM42 | AI 제품·서비스 확인제 인증, 예보·식약처 사업, Forbes AI 50 24위 | sourced |
| 10 | 한컴 — 한컴피디아 (대안: 스켈터랩스 BELLA, SK AX) | HWP 원천 보유, 국회 AI 116억 원 사업, 행안부 사업 참여 | sourced + 판단 |

- 탈락·보류 사유: **카카오 Kanana**는 rea 확인 결과 소비자·오픈모델 중심이다. **SK AX**는 자체 한국어 RAG 검색 제품을 확인하지 못했다(OpenAI·SAP 파트너 중심). **스켈터랩스**는 다른 연구자 담당이며, 이 노트에는 비교 근거가 없어 10위 대안으로만 둔다. 마음AI, 다이퀘스트, 비아이매트릭스, 사이냅소프트는 데이터 부족으로 보류했다(사이냅은 문서 파싱 계층 공급사로 별도 평가 권장).

### Inferences
- 시장은 두 층으로 나뉜다. (a) 대기업 SI·플랫폼층(삼성SDS, LG CNS, 네이버클라우드)은 대형 공공·그룹사 사업을 따내고 오케스트레이션과 거버넌스를 맡는다. (b) 전문 벤더층(와이즈넛, 코난, 솔트룩스, 올거나이즈, 포티투마루, 한컴)은 한국어 검색·RAG 엔진과 문서 처리를 맡는다. "Top 10"은 성격이 다른 두 층을 섞은 목록이라는 점을 보고서에 밝혀야 한다.
- 공공 조달 기준으로는 GS 1등급, AI 제품·서비스 확인제, 디지털서비스몰 등록이 사실상 진입 요건이 되고 있다. 이 요건이 순위를 매길 때 가장 검증 가능한 기준이다.

### Gaps
- IDC Korea, KISDI, NIA, 과기정통부 AI 바우처 공급기업 통계, 조달청 혁신제품 목록, Gartner·Forrester의 한국 벤더 언급 가운데 **RAG/AI 검색 벤더 순위나 점유율 자료는 찾지 못했다.** 조달청 디지털서비스몰의 RAG 등록 기업 전체 목록도 확보하지 못했다(직접 조회 필요).
- 벤더별 2025~2026 RAG 단독 매출, 독립 정확도 벤치마크(예: 한국어 RAG 리더보드)에서의 상용 제품 비교 자료는 확인하지 못했다.
- 이번 조사는 도구 호출 예산 때문에 2차 검증(원문 재확인)이 제한적이었다. 특히 "FabriX 200+ PoC", 딜사이트 기사 날짜는 원문 재확인이 필요하다.
