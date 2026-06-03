# SSL 인증서 자동화 관리 — 설계 및 운영 가이드

> 최초 작성: 2026-05-27 | 직접 서명 전환(ADR-019) 반영: 2026-05-31 | 대상 환경: 폐쇄망 RedHat 8.9 + Docker Compose

---

## 1. 개요

Synapse-V 모니터링 시스템에 통합된 SSL 인증서 자동 갱신·배포 기능.
별도 서비스 없이 admin-api 메뉴 추가 형태로 구현되며, 내부망/DMZ 서버 모두 중앙에서 관리한다.

### 핵심 특징

- **내부망 서버**: 사설 CA(intermediate) 키로 leaf 인증서를 **직접 서명**(`cryptography`)하여 와일드카드(`*.shinsegae.com`) 발급/갱신. ACME 챌린지·acme.sh·Step-CA 데몬·8080 포트 의존 없음 (ADR-019).
- **DMZ 서버**: Let's Encrypt HTTP-01로 개별 도메인 독립 갱신 (콜백 없음, 포털이 폴링). DMZ는 acme.sh 번들 유지.
- **배포 엔진**: paramiko SSH/SFTP (추가 의존성 없음, 이미 설치됨)
- **자동 갱신**: 매일 02:00 KST Python 배치 — 만료 30일 전 자동 갱신 및 배포

> **왜 직접 서명인가 (ADR-019 요약)**: 이 시스템은 *중앙(admin-api) 발급 → paramiko push 배포* 모델이라 각 타겟 서버의 80/443 챌린지 검증이 불필요하다. 사설 CA는 우리가 통제하므로 ACME 없이 intermediate 키로 직접 서명할 수 있고, 이로써 ① acme.sh 챌린지 서버(8080)와 admin-api(uvicorn 8080) 포트 충돌, ② 와일드카드의 http-01 불가(DNS-01 필요) 모순, ③ acme.sh/socat/step-ca 번들 의존을 모두 제거했다. 서명 구현은 admin-api가 이미 OIDC RS256용으로 사용하는 `cryptography` 라이브러리로 통일 — 외부 바이너리 0개.

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  admin-api 서버                                              │
│                                                             │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │  React UI   │ ↔  │  admin-api :8080  │                   │
│  │  SSL 메뉴   │    │  ssl_* routes     │                   │
│  └─────────────┘    └────────┬─────────┘                   │
│                              │                             │
│              ┌───────────────┼──────────────┐              │
│              ↓               ↓              ↓              │
│       ssl_issuer.sign_leaf  ssl_deployer  ssl_scheduler    │
│       (cryptography 직접서명) (paramiko)   (매일 02:00)      │
│       와일드카드 SAN 발급                  (갱신+배포+알림)   │
│                                                             │
│  secrets/                                                   │
│    ssl/       ← intermediate_ca.{crt,key}(무암호 PEM),      │
│               root_ca.{crt,key}, deploy_key(.pub)          │
│    certs/     ← 발급된 인증서 (wildcard/, {domain}/)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ paramiko SSH/SFTP
          ┌────────────────┼────────────────────┐
          ↓                ↓                    ↓
     cxm-web1         scrm-web1           vms-web1
     (webtob)         (nginx)             (apache)
     *.shinsegae.com  *.shinsegae.com     crm.shinsegae.com
                                          (개별 도메인)

