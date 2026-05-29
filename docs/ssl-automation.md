# SSL 인증서 자동화 관리 — 설계 및 운영 가이드

> 작성일: 2026-05-27 | 대상 환경: 폐쇄망 RedHat 8.9 + Docker Compose

---

## 1. 개요

Synapse-V 모니터링 시스템에 통합된 SSL 인증서 자동 갱신·배포 기능.
별도 서비스 없이 admin-api 메뉴 추가 형태로 구현되며, 내부망/DMZ 서버 모두 중앙에서 관리한다.

### 핵심 특징

- **내부망 서버**: Step-CA(사설 CA) + acme.sh로 와일드카드(`*.shinsegae.com`) 자동 발급/갱신
- **DMZ 서버**: Let's Encrypt HTTP-01로 개별 도메인 독립 갱신 (콜백 없음, 포털이 폴링)
- **배포 엔진**: paramiko SSH/SFTP (추가 의존성 없음, 이미 설치됨)
- **자동 갱신**: 매일 02:00 KST Python 배치 — 만료 30일 전 자동 갱신 및 배포

---

## 2. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  admin-api 서버 (Step-CA 겸용)                               │
│                                                             │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │  React UI   │ ↔  │  admin-api :8080  │                   │
│  │  SSL 메뉴   │    │  ssl_* routes     │                   │
│  └─────────────┘    └────────┬─────────┘                   │
│                              │                             │
│              ┌───────────────┼──────────────┐              │
│              ↓               ↓              ↓              │
│          Step-CA          acme.sh       ssl_scheduler      │
│          :8443            subprocess    (매일 02:00)        │
│          (systemd)        (인증서 발급)  (갱신+배포+알림)    │
│                                                             │
│  secrets/                                                   │
│    step/      ← Step-CA STEPPATH (CA 키 포함)               │
│    ssl/       ← deploy_key, root_ca.crt                     │
│    certs/     ← 발급된 인증서 (wildcard/, domain/)           │
│    .acme.sh/  ← acme.sh 설치                                │
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

---

## 3. 인증서 유형

| 구분 | cert_type | 도메인 | CA | 대상 |
|------|-----------|--------|-----|------|
| 와일드카드 | `wildcard` | `*.shinsegae.com` | Step-CA | 내부망 서버 기본 |
| 개별 도메인 | `individual` | `crm.shinsegae.com` 등 | Step-CA | 특정 시스템 전용 |
| DMZ | `lets_encrypt_http01` | 개별 도메인 | Let's Encrypt | DMZ 서버 전용 |

> Let's Encrypt HTTP-01은 와일드카드 발급 불가 (DNS-01 필요). DMZ 서버는 개별 도메인만 사용.

---

## 4. 배치 갱신 흐름

**원칙: acme.sh는 도메인 기준, paramiko 배포는 서버 기준**

```
[매일 02:00 KST]
  Step 1. 전체 서버 openssl 폴링 → cert_snapshots 갱신 (내부 + DMZ 동일)

  Step 2. 유니크 도메인 추출 (days_left < 30, 중복 제거)
          예) {"*.shinsegae.com", "crm.shinsegae.com"}

  Step 3. 도메인별 acme.sh 1회 실행
          *.shinsegae.com   → acme.sh 1회 → secrets/certs/wildcard/ 갱신
          crm.shinsegae.com → acme.sh 1회 → secrets/certs/crm.shinsegae.com/ 갱신

  Step 4. 도메인을 사용하는 전체 서버에 paramiko 배포
          wildcard 사용 4대 → 각각 SFTP + reload
          crm.shinsegae.com 사용 2대 → 각각 SFTP + reload

  Step 5. 이상 감지 + Teams 알림
```

**서버 수가 늘어도 acme.sh 실행 횟수는 유니크 도메인 수와 동일.**

---

## 5. 디렉터리 구조

```
main-server/
  secrets/                          ← .gitignore 전체 추가 (절대 커밋 금지)
    step/                           ← Step-CA 데이터 (STEPPATH=/app/step)
      certs/
        root_ca.crt                 ← 클라이언트 Root CA 배포용
        intermediate_ca.crt
      secrets/
        root_ca_key                 ← ⚠️ 최중요 파일 (분실 시 PKI 전체 재구축)
        intermediate_ca_key         ← 분실 시 root_ca_key로 재생성 가능
        password                    ← 키 암호화 비밀번호 (키와 별도 매체에 보관)
      config/
        ca.json
    ssl/
      deploy_key                    ← admin-api SSH 배포 private key (RSA 4096)
      deploy_key.pub                ← 타겟 서버 authorized_keys에 등록되는 키
      root_ca.crt                   ← step/certs/root_ca.crt 복사본 (컨테이너 접근용)
    certs/
      wildcard/                     ← *.shinsegae.com
        fullchain.cer               ← 배포에 사용하는 인증서 체인
        cert.key                    ← 개인키
        ca.cer                      ← Step-CA CA 인증서
      crm.shinsegae.com/            ← 개별 도메인 발급 시
        fullchain.cer
        cert.key
    .acme.sh/                       ← acme.sh 설치 디렉터리
      acme.sh
      account.conf
  docker-compose.yml
```

