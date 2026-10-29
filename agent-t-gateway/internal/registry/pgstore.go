package registry

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

const loadSQL = `
SELECT a.id, a.system_id, COALESCE(a.host, ''),
       COALESCE((a.label_info::jsonb)->>'instance_role', ''),
       COALESCE((a.label_info::jsonb)->>'agent_token_sha256', ''),
       COALESCE((a.label_info::jsonb)->>'tx_slow_threshold_ms', ''),
       COALESCE((a.label_info::jsonb)->>'enabled', ''),
       s.system_name, COALESCE(s.display_name, ''), COALESCE(s.environment, ''),
       s.tx_slow_threshold_ms, s.tx_retention_days
FROM agent_instances a JOIN systems s ON s.id = a.system_id
WHERE a.agent_type = 'agent_t'
  AND a.label_info IS NOT NULL AND a.label_info <> ''`

type PGStore struct{ Pool *pgxpool.Pool }

func (p PGStore) Load(ctx context.Context) ([]Row, error) {
	rows, err := p.Pool.Query(ctx, loadSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.AgentID, &r.SystemID, &r.Host, &r.InstanceRole, &r.TokenSHA256,
			&r.SlowMsLabel, &r.EnabledLabel, &r.SystemName, &r.DisplayName, &r.Environment,
			&r.SystemSlowMs, &r.SystemRetDays); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