[ DMZ 구간 ] ← 내부→DMZ HTTP 가능 / DMZ→내부 차단
┌──────────────────────────────────────┐
│  dmz-web1.shinsegae.com              │
│  acme.sh cron → Let's Encrypt HTTP-01│
│  → nginx reload                      │
│  포털: 내부에서 443 openssl 폴링      │
└──────────────────────────────────────┘
```

> 내부망 경로에는 더 이상 Step-CA 데몬(:8443)도, admin-api 컨테이너 내 acme.sh subprocess도 없다. CA는 설치 시 1회 생성된 정적 키 파일이고, 발급은 그 키로 in-process 서명한다.

---

## 3. 인증서 유형

| 구분 | cert_type | 도메인 | CA / 발급 방식 | 대상 |
|------|-----------|--------|-----|------|
| 와일드카드 | `wildcard` | `*.shinsegae.com` (+ apex `shinsegae.com`) | 사설 CA intermediate 직접 서명 | 내부망 서버 기본 |
| 개별 도메인 | `individual` | `crm.shinsegae.com` 등 | 사설 CA intermediate 직접 서명 | 특정 시스템 전용 |
| DMZ | `lets_encrypt_http01` | 개별 도메인 | Let's Encrypt HTTP-01 (DMZ 자체 acme.sh) | DMZ 서버 전용 |

- 와일드카드 leaf의 SAN에는 `*.shinsegae.com` 와 apex `shinsegae.com` 이 함께 포함된다 (`ssl_issuer._sans_for`).
- 개별 도메인은 apex 미포함 — 해당 도메인만 SAN에 들어간다.
- leaf 유효기간은 825일(`_LEAF_VALID_DAYS`, 브라우저 상한 근사).
- Let's Encrypt HTTP-01은 와일드카드 발급 불가 (DNS-01 필요). DMZ 서버는 개별 도메인만 사용.

---

## 4. 배치 갱신 흐름

**원칙: 발급은 도메인 기준, paramiko 배포는 서버 기준**

```
[매일 02:00 KST]  (ssl_scheduler)
  Step 1. 전체 서버 openssl 폴링 → cert_snapshots 갱신 (내부 + DMZ 동일)

  Step 2. 유니크 도메인 추출 (days_left < 30, 중복 제거)
          예) {"*.shinsegae.com", "crm.shinsegae.com"}

  Step 3. 도메인별 직접 서명 1회 (ssl_issuer.issue_or_renew)
          *.shinsegae.com   → sign_leaf → secrets/certs/wildcard/ 갱신
          crm.shinsegae.com → sign_leaf → secrets/certs/crm.shinsegae.com/ 갱신

  Step 4. 도메인을 사용하는 전체 서버에 paramiko 배포
          wildcard 사용 N대 → 각각 SFTP + reload
          crm.shinsegae.com 사용 M대 → 각각 SFTP + reload

  Step 5. 이상 감지 + Teams 알림
```

**서버 수가 늘어도 서명 횟수는 유니크 도메인 수와 동일.**

> `issue_or_renew()`의 시그니처/반환(`{domain, install_dir, rc, output}`)과 결과물 경로(`{CERT_BASE}/wildcard/{fullchain.cer,cert.key,ca.cer}`)는 acme.sh 시절과 동일하게 유지된다. 따라서 `ssl_scheduler`·`ssl_deployer`·`ssl_monitor`는 변경 없이 그대로 동작한다.

---

## 5. 디렉터리 구조

```
main-server/
  secrets/                          ← .gitignore 전체 추가 (절대 커밋 금지)
    ssl/
      root_ca.crt                   ← 클라이언트 신뢰 앵커 (배포용)
      root_ca_key                   ← ⚠️ 최중요. 분실 시 PKI 전체 재구축
      intermediate_ca.crt           ← leaf 서명 체인에 포함됨
      intermediate_ca_key           ← ⚠️ ssl_issuer가 로드하는 서명 키 (무암호 PEM)
      deploy_key                    ← admin-api SSH 배포 private key (RSA 4096)
      deploy_key.pub                ← 타겟 서버 authorized_keys에 등록되는 키
    certs/
      wildcard/                     ← *.shinsegae.com
        fullchain.cer               ← leaf + intermediate 체인 (배포에 사용)
        cert.key                    ← leaf 개인키 (무암호 PEM)
        ca.cer                      ← intermediate CA 인증서
      crm.shinsegae.com/            ← 개별 도메인 발급 시
        fullchain.cer
        cert.key
        ca.cer
  docker-compose.yml
```

> ⚠️ intermediate 키는 **무암호 PEM**이다. `cryptography`의 in-process 서명이 비밀번호 없이 키를 로드해야 하기 때문이며, 그래서 CA 생성도 `scripts/ssl_ca_gen.py`(cryptography)로 통일했다 — smallstep/step-ca 이미지는 intermediate 키를 비밀번호로 암호화 저장해 무암호 로드와 비호환. secrets/ 디렉터리 자체를 OS 권한으로 강하게 보호할 것.

---

## 6. docker-compose.yml 설정 (운영)

```yaml
admin-api:
  volumes:
    - ./secrets/ssl:/app/secrets/ssl        # CA 키/인증서 + deploy key
    - ./secrets/certs:/app/ssl/certs        # 최종 인증서
  environment:
    STEP_CA_INTERMEDIATE_CERT: /app/secrets/ssl/intermediate_ca.crt
    STEP_CA_INTERMEDIATE_KEY:  /app/secrets/ssl/intermediate_ca_key
    STEP_CA_CERT_DIR:          /app/ssl/certs      # 발급 결과 저장 루트 (CERT_BASE)
    STEP_CA_ROOT_CA:           /app/secrets/ssl/root_ca.crt   # Root CA 다운로드 엔드포인트용
    SSL_DEPLOY_KEY_PATH:       /app/secrets/ssl/deploy_key
    SSL_DEPLOY_PUBKEY_PATH:    /app/secrets/ssl/deploy_key.pub
