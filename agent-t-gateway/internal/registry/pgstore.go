package registry

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// label_info is read as text and parsed per row in Go: a single malformed row must
// not make the whole registry refresh fail (a ::jsonb cast in SQL would).
const loadSQL = `
SELECT a.id, a.system_id, COALESCE(a.host, ''), COALESCE(a.label_info, ''),
       s.system_name, COALESCE(s.display_name, ''), COALESCE(s.environment, ''),
       s.tx_slow_threshold_ms, s.tx_retention_days
FROM agent_instances a JOIN systems s ON s.id = a.system_id
WHERE a.agent_type = 'agent_t'
  AND a.label_info IS NOT NULL AND a.label_info <> ''`

type PGStore struct{ Pool *pgxpool.Pool }

// badLabelLogged remembers agent ids already reported, so a bad row logs once, not every refresh.
var badLabelLogged sync.Map

type labelFields struct{ instanceRole, tokenSHA256, slowMs, enabled string }

// parseLabel extracts the fields the gateway needs from label_info. ok=false when the
// text is not a JSON object.
func parseLabel(raw string) (labelFields, bool) {
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil || m == nil {
		return labelFields{}, false
	}
	return labelFields{
		instanceRole: labelStr(m["instance_role"]),
		tokenSHA256:  labelStr(m["agent_token_sha256"]),
		slowMs:       labelStr(m["tx_slow_threshold_ms"]),
		enabled:      labelStr(m["enabled"]),
	}, true
}

// labelStr mirrors Postgres ->> semantics: scalars as text, null/missing/nested as "".
func labelStr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return ""
}

func (p PGStore) Load(ctx context.Context) ([]Row, error) {
	rows, err := p.Pool.Query(ctx, loadSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		var label string
		if err := rows.Scan(&r.AgentID, &r.SystemID, &r.Host, &label,
			&r.SystemName, &r.DisplayName, &r.Environment,
			&r.SystemSlowMs, &r.SystemRetDays); err != nil {
			return nil, err
		}
		f, ok := parseLabel(label)
		if !ok {
			if _, seen := badLabelLogged.LoadOrStore(r.AgentID, true); !seen {
				log.Printf("registry: agent %d has invalid label_info (not a JSON object); skipped", r.AgentID)
			}
			continue
		}
		r.InstanceRole, r.TokenSHA256, r.SlowMsLabel, r.EnabledLabel = f.instanceRole, f.tokenSHA256, f.slowMs, f.enabled
		out = append(out, r)
	}
	return out, rows.Err()
}
