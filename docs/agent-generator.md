# 📋 Project Requirements: Ultra-Lightweight Monitoring Agent

## 1. 개요 (Overview)

본 프로젝트는 리눅스와 윈도우 환경에서 시스템 자원 및 로그를 실시간으로 수집하여 프로메테우스(Prometheus)로 전송하고, LLM 기반의 지능형 분석을 위한 전처리를 수행하는 초경량 모니터링 에이전트를 개발하는 것을 목표로 한다.

## 2. 핵심 목표 (Core Objectives)

- **Zero-Impact Monitoring:** 대상 시스템의 CPU 사용률을 1% 미만으로 유지하며 실 서비스 성능에 영향을 주지 않음.
    
- **Cross-Platform Consistency:** 단일 코드베이스(Rust 권장)를 통해 리눅스와 윈도우에서 동일한 메트릭 수집 논리 구현.
    
- **Intelligent Analysis Ready:** 단순 수집을 넘어 로그 템플릿 추출 및 메트릭 요약을 통해 LLM 분석 효율 극대화.
    

## 3. 기능 요구사항 (Functional Requirements)

### 3.1 시스템 메트릭 수집 (Metric Collection)

- **기본 자원:** CPU(코어별 사용률), Memory(사용량, 캐시, 스왑), Disk(I/O 지연시간, 처리량, 용량), Network(인/아웃바운드 트래픽, 에러 패킷).
    
- **프로세스 감시:** 프로세스별 CPU/메모리 점유율, 상태 변화 추적.
    
- **수집 방식:**
    
    - **Linux:** `procfs` 파싱 및 고성능 요구 시 eBPF 활용.
        
    - **Windows:** PDH(Performance Data Helper) 및 ETW(Event Tracing for Windows) API 활용.
        

### 3.2 로그 에러 탐지 및 전처리 (Log Monitoring)

- **실시간 스캐닝:** 시스템 로그 및 지정된 앱 로그에서 "Error", "Critical", "Panic" 등의 키워드 실시간 탐지.
    
- **DFA 기반 매칭:** 정규 표현식 매칭 시 백트래킹 없는 DFA(Deterministic Finite Automata) 엔진을 사용하여 CPU 부하 방지.
    
- **LLM 전처리:** 로그 원문 전송 대신 템플릿 추출(Template Extraction)을 통해 변수(IP, ID 등)를 마스킹하고 패턴화하여 전송.
    

### 3.3 데이터 전송 (Data Transmission)

- **프로토콜:** Prometheus Remote Write (Push 방식) 지원.
    
- **최적화:** Snappy 압축 및 HTTP POST 배치 전송을 통해 네트워크 대역폭 최소화.
    
- **안전성:** 네트워크 단절 시 내부 WAL(Write-Ahead Log)을 통한 데이터 로컬 버퍼링(최대 2시간).
    

## 4. 기술 제약 사항 (Technical Constraints)

### 4.1 개발 언어 및 환경

- **언어:** **Rust** (Garbage Collection으로 인한 런타임 오버헤드 방지 및 메모리 안전성 확보).
    
- **실행 형태:**
    
    - **Linux:** Native Binary, `systemd` 서비스 등록.
        
    - **Windows:** Native `.exe`, Windows Service Manager(SCM) 등록.
        

### 4.2 성능 지표 (Performance SLI)

- **CPU 사용량:** 전체 시스템 코어의 1% 미만 유지.
    
- **메모리 점유:** 50MB RSS(Resident Set Size) 이내 유지.
    
- **총 오버헤드 공식:**
    
    $$\text{Total Overhead} = \sum (\text{Collection Cost} + \text{Parsing Cost} + \text{Transmission Cost}) < 0.05 \times \text{System Capacity}$$
    

## 5. LLM 추이 분석 연동 (LLM Integration)

- **시계열 요약:** LLM이 문맥을 파악할 수 있도록 1분/5분 단위의 메트릭 통계 요약(평균, 95th Percentile) 데이터 생성.
    
- **인과관계 태깅:** 이상 징후 발생 시점의 메트릭과 로그 템플릿을 연관 지어(Correlation) 전송하여 LLM의 Root Cause Analysis(RCA) 지원.
    

## 6. 수락 기준 (Acceptance Criteria)

1. 리눅스(Ubuntu/RHEL) 및 윈도우(Server 2019+) 환경에서 에이전트가 서비스로 정상 실행되어야 함.
    
2. 수집된 데이터가 프로메테우스 서버에 15초 주기로 누락 없이 기록되어야 함.
    
3. 로그에 인위적인 에러 발생 시 1초 이내에 감지되어 전송되어야 함.
    
4. 에이전트 실행 전후의 실 서비스 성능 저하가 측정 오차 범위 내여야 함.