```

> 직접 서명 전환으로 `STEPPATH` / `STEP_CA_ACME_URL` / `ACMESH_PATH` 및 `secrets/step`·`secrets/.acme.sh` 바인드 마운트는 **내부망 경로에서 불필요**하다. (env 이름의 `STEP_CA_` 접두사는 기존 코드 호환을 위해 유지되나 의미는 "사설 CA 경로"다.)
> DMZ 번들(`ssl_dmz.py`)은 타겟 DMZ 서버에서 자체 acme.sh를 실행하므로 admin-api 컨테이너에 acme.sh가 없어도 된다.

---

## 7. 초기 설치 가이드 (폐쇄망)

직접 서명 전환 이후 초기 설치는 **CA 키 파일 생성 + deploy 키 + 최초 와일드카드 발급** 3단계로 단순화되었다. Step-CA RPM 설치·systemd 서비스·acme.sh 설치가 모두 사라졌다.

### 7-1. 사설 CA 생성 (1회, cryptography)

```bash
# root + intermediate CA (무암호 PEM) 생성
./venv/bin/python scripts/ssl_ca_gen.py main-server/secrets/ssl
# 결과: main-server/secrets/ssl/{root_ca.crt, root_ca_key, intermediate_ca.crt, intermediate_ca_key}
```

- root CA: self-signed, 4096-bit, 10년(`_ROOT_DAYS=3650`), `BasicConstraints(ca=True, path_length=1)`
- intermediate CA: root 서명, 4096-bit, 5년(`_INT_DAYS=1825`), `path_length=0`
- 두 키 모두 무암호 PEM (`NoEncryption`).

### 7-2. deploy 키쌍 생성 (1회)

```bash
ssh-keygen -t rsa -b 4096 -N "" -C "synapse-ssl-deploy" \
  -f main-server/secrets/ssl/deploy_key
```

### 7-3. 와일드카드 인증서 최초 발급

CA가 준비되면 admin-api가 첫 배치/수동 배포 시 자동 발급하지만, 사전 발급도 가능하다 (단일 헬퍼 `sign_leaf` 재사용):

```bash
cd main-server/services/admin-api
STEP_CA_INTERMEDIATE_CERT=../../secrets/ssl/intermediate_ca.crt \
STEP_CA_INTERMEDIATE_KEY=../../secrets/ssl/intermediate_ca_key \
STEP_CA_CERT_DIR=../../secrets/certs \
  ../../../venv/bin/python -c \
  "from services.ssl_issuer import sign_leaf; sign_leaf('*.shinsegae.com', '../../secrets/certs/wildcard')"
```

### 7-4. CA 키 백업 (설치 직후 필수)

```bash
BACKUP_DIR="/backup/synapse-ca/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp main-server/secrets/ssl/root_ca_key          "$BACKUP_DIR/"
cp main-server/secrets/ssl/intermediate_ca_key  "$BACKUP_DIR/"
cp main-server/secrets/ssl/root_ca.crt          "$BACKUP_DIR/"
cp main-server/secrets/ssl/intermediate_ca.crt  "$BACKUP_DIR/"

# 암호화 압축 (오프라인 매체에 분리 보관)
tar czf - "$BACKUP_DIR" | openssl enc -aes-256-cbc -pbkdf2 \
  -out /backup/synapse-ca-$(date +%Y%m%d).enc
# ⚠️ root_ca_key 는 반드시 오프라인 매체에 분리 보관
```

---

## 8. 서버 등록 가이드

### 8-1. 내부망 서버 등록 흐름

```
Synapse-V UI → 관리 → SSL 인증서 → 서버 등록

