import { useReducedMotion } from '@/hooks/useReducedMotion'

export type SigStateType = 'idle' | 'receiving' | 'broadcasting' | 'alert'

interface SigProps {
  size?: number
  state?: SigStateType
}

export function Sig({ size = 64, state = 'idle' }: SigProps) {
  const noAnim = useReducedMotion()
  const arcOpacity = state === 'broadcasting' || state === 'receiving' ? 0.85 : 0.35
  const visorColor = state === 'alert' ? 'var(--t-critical)' : 'var(--t-accent)'
  const visorBg = state === 'alert' ? 'var(--t-critical-bg)' : 'var(--t-accent-muted)'

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {/* signal arcs - inner left */}
      <path
        d="M14 24 Q8 32 14 40"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={arcOpacity}
      >
        {!noAnim && state === 'broadcasting' && (
          <animate
            attributeName="opacity"
            values="0.2;0.9;0.2"
            dur="1.6s"
            repeatCount="indefinite"
          />
        )}
      </path>
      {/* signal arcs - inner right */}
      <path
        d="M50 24 Q56 32 50 40"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={arcOpacity}
      >
        {!noAnim && state === 'broadcasting' && (
          <animate
            attributeName="opacity"
            values="0.2;0.9;0.2"
            dur="1.6s"
            begin="0.2s"
            repeatCount="indefinite"
          />
        )}
      </path>

      {/* outer arcs (broadcasting only) */}
      {state === 'broadcasting' && (
        <>
          <path
            d="M8 18 Q-2 32 8 46"
            stroke="var(--t-accent)"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
            opacity={noAnim ? 0.4 : undefined}
          >
            {!noAnim && (
              <animate attributeName="opacity" values="0;0.6;0" dur="2s" repeatCount="indefinite" />
            )}
          </path>
          <path
            d="M56 18 Q66 32 56 46"
            stroke="var(--t-accent)"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
            opacity={noAnim ? 0.4 : undefined}
          >
            {!noAnim && (
              <animate
                attributeName="opacity"
                values="0;0.6;0"
                dur="2s"
                begin="0.3s"
                repeatCount="indefinite"
              />
            )}
          </path>
        </>
      )}

      {/* head */}
      <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="2" />
      {/* visor */}
      <rect
        x="22"
        y="28"
        width="20"
        height="6"
        rx="3"
        fill={visorBg}
        stroke={visorColor}
        strokeWidth="1.5"
      />
      <circle cx="27" cy="31" r="1.2" fill={visorColor}>
        {!noAnim && state === 'receiving' && (
          <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
        )}
      </circle>
      <circle cx="37" cy="31" r="1.2" fill={visorColor}>
        {!noAnim && state === 'receiving' && (
          <animate
            attributeName="opacity"
            values="1;0.3;1"
            dur="0.8s"
            begin="0.4s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      {/* mouth */}
      <path
        d="M28 39 Q32 41 36 39"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  )
}
