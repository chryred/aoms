import { useReducedMotion } from '@/hooks/useReducedMotion'

export type SynapStateType = 'idle' | 'listening' | 'thinking' | 'alert'

interface SynapProps {
  size?: number
  state?: SynapStateType
}

export function Synap({ size = 64, state = 'idle' }: SynapProps) {
  const noAnim = useReducedMotion()

  const eyeColor = state === 'alert' ? 'var(--t-critical)' : 'var(--t-accent)'
  const antennaColor = state === 'alert' ? 'var(--t-critical)' : 'var(--t-accent)'

  const eyeProps = (() => {
    switch (state) {
      case 'listening':
        return { y1: 26, y2: 32, w: 2.5, dot: false }
      case 'thinking':
        return { y1: 28, y2: 28, w: 2.5, dot: true }
      case 'alert':
        return { y1: 27, y2: 30, w: 2.5, dot: false }
      default:
        return { y1: 28, y2: 28, w: 2.5, dot: false }
    }
  })()

  const renderEye = (cx: number) => {
    if (eyeProps.dot) return <circle key={cx} cx={cx} cy="28" r="1.2" fill={eyeColor} />
    return (
      <line
        key={cx}
        x1={cx - 3}
        y1={eyeProps.y1}
        x2={cx + 3}
        y2={eyeProps.y2}
        stroke={eyeColor}
        strokeWidth={eyeProps.w}
        strokeLinecap="round"
      />
    )
  }

  const mouth = (() => {
    switch (state) {
      case 'thinking':
        return (
          <line
            x1="28"
            y1="40"
            x2="32"
            y2="40"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
        )
      case 'alert':
        return (
          <line
            x1="27"
            y1="41"
            x2="37"
            y2="41"
            stroke="var(--t-critical)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )
      case 'listening':
        return (
          <path
            d="M27 40 Q32 43 37 40"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.7"
          />
        )
      default:
        return (
          <line
            x1="28"
            y1="40"
            x2="36"
            y2="40"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
        )
    }
  })()

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {/* body */}
      <rect x="12" y="14" width="40" height="38" rx="6" stroke="currentColor" strokeWidth="2" />
      {renderEye(23)}
      {renderEye(41)}
      {mouth}

      {/* antenna */}
      <line
        x1="32"
        y1="14"
        x2="32"
        y2="8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="6" r="2" fill={antennaColor}>
        {!noAnim && state === 'thinking' && (
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
        )}
        {!noAnim && state === 'alert' && (
          <animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite" />
        )}
      </circle>

      {/* side chips */}
      <line
        x1="12"
        y1="30"
        x2="9"
        y2="30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="36"
        x2="9"
        y2="36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="52"
        y1="30"
        x2="55"
        y2="30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="52"
        y1="36"
        x2="55"
        y2="36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* thinking dots */}
      {state === 'thinking' && (
        <g>
          <circle cx="44" cy="10" r="1.5" fill="var(--t-accent)" opacity={noAnim ? 0.6 : undefined}>
            {!noAnim && (
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur="1.2s"
                begin="0s"
                repeatCount="indefinite"
              />
            )}
          </circle>
          <circle cx="50" cy="10" r="1.5" fill="var(--t-accent)" opacity={noAnim ? 0.6 : undefined}>
            {!noAnim && (
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur="1.2s"
                begin="0.2s"
                repeatCount="indefinite"
              />
            )}
          </circle>
          <circle cx="56" cy="10" r="1.5" fill="var(--t-accent)" opacity={noAnim ? 0.6 : undefined}>
            {!noAnim && (
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur="1.2s"
                begin="0.4s"
                repeatCount="indefinite"
              />
            )}
          </circle>
        </g>
      )}
    </svg>
  )
}
