/**
 * Shared formatting utilities for agent display across panels.
 */

/** Extract 1-2 character initials from an agent name. Returns '?' for empty/blank. */
export function getInitials(name: string): string {
  const result = name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return result || '?'
}

/** Deterministic color class from a name string. */
export function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
  ]
  return colors[Math.abs(hash) % colors.length]
}

/** Deterministic color palette from an agent ID using golden angle rotation. */
export interface AgentColorPalette {
  hue: number
  bg: string
  bgLight: string
  text: string
  border: string
  accent: string
}

export function getAgentColor(agentId: number): AgentColorPalette {
  const hue = Math.round(((agentId * 137.508) % 360 + 360) % 360)
  return {
    hue,
    bg: `hsl(${hue}, 70%, 45%)`,
    bgLight: `hsl(${hue}, 70%, 85%)`,
    text: '#ffffff',
    border: `hsl(${hue}, 70%, 55%)`,
    accent: `hsl(${hue}, 80%, 60%)`,
  }
}