---

## 6. docker-compose.yml 설정

```yaml
admin-api:
  volumes:
    - ./secrets/step:/app/step              # Step-CA STEPPATH
    - ./secrets/ssl:/app/secrets/ssl        # deploy key + root CA
    - ./secrets/certs:/app/ssl/certs        # 최종 인증서
    - ./secrets/.acme.sh:/app/acme.sh       # acme.sh (바인딩 — 컨테이너 내 설치 불필요)
  environment:
    STEPPATH:               /app/step
    STEP_CA_ACME_URL:       http://172.17.0.1:8443/acme/acme/directory
    STEP_CA_ROOT_CA:        /app/secrets/ssl/root_ca.crt
    STEP_CA_CERT_DIR:       /app/ssl/certs
    ACMESH_PATH:            /app/acme.sh/acme.sh
    SSL_DEPLOY_KEY_PATH:    /app/secrets/ssl/deploy_key
    SSL_DEPLOY_PUBKEY_PATH: /app/secrets/ssl/deploy_key.pub
```

> `172.17.0.1`은 Docker bridge 게이트웨이 (컨테이너 → 호스트 접근). 환경에 따라 `host.docker.internal`로 대체 가능.

---

## 7. 초기 설치 가이드 (폐쇄망 수기 설치)

### 7-1. 파일 다운로드 (외부 PC에서 실행)

```bash
# Step-CA CLI
# https://github.com/smallstep/cli/releases/tag/v0.29.0
wget https://github.com/smallstep/cli/releases/download/v0.29.0/step_linux_0.29.0_amd64.rpm

# Step-CA 서버
# https://github.com/smallstep/certificates/releases/download/v0.29.0
wget https://github.com/smallstep/certificates/releases/download/v0.29.0/step-ca_linux_0.29.0_amd64.rpm

# acme.sh (오프라인 설치용 zip)
# https://github.com/acmesh-official/acme.sh/releases/tag/3.1.1
wget https://github.com/acmesh-official/acme.sh/archive/refs/tags/3.1.1.zip -O acme.sh-3.1.1.zip
```

USB 또는 내부 파일서버로 서버에 전달.

### 7-2. Step-CA 설치 (root 계정)

```bash
# RPM 설치 — 바이너리(/usr/bin/step, /usr/bin/step-ca)만 설치됨
rpm -ivh step_linux_0.29.0_amd64.rpm
rpm -ivh step-ca_linux_0.29.0_amd64.rpm

# 데이터 디렉터리 권한 설정
mkdir -p /app/step
chown synapse:synapse /app/step   # 운영 계정으로 변경
```

### 7-3. CA 초기화 (일반 계정 synapse)

```bash
su - synapse
export STEPPATH=/app/step

step ca init \
  --name        "Shinsegae Internal CA" \
  --dns         "localhost,ca.shinsegae.com" \
  --address     ":8443" \
  --provisioner "acme" \
  --path        /app/step

# root CA를 ssl/ 에 복사
cp /app/step/certs/root_ca.crt main-server/secrets/ssl/root_ca.crt
```

### 7-4. Step-CA systemd 서비스 (root 계정)

> Step-CA가 `:8443`에 상시 대기해야 acme.sh의 ACME 프로토콜 요청(인증서 발급/갱신)을 처리할 수 있다.

```bash
cat > /etc/systemd/system/step-ca.service << 'EOF'
[Unit]
Description=Shinsegae Internal CA
After=network.target

[Service]
User=synapse
Environment=STEPPATH=/app/step
ExecStart=/usr/bin/step-ca /app/step/config/ca.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now step-ca
systemctl status step-ca
```

### 7-5. root CA 키 백업 (설치 직후 필수)

```bash
BACKUP_DIR="/backup/step-ca/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

cp /app/step/secrets/root_ca_key         $BACKUP_DIR/
cp /app/step/secrets/intermediate_ca_key $BACKUP_DIR/
cp /app/step/secrets/password            $BACKUP_DIR/
cp /app/step/certs/root_ca.crt          $BACKUP_DIR/
cp /app/step/config/ca.json             $BACKUP_DIR/

# 암호화 압축 (오프라인 매체에 보관)
tar czf - $BACKUP_DIR | openssl enc -aes-256-cbc -pbkdf2 \
  -out /backup/step-ca-$(date +%Y%m%d).enc

# ⚠️ root_ca_key와 password는 반드시 별도 매체에 분리 보관
```