입력 항목:
  시스템코드     CXM
  시스템명       CXM 웹서버
  호스트         cxm-web1.shinsegae.com
  SSH 계정       cxmadm           ← 기존 서비스 계정 그대로
  SSH 비밀번호   ****             ← 1회만 사용, DB 저장 안 함
  웹 유형        webtob           ← webtob | nginx | apache
  인증서 디렉터리 /opt/webtob/cxm/conf
  설정 파일      /opt/webtob/cxm/config/http.m   ← webtob만
  Webtob 홈      /opt/webtob/cxm                 ← webtob만
  인증서 타입    wildcard         ← wildcard | individual
  네트워크 존    internal

→ 포털이 password로 SSH 접속 → deploy_key.pub을 authorized_keys에 자동 등록
→ password 즉시 폐기
→ 키 기반 재접속 테스트 통과 → 등록 완료
```

### 8-2. 개별 도메인 서버 등록

`인증서 타입 = individual` 선택 시 도메인 입력 필드 추가 노출.

```
인증서 타입    individual
도메인         crm.shinsegae.com
```

intermediate CA가 `crm.shinsegae.com` 전용 leaf를 직접 서명하고 `secrets/certs/crm.shinsegae.com/`에 저장.

### 8-3. DMZ 서버 등록

```
네트워크 존    dmz
웹 유형        lets_encrypt_http01
도메인         dmz-web1.shinsegae.com
```

등록 후 **DMZ 설치 번들 다운로드** 버튼으로 zip 파일 생성. 관리자가 수동으로 DMZ 서버에 반입하여 설치.

---

## 9. DMZ 서버 설치 번들 (변경 없음 — acme.sh HTTP-01 유지)

### 번들 구성

```
sap-dmz-bundle-{server_id}.zip
├── acme.sh-3.1.1/       ← 오프라인 설치 파일
├── install.sh           ← 1회 실행 설치 스크립트
└── reload.sh            ← 갱신 후 nginx reload
```

### install.sh 실행 내용 (1회)

```bash
DOMAIN="dmz-web1.shinsegae.com"   # 서버별로 치환됨

# 1. acme.sh 설치
cd acme.sh-3.1.1
./acme.sh --install --nocron --home /root/.acme.sh

# 2. 인증서 최초 발급 (Let's Encrypt HTTP-01, 포트 80 오픈 필요)
/root/.acme.sh/acme.sh --issue \
  -d $DOMAIN --webroot /var/www/html --server letsencrypt

# 3. 인증서 배포 훅 설정
/root/.acme.sh/acme.sh --install-cert -d $DOMAIN \
  --fullchain-file /etc/nginx/ssl/fullchain.cer \
  --key-file       /etc/nginx/ssl/cert.key \
  --reloadcmd      "/usr/local/bin/reload.sh"

# 4. 자동 갱신 cron 등록
(crontab -l 2>/dev/null; echo "0 2 * * * /root/.acme.sh/acme.sh --cron --home /root/.acme.sh") | crontab -
```

이후 갱신은 DMZ 서버 자체 cron이 처리. 포털은 내부→DMZ 443포트 폴링으로만 현황 확인.

> DMZ만 acme.sh를 사용하는 이유: DMZ는 외부에서 신뢰하는 공인 인증서(Let's Encrypt)가 필요하고, DMZ→내부 통신이 차단되어 중앙 직접 서명 결과를 push 받을 수 없기 때문이다. 내부망은 사설 CA로 충분하다.

---

## 10. Root CA 배포 가이드

사설 CA 인증서 운영 시스템 접속 시 브라우저 경고 해소 방법.

**다운로드 URL (인증 불필요):**
```
GET https://synapse.internal:8080/api/v1/ssl/root-ca/download
→ shinsegae-root-ca.crt 다운로드   (파일 경로: STEP_CA_ROOT_CA env)
GET https://synapse.internal:8080/api/v1/ssl/root-ca/info
→ CA 이름 / 만료일 / SHA256 지문
```

### OS별 설치 방법

**Windows**
```
1. shinsegae-root-ca.crt 다운로드
2. 파일 더블클릭 → [인증서 설치]
3. [로컬 컴퓨터] → [신뢰할 수 있는 루트 인증 기관] → [다음] → [마침]
4. 브라우저 재시작
```

**macOS**
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain shinsegae-root-ca.crt
# 브라우저 재시작
```

