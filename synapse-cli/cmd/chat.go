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

	"synapse-cli/auth"
)

const (
	colorReset = "\033[0m"
	colorDim   = "\033[2m"
	colorBold  = "\033[1m"
	colorCyan  = "\033[36m"
)

const chatHelp = `synapse chat — 대화형 모드

사용법:
  synapse chat [옵션]

옵션:
  --new              새 대화 세션 시작
  --session <id>     특정 세션 ID로 진입
  --help, -h         이 도움말 출력

기본 동작:
  최근 세션 목록을 보여주고 선택. 엔터 입력 시 새 대화.
  Ctrl+D 또는 exit으로 종료. 세션은 자동 저장됩니다.`

func RunChat(args []string) {
	if hasFlag(args, "--help", "-h") {
		fmt.Println(chatHelp)
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

	forceNew := hasFlag(args, "--new")
	sessionID := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "--session" && i+1 < len(args) {
			i++
			sessionID = args[i]
		}
	}

	baseURL := cfg.BaseURL
	sid := selectSession(baseURL, token, forceNew, sessionID, cfg.LastSessionID)
	if sid == "" {
		fmt.Fprintln(os.Stderr, "세션 생성에 실패했습니다.")
		os.Exit(1)
	}

	fmt.Printf("\n%sSynapse 채팅 모드%s (exit 또는 Ctrl+D로 종료)\n", colorBold, colorReset)
	fmt.Printf("%s세션 ID: %s%s\n\n", colorDim, sid, colorReset)

	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Printf("%s>%s ", colorBold, colorReset)
		line, err := reader.ReadString('\n')
		if err != nil {
			fmt.Println()
			break
		}
		input := strings.TrimSpace(line)
		if input == "" {
			continue
		}
		if input == "exit" || input == "quit" || input == "/exit" || input == "/quit" {
			break
		}
		streamMessage(baseURL, token, sid, input)
	}

	cfg.LastSessionID = sid
	_ = auth.SaveConfig(cfg)
	fmt.Printf("\n%s세션 저장됨. 다음 'synapse chat'에서 이어서 대화할 수 있습니다.%s\n", colorDim, colorReset)
}

func selectSession(baseURL, token string, forceNew bool, sessionID, lastSessionID string) string {
	if sessionID != "" {
		return sessionID
	}
	if forceNew {
		return createSession(baseURL, token)
	}

	sessions := listSessions(baseURL, token, 10)
	if len(sessions) == 0 {
		return createSession(baseURL, token)
	}

	fmt.Printf("\n%s최근 대화 세션을 선택하세요 (엔터: 새 대화):%s\n", colorBold, colorReset)
	for i, s := range sessions {
		updated := ""
		if u, ok := s["updated_at"].(string); ok && len(u) >= 16 {
			updated = strings.Replace(u[:16], "T", " ", 1)
		}
		title := "대화"
		if t, ok := s["title"].(string); ok && t != "" {
			if len(t) > 50 {
				t = t[:50]
			}
			title = t
		}
		marker := ""
		if id, ok := s["id"].(string); ok && id == lastSessionID {
			marker = " ◀ 마지막"
		}
		fmt.Printf("  %d. [%s] %s%s\n", i+1, updated, title, marker)
	}

	fmt.Print("\n번호 입력 (엔터: 새 대화): ")
	reader := bufio.NewReader(os.Stdin)
	choice, _ := reader.ReadString('\n')
	choice = strings.TrimSpace(choice)

	if choice == "" {
		return createSession(baseURL, token)
	}

	var idx int
	if _, err := fmt.Sscanf(choice, "%d", &idx); err == nil {
		if idx >= 1 && idx <= len(sessions) {
			if id, ok := sessions[idx-1]["id"].(string); ok {
				return id
			}
		}
	}
	return createSession(baseURL, token)
}

func listSessions(baseURL, token string, limit int) []map[string]any {
	req, err := http.NewRequest("GET", baseURL+"/api/v1/chat/sessions", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return nil
	}
	defer resp.Body.Close()

	var sessions []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		return nil
	}
	if len(sessions) > limit {
		return sessions[:limit]
	}
	return sessions
}

func createSession(baseURL, token string) string {
	req, err := http.NewRequest("POST", baseURL+"/api/v1/chat/sessions", bytes.NewReader([]byte("{}")))
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 201 {
		return ""
	}
	defer resp.Body.Close()

	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	id, _ := data["id"].(string)
	return id
}

func streamMessage(baseURL, token, sessionID, content string) {
	body, _ := json.Marshal(map[string]any{
		"content":         content,
		"attachment_keys": []string{},
	})

	req, err := http.NewRequest("POST",
		baseURL+"/api/v1/chat/sessions/"+sessionID+"/messages",
		bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n%s서버 요청 오류%s\n", colorDim, colorReset)
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n%s서버 연결 오류%s\n", colorDim, colorReset)
		return
	}
	defer resp.Body.Close()

	fmt.Printf("%s[Synapse]%s ", colorCyan, colorReset)

	scanner := bufio.NewScanner(resp.Body)
	var eventType, data string
	hasTokens := false

	for scanner.Scan() {
		line := scanner.Text()

		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			data = strings.TrimSpace(line[5:])
		case line == "":
			if data == "" || data == "[DONE]" {
				eventType, data = "", ""
				continue
			}

			var payload map[string]any
			if err := json.Unmarshal([]byte(data), &payload); err != nil {
				eventType, data = "", ""
				continue
			}

			switch eventType {
			case "thought":
				if thought, ok := payload["thought"].(string); ok && thought != "" {
					if len(thought) > 80 {
						thought = thought[:80]
					}
					fmt.Printf("\n%s[생각중] %s...%s", colorDim, thought, colorReset)
				}
			case "tool_call":
				if tool, ok := payload["tool_name"].(string); ok {
					fmt.Printf("\n%s[도구] %s 실행 중...%s", colorDim, tool, colorReset)
				}
			case "token":
				if chunk, ok := payload["chunk"].(string); ok {
					fmt.Print(chunk)
					hasTokens = true
				}
			case "final":
				if answer, ok := payload["answer"].(string); ok && !hasTokens {
					fmt.Print(answer)
				}
			case "error":
				if msg, ok := payload["message"].(string); ok {
					fmt.Fprintf(os.Stderr, "\n오류: %s", msg)
				}
			}

			eventType, data = "", ""
		}
	}
	fmt.Println()
}
