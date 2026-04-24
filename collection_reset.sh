#!/bin/bash

QDRANT_URL="${1:-http://localhost:6333}"

echo "Qdrant: $QDRANT_URL"
echo ""

COLLECTIONS=(log_incidents metric_baselines metric_hourly_patterns aggregation_summaries)

echo "=== 삭제 ==="
for col in "${COLLECTIONS[@]}"; do
  result=$(curl -s -X DELETE "$QDRANT_URL/collections/$col")
  echo "$col: $result"
done

echo ""
echo "=== 생성 (Dense 1024 + Sparse BM25 Hybrid) ==="
for col in "${COLLECTIONS[@]}"; do
  result=$(curl -s -X PUT "$QDRANT_URL/collections/$col" \
    -H "Content-Type: application/json" \
    -d '{
      "vectors": {"dense": {"size": 1024, "distance": "Cosine"}},
      "sparse_vectors": {"sparse": {"modifier": "idf"}},
      "hnsw_config": {"m": 16, "ef_construct": 200, "ef": 128}
    }')
  echo "$col: $result"
done

echo ""
echo "=== 확인 ==="
for col in "${COLLECTIONS[@]}"; do
  echo -n "$col: "
  curl -s "$QDRANT_URL/collections/$col" | python3 -c \
    "import sys,json; r=json.load(sys.stdin)['result']['config']['params']; print('sparse=' + str(list(r.get('sparse_vectors',{}).keys())))"
done
