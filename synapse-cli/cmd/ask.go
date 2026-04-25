package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"synapse-cli/auth"
)

const askHelp = `synapse ask — 단방향 LLM 질의

사용법:
  synapse ask [옵션] "질문"
  echo "내용" | synapse ask "분석해줘"

옵션:
  --system <name>   시스템 이름 지정 (기본: 로그인 시 설정한 시스템)
  --area <code>     분석 영역 (기본: cli_query)
  --help, -h        이 도움말 출력`

func RunAsk(args []string) {
	if hasFlag(args, "--help", "-h") {
		fmt.Println(askHelp)
		return
	}

	cfg, err := auth.LoadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "로그인이 필요합니다. 'synapse login'을 실행하세요.")
		os.Exit(1)
	}

	token, err := auth.GetValidToken(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	systemName := cfg.SystemName
	area := "cli_query"
	var promptParts []string

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--system":
			if i+1 < len(args) {
				i++
				systemName = args[i]
			}
		case "--area":
			if i+1 < len(args) {
				i++
				area = args[i]
			}
		default:
			promptParts = append(promptParts, args[i])
		}
	}

	if systemName == "" {
		fmt.Fprintln(os.Stderr, "시스템 이름이 필요합니다. --system 옵션을 사용하거나 'synapse login'에서 설정하세요.")
		os.Exit(1)
	}

	stdinText := ""
	fi, _ := os.Stdin.Stat()
	if fi.Mode()&os.ModeCharDevice == 0 {
		data, _ := io.ReadAll(os.Stdin)
		stdinText = strings.TrimSpace(string(data))
	}

	userPrompt := strings.TrimSpace(strings.Join(promptParts, " "))
	if stdinText != "" && userPrompt != "" {
		userPrompt = stdinText + "\n\n" + userPrompt
	} else if stdinText != "" {
		userPrompt = stdinText
	}

	if userPrompt == "" {
		fmt.Fprintln(os.Stderr, "질문을 입력해주세요.")
		os.Exit(1)
	}

	body, _ := json.Marshal(map[string]string{
		"prompt":      userPrompt,
		"system_name": systemName,
		"area_code":   area,
	})

	req, err := http.NewRequest("POST", cfg.BaseURL+"/api/v1/llm/query", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "요청 생성 오류: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "connection refused") || strings.Contains(err.Error(), "no such host") {
			fmt.Fprintf(os.Stderr, "서버에 연결할 수 없습니다: %s\n", cfg.BaseURL)
		} else if strings.Contains(err.Error(), "context deadline exceeded") {
			fmt.Fprintln(os.Stderr, "응답 시간 초과 (60초). 서버 상태를 확인하세요.")
		} else {
			fmt.Fprintf(os.Stderr, "요청 오류: %v\n", err)
		}
		os.Exit(1)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 401:
		fmt.Fprintln(os.Stderr, "인증이 만료되었습니다. 'synapse login'으로 다시 로그인하세요.")
		os.Exit(1)
	case 503:
		var d map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&d)
		fmt.Fprintf(os.Stderr, "LLM 서비스 오류: %v\n", d["detail"])
		os.Exit(1)
	case 200:
		// 정상
	default:
		raw, _ := io.ReadAll(resp.Body)
		fmt.Fprintf(os.Stderr, "오류 (HTTP %d): %s\n", resp.StatusCode, truncate(string(raw), 300))
		os.Exit(1)
	}

	var data struct {
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		fmt.Fprintf(os.Stderr, "응답 파싱 오류: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(data.Answer)
}

func hasFlag(args []string, flags ...string) bool {
	for _, a := range args {
		for _, f := range flags {
			if a == f {
				return true
			}
		}
	}
	return false
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
