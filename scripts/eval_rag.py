#!/usr/bin/env python3
"""한국어 RAG 평가 스크립트.

평가셋 JSON을 읽어 각 query를 검색 endpoint(/incident/search 등)에 전송하고,
expected_keywords 기반 lowercase 매칭으로 정답 여부를 판정.
Recall@5, Recall@10, MRR, NDCG@5 메트릭을 카테고리별로 집계해 콘솔과 JSON으로 출력.

reranker 도입 전후 baseline A/B 비교에 사용.

usage:
  python scripts/eval_rag.py \\
      --eval-set docs/rag-eval/korean-eval-set.json \\
      --endpoint http://localhost:8000/incident/search \\
      --top-k 10 \\
      --output docs/rag-eval/results/eval_$(date +%Y%m%d_%H%M%S).json

옵션:
  --system-name      특정 system_name 필터로 호출 (옵션)
  --response-format  incident | knowledge | auto (기본 auto — 응답 키 자동 감지)
  --timeout          요청 타임아웃 초 (기본 30)
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import httpx


# ── 응답 파싱 ────────────────────────────────────────────────────────────────

# log-analyzer /incident/search 응답을 hit 리스트로 평탄화할 때 추출하는 텍스트 필드.
# 각 응답 hit dict 에서 모아 하나의 검색 가능한 텍스트로 합친다.
INCIDENT_TEXT_FIELDS = [
    "log_pattern",
    "root_cause",
    "recommendation",
    "resolution",
    "alertname",
    "metric_name",
    "system_name",
    "severity",
]

# 향후 /knowledge/search 도입 시 사용할 필드 — 지금은 placeholder.
KNOWLEDGE_TEXT_FIELDS = [
    "title",
    "summary",
    "content",
    "snippet",
    "url",
]


def flatten_incident_response(body: dict[str, Any]) -> list[dict[str, Any]]:
    """`/incident/search` 응답을 단일 hit 리스트로 평탄화.

    log_incidents 와 metric_incidents 를 score 내림차순 통합 정렬한다.
    """
    log_hits = body.get("log_incidents", []) or []
    metric_hits = body.get("metric_incidents", []) or []

    merged: list[dict[str, Any]] = []
    for hit in log_hits:
        merged.append({**hit, "_source": "log_incidents"})
    for hit in metric_hits:
        merged.append({**hit, "_source": "metric_incidents"})

    merged.sort(key=lambda h: h.get("score", 0.0), reverse=True)
    return merged


def flatten_knowledge_response(body: dict[str, Any]) -> list[dict[str, Any]]:
    """`/knowledge/search` (향후) 응답 평탄화 — results 또는 hits 키 가정."""
    items = body.get("results") or body.get("hits") or body.get("documents") or []
    out: list[dict[str, Any]] = []
    for item in items:
        out.append({**item, "_source": item.get("source", "knowledge")})
    return out


def auto_flatten(body: dict[str, Any]) -> list[dict[str, Any]]:
    if "log_incidents" in body or "metric_incidents" in body:
        return flatten_incident_response(body)
    if any(k in body for k in ("results", "hits", "documents")):
        return flatten_knowledge_response(body)
    # 그 외 — 응답이 이미 hit list 형태인 경우
    if isinstance(body, list):
        return list(body)
    return []


def hit_to_text(hit: dict[str, Any], extra_fields: Iterable[str] = ()) -> str:
    """Hit dict 에서 keyword 매칭에 쓸 텍스트를 합친다."""
    parts: list[str] = []
    for field in list(INCIDENT_TEXT_FIELDS) + list(KNOWLEDGE_TEXT_FIELDS) + list(extra_fields):
        val = hit.get(field)
        if val is None:
            continue
        if isinstance(val, (list, tuple)):
            parts.extend(str(v) for v in val)
        else:
            parts.append(str(val))
    return " ".join(parts).lower()


# ── 매칭 / 메트릭 ───────────────────────────────────────────────────────────

def find_relevant_ranks(
    hits: list[dict[str, Any]],
    expected_keywords: list[str],
) -> list[int]:
    """expected_keywords 중 하나라도 포함된 hit의 1-indexed rank 리스트를 반환."""
    keywords = [k.lower() for k in expected_keywords if k]
    ranks: list[int] = []
    for idx, hit in enumerate(hits, start=1):
        text = hit_to_text(hit)
        if any(kw in text for kw in keywords):
            ranks.append(idx)
    return ranks


def recall_at_k(ranks: list[int], k: int) -> float:
    """정답이 top-k 안에 1건이라도 있으면 1.0 아니면 0.0."""
    return 1.0 if any(r <= k for r in ranks) else 0.0


def reciprocal_rank(ranks: list[int]) -> float:
    if not ranks:
        return 0.0
    return 1.0 / min(ranks)


def ndcg_at_k(ranks: list[int], k: int) -> float:
    """이진 relevance(0/1) 가정의 NDCG@k.

    DCG = Σ rel_i / log2(i+1) (i: 1-indexed rank)
    IDCG = 정답 개수 m 에 대해 Σ_{i=1..min(m,k)} 1 / log2(i+1)
    """
    if not ranks:
        return 0.0
    dcg = 0.0
    for r in ranks:
        if r <= k:
            dcg += 1.0 / math.log2(r + 1)
    m = min(len(ranks), k)
    if m == 0:
        return 0.0
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, m + 1))
    return dcg / idcg if idcg > 0 else 0.0


# ── 메인 평가 루프 ──────────────────────────────────────────────────────────

def evaluate_one(
    client: httpx.Client,
    endpoint: str,
    query: dict[str, Any],
    top_k: int,
    system_name: str | None,
    response_format: str,
    timeout: float,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": query["query"], "limit": top_k}
    if system_name:
        payload["system_name"] = system_name

    try:
        resp = client.post(endpoint, json=payload, timeout=timeout)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        return {
            **query,
            "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}",
            "hits_count": 0,
            "ranks": [],
        }
    except httpx.RequestError as e:
        return {
            **query,
            "error": f"RequestError: {e}",
            "hits_count": 0,
            "ranks": [],
        }

    body = resp.json()
    if response_format == "incident":
        hits = flatten_incident_response(body)
    elif response_format == "knowledge":
        hits = flatten_knowledge_response(body)
    else:
        hits = auto_flatten(body)

    hits = hits[:top_k]
    ranks = find_relevant_ranks(hits, query.get("expected_keywords", []))

    return {
        **query,
        "hits_count": len(hits),
        "ranks": ranks,
        "top1_score": hits[0].get("score") if hits else None,
        "recall@5": recall_at_k(ranks, 5),
        "recall@10": recall_at_k(ranks, 10),
        "mrr": reciprocal_rank(ranks),
        "ndcg@5": ndcg_at_k(ranks, 5),
    }


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    """전체 + 카테고리별 메트릭 집계."""
    def _avg(vals: list[float]) -> float:
        return statistics.mean(vals) if vals else 0.0

    def _agg(subset: list[dict[str, Any]]) -> dict[str, Any]:
        valid = [r for r in subset if "error" not in r]
        return {
            "n": len(subset),
            "n_valid": len(valid),
            "n_errored": len(subset) - len(valid),
            "recall@5": round(_avg([r["recall@5"] for r in valid]), 4),
            "recall@10": round(_avg([r["recall@10"] for r in valid]), 4),
            "mrr": round(_avg([r["mrr"] for r in valid]), 4),
            "ndcg@5": round(_avg([r["ndcg@5"] for r in valid]), 4),
        }

    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in results:
        by_cat[r.get("category", "unknown")].append(r)

    return {
        "overall": _agg(results),
        "by_category": {cat: _agg(items) for cat, items in sorted(by_cat.items())},
    }


# ── 출력 ────────────────────────────────────────────────────────────────────

def print_table(summary: dict[str, Any]) -> None:
    overall = summary["overall"]
    print("\n" + "=" * 72)
    print(" RAG 평가 결과 (전체)")
    print("=" * 72)
    print(f"  Queries        : {overall['n']} (valid={overall['n_valid']}, error={overall['n_errored']})")
    print(f"  Recall@5       : {overall['recall@5']:.4f}")
    print(f"  Recall@10      : {overall['recall@10']:.4f}")
    print(f"  MRR            : {overall['mrr']:.4f}")
    print(f"  NDCG@5         : {overall['ndcg@5']:.4f}")
    print()

    print("-" * 72)
    print(f" {'Category':<16}{'N':>4}{'R@5':>10}{'R@10':>10}{'MRR':>10}{'NDCG@5':>10}")
    print("-" * 72)
    for cat, m in summary["by_category"].items():
        print(f" {cat:<16}{m['n']:>4}{m['recall@5']:>10.4f}{m['recall@10']:>10.4f}"
              f"{m['mrr']:>10.4f}{m['ndcg@5']:>10.4f}")
    print("-" * 72)


def print_failures(results: list[dict[str, Any]], limit: int = 10) -> None:
    fails = [r for r in results if "error" not in r and not r["ranks"]]
    if not fails:
        return
    print(f"\n[정답 hit 없음] {len(fails)}건 (상위 {min(limit, len(fails))}건 표시)")
    for r in fails[:limit]:
        print(f"  - [{r['id']}] {r['query']}  (top1_score={r.get('top1_score')})")

    errored = [r for r in results if "error" in r]
    if errored:
        print(f"\n[오류 발생] {len(errored)}건")
        for r in errored[:limit]:
            print(f"  - [{r['id']}] {r['error']}")


# ── CLI ─────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Synapse-V 한국어 RAG 평가 스크립트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--eval-set",
        type=Path,
        default=Path("docs/rag-eval/korean-eval-set.json"),
        help="평가셋 JSON 경로",
    )
    p.add_argument(
        "--endpoint",
        type=str,
        default="http://localhost:8000/incident/search",
        help="검색 endpoint URL",
    )
    p.add_argument(
        "--top-k",
        type=int,
        default=10,
        help="검색 결과 상위 K개 (기본 10)",
    )
    p.add_argument(
        "--system-name",
        type=str,
        default=None,
        help="system_name 필터 (옵션)",
    )
    p.add_argument(
        "--response-format",
        choices=["auto", "incident", "knowledge"],
        default="auto",
        help="응답 파싱 포맷 (기본 auto)",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="요청 타임아웃 초 (기본 30)",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=None,
        help="결과 저장 경로 (미지정 시 docs/rag-eval/results/eval_<timestamp>.json)",
    )
    p.add_argument(
        "--show-failures",
        type=int,
        default=10,
        help="콘솔에 출력할 실패 query 최대 개수 (기본 10)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.eval_set.exists():
        print(f"[ERROR] 평가셋 파일 없음: {args.eval_set}", file=sys.stderr)
        return 2

    with args.eval_set.open(encoding="utf-8") as f:
        eval_set = json.load(f)

    queries = eval_set.get("queries", [])
    if not queries:
        print("[ERROR] 평가셋에 queries 가 없습니다.", file=sys.stderr)
        return 2

    print(f"[info] eval_set       : {args.eval_set}")
    print(f"[info] endpoint       : {args.endpoint}")
    print(f"[info] queries        : {len(queries)}")
    print(f"[info] top_k          : {args.top_k}")
    print(f"[info] response_format: {args.response_format}")
    if args.system_name:
        print(f"[info] system_name    : {args.system_name}")

    started_at = datetime.now()

    results: list[dict[str, Any]] = []
    with httpx.Client() as client:
        for i, q in enumerate(queries, 1):
            print(f"  ({i:>3}/{len(queries)}) [{q.get('id', '?')}] {q.get('query', '')[:60]}", flush=True)
            res = evaluate_one(
                client=client,
                endpoint=args.endpoint,
                query=q,
                top_k=args.top_k,
                system_name=args.system_name,
                response_format=args.response_format,
                timeout=args.timeout,
            )
            if "error" in res:
                # 첫 query 부터 endpoint 가 죽어 있으면 친절하게 종료.
                if i == 1 and ("RequestError" in res["error"] or "ConnectError" in res["error"]):
                    print(f"\n[ERROR] endpoint 호출 실패: {res['error']}", file=sys.stderr)
                    print(f"        endpoint={args.endpoint} 가 살아 있는지 확인하세요.", file=sys.stderr)
                    print(f"        log-analyzer 가 실행 중이어야 합니다 (make run-analyzer).", file=sys.stderr)
                    return 3
            results.append(res)

    finished_at = datetime.now()
    summary = aggregate(results)
    print_table(summary)
    print_failures(results, limit=args.show_failures)

    # 결과 저장
    output_path = args.output
    if output_path is None:
        ts = started_at.strftime("%Y%m%d_%H%M%S")
        output_path = Path("docs/rag-eval/results") / f"eval_{ts}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "eval_set_version": eval_set.get("version"),
        "eval_set_path": str(args.eval_set),
        "endpoint": args.endpoint,
        "top_k": args.top_k,
        "system_name": args.system_name,
        "response_format": args.response_format,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": round((finished_at - started_at).total_seconds(), 3),
        "summary": summary,
        "results": results,
    }
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n[saved] {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
