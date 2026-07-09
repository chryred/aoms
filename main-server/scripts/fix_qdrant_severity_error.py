"""
Qdrant log_incidents severity='error' 포인트 일괄 정규화 스크립트 (1회성)

배경: LLM이 열거형(info/warning/critical) 밖 severity="error"를 반환한 분석 결과가
log_incidents 포인트 payload에 저장됨. template 단위 stored-wins 승계 구조상
이 포인트가 남아 있으면 같은 패턴의 알림마다 "error"가 계속 재사용된다.
(코드의 _recognize_templates 정규화가 방어하지만 payload 원본도 정리한다.)

동작: severity="error" 필터로 scroll → set_payload로 severity="warning" 일괄 갱신.

의존성: 없음 (표준 라이브러리만 — 폐쇄망에서 pip 설치 불필요, Python 3.6+)

실행 방법 (Server B Qdrant에 접근 가능한 곳 아무 데서나):

  # 1) 먼저 대상 수 확인 (갱신 없음)
  python3 fix_qdrant_severity_error.py --qdrant-url http://{server-b-ip}:6333 --dry-run

  # 2) 실제 갱신
  python3 fix_qdrant_severity_error.py --qdrant-url http://{server-b-ip}:6333

  # 또는 Server A의 log-analyzer 컨테이너 안에서 (QDRANT_URL env 자동 사용):
  docker cp fix_qdrant_severity_error.py synapse-log-analyzer:/tmp/
  docker exec synapse-log-analyzer python /tmp/fix_qdrant_severity_error.py --dry-run
  docker exec synapse-log-analyzer python /tmp/fix_qdrant_severity_error.py
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

COLLECTION = "log_incidents"
FILTER_ERROR = {"must": [{"key": "severity", "match": {"value": "error"}}]}


def post_json(url: str, body: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--qdrant-url", default=os.getenv("QDRANT_URL", "http://localhost:6333"))
    parser.add_argument("--dry-run", action="store_true", help="갱신 없이 대상 포인트 수만 출력")
    args = parser.parse_args()

    base = f"{args.qdrant_url.rstrip('/')}/collections/{COLLECTION}"

    # 대상 포인트 수집 (scroll — payload/vector 불필요, id만)
    point_ids: list = []
    offset = None
    while True:
        body = {"filter": FILTER_ERROR, "limit": 500, "with_payload": False, "with_vector": False}
        if offset is not None:
            body["offset"] = offset
        result = post_json(f"{base}/points/scroll", body, timeout=30)["result"]
        point_ids.extend(p["id"] for p in result["points"])
        offset = result.get("next_page_offset")
        if offset is None:
            break

    print(f"severity='error' 포인트: {len(point_ids)}개")
    if not point_ids:
        return
    if args.dry_run:
        print("--dry-run — 갱신 생략")
        return

    # 배치 set_payload (500개씩)
    for i in range(0, len(point_ids), 500):
        batch = point_ids[i:i + 500]
        post_json(
            f"{base}/points/payload?wait=true",
            {"payload": {"severity": "warning"}, "points": batch},
        )
        print(f"  갱신 {i + len(batch)}/{len(point_ids)}")

    print("완료 — severity='error' → 'warning'")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        print(f"Qdrant 요청 실패: {e}", file=sys.stderr)
        sys.exit(1)
