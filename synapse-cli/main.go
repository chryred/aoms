package main

import (
	"fmt"
	"os"

	"synapse-cli/cmd"
)

const helpText = `Synapse CLI — 백화점 통합 모니터링 LLM 질의 채널

사용법:
  synapse login                          최초 설정 (서버/계정/시스템 등록)
  synapse ask "질문"                     단방향 LLM 질의
  synapse ask --system oms "질문"        타 시스템 컨텍스트로 질의
  synapse ask --area infra "질문"        분석 영역 지정
  synapse chat                           대화형 모드 (이전 세션 선택 포함)
  synapse chat --new                     새 대화 시작
  synapse chat --session <id>            특정 세션으로 진입

파이프 지원:
  cat log.txt | synapse ask "분석해줘"
  tail -100 /app/logs/error.log | synapse ask "심각한 에러 있어?"
  grep ERROR /var/log/app.log | synapse ask "원인이 뭘까?"

예시:
  synapse ask "ORA-01555 에러 즉각 조치 알려줘"
  synapse ask "CPU 90% 원인이 뭘까?"
  synapse ask --system cms "현재 알림 상황 요약해줘"
  synapse chat --new`

func main() {
	args := os.Args[1:]

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" || args[0] == "help" {
		fmt.Println(helpText)
		return
	}

	command := args[0]
	rest := args[1:]

	switch command {
	case "login":
		cmd.RunLogin()
	case "ask":
		cmd.RunAsk(rest)
	case "chat":
		cmd.RunChat(rest)
	default:
		fmt.Fprintf(os.Stderr, "알 수 없는 명령어: %s\n", command)
		fmt.Fprintln(os.Stderr, "'synapse --help'로 사용법을 확인하세요.")
		os.Exit(1)
	}
}