**Linux (Chrome/Chromium)**
```bash
certutil -d sql:$HOME/.pki/nssdb -A \
  -n "Shinsegae Internal CA" -t "CT,," -i shinsegae-root-ca.crt
```

**Linux (Firefox)**
```bash
# Firefox 인증서 관리자 → 인증 기관 → 가져오기 → shinsegae-root-ca.crt
# "웹 사이트 식별을 위해 이 CA를 신뢰합니다" 체크
```

**iOS**
```
1. 기기에서 파일 다운로드 → 설정 → "프로파일이 다운로드됨"
2. 설정 → 일반 → VPN 및 기기 관리 → 인증서 설치
3. 설정 → 일반 → 정보 → 인증서 신뢰 설정 → 루트 인증서 활성화
```

**Android**
```
설정 → 보안 → 암호화 및 사용자 인증 정보
→ CA 인증서 설치 → 파일에서 설치 → shinsegae-root-ca.crt
```

> Synapse-V SSL 인증서 관리 메뉴 → Root CA 가이드 페이지에서 OS 자동 감지 후 해당 탭으로 안내.

---

## 11. 웹서버 유형별 배포 처리

| 유형 | 컴파일 명령 | 리로드 명령 | 비고 |
|------|------------|------------|------|
| webtob | `{webtob_home}/bin/wscfl -i {config_file}` | `{webtob_home}/bin/wsadmin -c reconfig` | 컴파일 필수 |
| nginx | `nginx -t` | `systemctl reload nginx` | 문법 검사 |
| apache | `apachectl configtest` | `systemctl reload httpd` | 문법 검사 |
| lets_encrypt_http01 | 없음 | `systemctl reload nginx` | DMZ 전용 |

---

## 12. 이상 감지 기준

| 조건 | 심각도 | 알림 내용 |
|------|--------|---------|
| 배포 시간 > 평균 × 2 | WARNING | 배포 시간 평균 N배 초과 |
| 배포 시간 > 평균 × 3 | CRITICAL | 서버 이상 의심 |
| SSL 응답 실패 | CRITICAL | 인증서 미적용 |
| reload rc ≠ 0 | CRITICAL | 리로드 오류 |
| wscfl rc ≠ 0 | CRITICAL | wscfl 컴파일 오류 |
| 만료 30일 미만 | WARNING | 갱신 권장 |
| 만료 7일 미만 | CRITICAL | 즉시 갱신 |
| HA 일부 실패 | CRITICAL | 나머지 서버 배포 중단 |

이상 감지 후 기존 TeamsNotifier로 알림 발송. LLM 분석(llm_client.py)으로 요약문 추가 (실패 시 룰 결과만 발송).

> **만료 폴링 주의 (ssl_monitor)**: `openssl s_client`로 443 만료일을 수집할 때 `-brief` 플래그를 **절대 쓰지 말 것**. `-brief`는 PEM 인증서 블록 출력을 억제하므로 뒤의 `openssl x509 -noout -enddate`가 빈 입력을 받아 `days_left`가 조용히 null이 된다(OpenSSL 3.x / LibreSSL 공통, 실측 확인). 현재 코드는 `echo | openssl s_client -connect {host}:443 -servername {host} | openssl x509 -noout -enddate` 형태로 `-servername`(SNI vhost에서 대상 인증서 정확 반환)만 사용한다.

---

## 13. 사설 CA 키 분실 대응

### root_ca_key 분실 시

```
영향: 신규 intermediate 발급 불가. 기존 intermediate/leaf는 만료일까지 유효.
대응:
  1. 백업에서 복구 시도
  2. 백업 없으면 → CA 전체 재구축
     ./venv/bin/python scripts/ssl_ca_gen.py <새 경로>
     → 새 root_ca.crt 클라이언트 전체 재배포
     → 전체 서버 인증서 재발급(직접 서명) 및 배포
소요 시간: 수 시간 ~ 수일 (클라이언트 배포 범위에 따라)
```

### intermediate_ca_key 분실 시 (root_ca_key 보유)

`ssl_ca_gen.py`는 root+intermediate를 한 번에 만든다. intermediate만 재생성하려면 동일 root 키로 새 intermediate를 서명하는 소규모 스크립트가 필요하다. 가장 단순한 운영 대응은 `ssl_ca_gen.py`를 **새 디렉터리**에 재실행해 새 PKI를 만들고 root CA를 재배포하는 것이다(기존 leaf는 만료까지 유효).

