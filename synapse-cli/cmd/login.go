package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/term"

	"synapse-cli/auth"
)

func RunLogin() {
	reader := bufio.NewReader(os.Stdin)
	fmt.Println("Synapse CLI 초기 설정\n")

	baseURL := prompt(reader, "서버 주소 (예: http://server-a:8080): ")
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		fmt.Fprintln(os.Stderr, "서버 주소를 입력해주세요.")
		os.Exit(1)
	}

	email := prompt(reader, "이메일: ")

	fmt.Print("비밀번호: ")
	pwBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "비밀번호 입력 오류: %v\n", err)
		os.Exit(1)
	}
	password := string(pwBytes)

	systemName := prompt(reader, "기본 시스템 이름 (예: cms, oms): ")
	if systemName == "" {
		fmt.Fprintln(os.Stderr, "시스템 이름을 입력해주세요.")
		os.Exit(1)
	}

	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	req, err := http.NewRequest("POST", baseURL+"/api/v1/auth/login", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "요청 생성 오류: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Client", "cli")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "서버에 연결할 수 없습니다: %s\n", baseURL)
		os.Exit(1)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 401:
		fmt.Fprintln(os.Stderr, "이메일 또는 비밀번호가 올바르지 않습니다.")
		os.Exit(1)
	case 403:
		var d map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&d)
		fmt.Fprintf(os.Stderr, "접근 거부: %v\n", d["detail"])
		os.Exit(1)
	case 200:
		// 정상
	default:
		fmt.Fprintf(os.Stderr, "로그인 실패 (HTTP %d)\n", resp.StatusCode)
		os.Exit(1)
	}

	var data struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		User         struct {
			Name string `json:"name"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		fmt.Fprintf(os.Stderr, "응답 파싱 오류: %v\n", err)
		os.Exit(1)
	}

	cfg := &auth.Config{
		BaseURL:      baseURL,
		AccessToken:  data.AccessToken,
		RefreshToken: data.RefreshToken,
		ExpiresAt:    time.Now().Unix() + 14*60,
		SystemName:   systemName,
	}
	if err := auth.SaveConfig(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "설정 저장 오류: %v\n", err)
		fmt.Fprintln(os.Stderr, "힌트: 홈 디렉터리 권한 문제라면 SYNAPSE_CONFIG=/tmp/.synapse/config.json synapse login 으로 경로를 지정하세요.")
		os.Exit(1)
	}

	name := data.User.Name
	if name == "" {
		name = email
	}
	fmt.Printf("\n로그인 성공! 안녕하세요, %s님.\n", name)
	fmt.Printf("기본 시스템: %s\n", systemName)
	fmt.Println("\n사용 예시:")
	fmt.Println(`  synapse ask "현재 알림 상황 요약해줘"`)
	fmt.Println(`  tail -100 /var/log/app.log | synapse ask "에러 분석해줘"`)
	fmt.Println("  synapse chat")
}

func prompt(r *bufio.Reader, label string) string {
	fmt.Print(label)
	line, _ := r.ReadString('\n')
	return strings.TrimSpace(line)
}
