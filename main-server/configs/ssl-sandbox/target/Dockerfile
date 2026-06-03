# SSL 배포 타겟 샌드박스 — sshd + nginx + openssl (RHEL 계열, 운영 RHEL 8.9 근사)
# admin-api(paramiko)가 SSH 접속하여 인증서를 SFTP 업로드하고 nginx reload 한다.
# 테스트 전용: root 비밀번호 로그인 허용. 운영 사용 금지.
FROM rockylinux:9

RUN dnf -y install openssh-server nginx openssl procps-ng \
    && dnf clean all

# root 비밀번호 로그인 허용 (샌드박스 한정)
RUN echo 'root:sandbox-root-pw' | chpasswd \
    && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config

# ssl_deployer는 `systemctl reload nginx`를 호출한다.
# 컨테이너엔 systemd가 없으므로 nginx 시그널로 변환하는 shim 제공.
COPY systemctl-shim.sh /usr/local/bin/systemctl
COPY nginx-ssl.conf /etc/nginx/conf.d/ssl.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/systemctl /usr/local/bin/entrypoint.sh \
    && mkdir -p /etc/nginx/ssl

EXPOSE 22 443
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