### 7-6. acme.sh 설치 (일반 계정 synapse)

```bash
su - synapse
unzip acme.sh-3.1.1.zip
cd acme.sh-3.1.1
./acme.sh --install --nocron --home $(pwd)/../main-server/secrets/.acme.sh
```

### 7-7. 와일드카드 인증서 최초 발급

```bash
ACMESH=main-server/secrets/.acme.sh/acme.sh

$ACMESH --issue \
  -d "*.shinsegae.com" \
  --server https://localhost:8443/acme/acme/directory \
  --ca-bundle main-server/secrets/ssl/root_ca.crt \
  --standalone --httpport 8080

mkdir -p main-server/secrets/certs/wildcard
$ACMESH --install-cert -d "*.shinsegae.com" \
  --fullchain-file main-server/secrets/certs/wildcard/fullchain.cer \
  --key-file       main-server/secrets/certs/wildcard/cert.key \
  --ca-file        main-server/secrets/certs/wildcard/ca.cer
```

### 7-8. deploy 키쌍 생성 (1회)

```bash
mkdir -p main-server/secrets/ssl
ssh-keygen -t rsa -b 4096 \
  -f main-server/secrets/ssl/deploy_key \
  -N "" -C "synapse-ssl-deploy"
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

Step-CA가 `crm.shinsegae.com` 전용 인증서를 발급하고 `secrets/certs/crm.shinsegae.com/`에 저장.

### 8-3. DMZ 서버 등록

```
네트워크 존    dmz
웹 유형        lets_encrypt_http01
도메인         dmz-web1.shinsegae.com
```

등록 후 **DMZ 설치 번들 다운로드** 버튼으로 zip 파일 생성. 관리자가 수동으로 DMZ 서버에 반입하여 설치.

---

## 9. DMZ 서버 설치 번들

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

---

## 10. Root CA 배포 가이드

사설 CA 인증서 운영 시스템 접속 시 브라우저 경고 해소 방법.

**다운로드 URL (인증 불필요):**
```
GET https://synapse.internal:8080/api/v1/ssl/root-ca/download
→ shinsegae-root-ca.crt 다운로드
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

---

## 13. Step-CA 키 분실 대응

### root_ca_key 분실 시

```
영향: 신규/갱신 인증서 발급 불가. 기존 인증서는 만료일까지 유효.
대응:
  1. 백업에서 복구 시도
  2. 백업 없으면 → CA 전체 재구축
     step ca init (새 이름/키로)
     → 새 root_ca.crt 클라이언트 전체 재배포
     → 전체 서버 인증서 재발급 및 배포
소요 시간: 수 시간 ~ 수일 (클라이언트 배포 범위에 따라)
```

### intermediate_ca_key 분실 시 (root_ca_key 보유)

```bash
# root_ca_key로 새 intermediate 생성
step certificate create "Shinsegae Intermediate CA" \
  /app/step/certs/intermediate_ca.crt \
  /app/step/secrets/intermediate_ca_key \
  --profile intermediate-ca \
  --ca /app/step/certs/root_ca.crt \
  --ca-key /app/step/secrets/root_ca_key

systemctl restart step-ca
```

기존 발급 인증서는 계속 유효. 다음 갱신부터 새 intermediate로 서명됨.

### Step-CA 서비스 다운 시

```bash
# 상태 확인
systemctl status step-ca
journalctl -u step-ca -n 50

# 재시작
systemctl restart step-ca

# 포트 확인
curl -k https://localhost:8443/health
```

Step-CA가 다운되면 매일 배치의 acme.sh 갱신이 실패한다. 만료일이 충분히 남은 경우 서비스 복구 후 배치 수동 실행.

---

## 14. 수동 갱신 (긴급 시)

```bash
# 관리 UI에서: SSL 인증서 → 서버 목록 → 배포 버튼
# 또는 API 직접 호출:
curl -X POST https://synapse.internal:8080/api/v1/ssl/servers/{id}/deploy \
  -H "Authorization: Bearer {token}"

# 전체 도메인 강제 갱신 (컨테이너 내부에서):
docker compose exec admin-api \
  /app/acme.sh/acme.sh --renew -d "*.shinsegae.com" --force \
  --server http://172.17.0.1:8443/acme/acme/directory \
  --ca-bundle /app/secrets/ssl/root_ca.crt
```

---

## 15. 정기 점검 체크리스트

| 주기 | 항목 |
|------|------|
| 매일 자동 | cert_snapshots 만료일 업데이트 |
| 매일 자동 | 30일 미만 서버 자동 갱신·배포 |
| 월 1회 수동 | Step-CA 키 백업 상태 확인 |
| 분기 1회 수동 | 백업 복구 테스트 (별도 환경) |
| 연 1회 수동 | deploy_key 교체 (선택사항) |