> 운영상 root_ca_key만 안전하게 백업돼 있으면, intermediate 손실은 새 PKI 재구축으로 복구 가능하며 서비스 중단 없이 점진 전환할 수 있다.

### 발급 실패 디버깅

직접 서명은 데몬이 없으므로 "CA 서비스 다운" 상태가 존재하지 않는다. 발급이 실패하면 원인은 거의 항상 **키 파일 경로/권한**이다:

```bash
# admin-api 컨테이너에서 키가 보이는지 확인
docker compose exec admin-api ls -l /app/secrets/ssl/intermediate_ca_key
# issue_or_renew 는 실패 시 {rc:1, output:<예외 메시지>} 를 반환하고 경고 로그를 남긴다
docker compose logs admin-api | grep "직접 서명 발급"
```

---

## 14. 수동 갱신 (긴급 시)

```bash
# 관리 UI에서: SSL 인증서 → 서버 목록 → 배포 버튼
# 또는 API 직접 호출 (해당 서버에 대해 발급→배포):
curl -X POST https://synapse.internal:8080/api/v1/ssl/servers/{id}/deploy \
  -H "Authorization: Bearer {token}"

# 인증서만 강제 재발급 (컨테이너 내부, 배포 제외):
docker compose exec admin-api python -c \
  "import asyncio; from services.ssl_issuer import issue_or_renew; \
   print(asyncio.run(issue_or_renew('*.shinsegae.com')))"
```

---

## 15. 정기 점검 체크리스트

| 주기 | 항목 |
|------|------|
| 매일 자동 | cert_snapshots 만료일 업데이트 |
| 매일 자동 | 30일 미만 서버 자동 갱신·배포 |
| 월 1회 수동 | 사설 CA 키 백업 상태 확인 (root_ca_key / intermediate_ca_key) |
| 분기 1회 수동 | 백업 복구 테스트 (별도 환경) |
| 연 1회 수동 | deploy_key 교체 (선택사항) |
| intermediate 만료 1년 전 | intermediate CA 갱신 계획 수립 (`_INT_DAYS=1825`) |

---

## 16. 로컬 Mac 샌드박스 (개발 테스트)

직접 서명은 순수 파이썬이라 OS 차이가 없으므로, 발급→배포→모니터링 전 과정을 Mac 호스트 오염 없이 로컬에서 검증할 수 있다.

```bash
make ssl-sandbox-up      # rockylinux9 타겟 컨테이너 빌드/기동 (sshd 2222, nginx 443)
make ssl-sandbox-init    # 사설 CA + deploy 키 + 와일드카드 인증서 생성 (호스트 secrets/)
# admin-api 를 호스트에서 실행 (make run-api) 후 UI/API로 서버 등록·배포 테스트
make ssl-sandbox-logs    # 타겟 컨테이너 로그
make ssl-sandbox-down    # 컨테이너 중지
make ssl-sandbox-clean   # 컨테이너 + main-server/secrets/ 삭제
```

**구성 (`main-server/docker-compose.ssl-sandbox.yml` + `configs/ssl-sandbox/target/`)**:
- 타겟 컨테이너: `rockylinux:9` + openssh-server + nginx + openssl
- 포트: `127.0.0.1:2222→22` (paramiko SSH/SFTP), `127.0.0.1:443→443` (ssl_monitor 폴링 대상)
- root 비밀번호 로그인 허용(`sandbox-root-pw`) — **테스트 전용, 운영 금지**
- systemd 미존재 → `systemctl-shim.sh`가 `systemctl reload/restart nginx`를 `nginx -s` 시그널로 변환
- entrypoint가 부팅 시 self-signed 인증서를 깔아 nginx가 즉시 443 리슨, 이후 ssl_deployer가 CA 서명 인증서로 덮어쓴다

**서버 등록 파라미터 (UI/API)**: host=`127.0.0.1`, ssh_port=`2222`, account=`root`, password=`sandbox-root-pw`, web_type=`nginx`, cert_dir=`/etc/nginx/ssl`, cert_type=`wildcard`, network_zone=`internal`.

**검증 전략 (ADR-019)**: 1차 로컬 Mac 샌드박스(직접 서명은 OS 무관) → 2차 운영기/스테이징 실환경(테스트 전용 도메인·타겟 한정, 운영 서비스 미접촉).
