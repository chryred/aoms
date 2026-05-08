export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: '신규',
  acknowledged: '확인됨',
  investigating: '원인파악 중',
  resolved: '해결됨',
  closed: '종료',
}

export const INCIDENT_STATUS_STYLES: Record<string, string> = {
  open: 'bg-critical/15 text-critical border-critical/30',
  acknowledged: 'bg-warning/15 text-warning border-warning/30',
  investigating: 'bg-accent/15 text-accent border-accent/30',
  resolved: 'bg-normal/15 text-normal border-normal/30',
  closed: 'bg-surface text-text-disabled border-border',
}

export const INCIDENT_SEVERITY_STYLES: Record<string, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
  info: 'text-text-secondary',
}
