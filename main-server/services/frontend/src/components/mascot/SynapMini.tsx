interface SynapMiniProps {
  size?: number
}

export function SynapMini({ size = 20 }: SynapMiniProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <line x1="12" y1="6" x2="12" y2="3" />
      <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <line x1="8" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="16" y2="12" />
      <line x1="4" y1="11" x2="2.5" y2="11" />
      <line x1="4" y1="14" x2="2.5" y2="14" />
      <line x1="20" y1="11" x2="21.5" y2="11" />
      <line x1="20" y1="14" x2="21.5" y2="14" />
    </svg>
  )
}
