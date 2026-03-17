# Visual Quality & Rendering Gaps — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all visual/rendering gaps identified in the expert comparison: spring-animated panels, dark-themed speech bubbles with exit animations, per-agent color threading, hover tooltips on canvas agents, force-directed trust graph, CSS-transition-based movement (eliminate rAF re-renders), and layered disclosure pattern.

**Architecture:** All changes are UI-only (no backend/API changes). Work within the existing DOM-based rendering — PixiJS migration is deferred as a separate milestone. Use CSS transitions and Framer Motion (already available via `motion` package) for animations. Minimize DOM node count where possible.

**Tech Stack:** React 19, Tailwind CSS 3, CSS transitions/animations, next-intl, recharts (for trust graph)

**Priority Order:** High-ROI quick wins first, then medium-effort improvements.

---

## Context for the Implementer

- **Project:** Mission Control — `/Users/oudaymneimneh/Mission Control`
- **Stack:** Next.js 16, React 19, TypeScript 5, Tailwind 3, pnpm
- **Key files you'll modify:**
  - `src/components/panels/office-panel.tsx` (~2700 lines — the main office canvas)
  - `src/components/panels/meeting-panel.tsx` (~370 lines — meeting sidebar)
  - `src/components/panels/meeting-analytics-panel.tsx` (~150 lines — analytics dashboard)
  - `src/lib/format-utils.ts` (shared color/initials utilities)
  - `messages/en.json` (i18n keys)
- **Run after each task:** `pnpm typecheck && pnpm test` (must be 0 errors, 1288+ tests pass)
- **Conventions:** No Co-Authored-By trailers. No icon libraries. pnpm only. Conventional commits.
- **Current state:** Server runs on localhost:4000 via launchd. After all changes: `pnpm build` then `launchctl stop com.mission-control && launchctl start com.mission-control` to deploy.

---

## Task 1: Per-Agent Color Threading (High ROI, ~2 hours)

**Problem:** Agent colors only appear on initials badges. The same agent's desk, speech bubble border, meeting marker, and sidebar indicator all use different/no colors. Users can't visually track an agent across the UI.

**Files:**
- Modify: `src/lib/format-utils.ts` — add `hashBorderColor()` and `hashTextColor()` variants
- Modify: `src/components/panels/office-panel.tsx` — thread agent color to desk glow, name label, meeting marker

**Implementation:**

Add to `format-utils.ts`:

```typescript
/** Deterministic border color class from agent name. */
export function hashBorderColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'border-blue-500/40', 'border-emerald-500/40', 'border-violet-500/40', 'border-amber-500/40',
    'border-rose-500/40', 'border-cyan-500/40', 'border-indigo-500/40', 'border-teal-500/40',
    'border-orange-500/40', 'border-pink-500/40', 'border-lime-500/40', 'border-fuchsia-500/40',
  ]
  return colors[Math.abs(hash) % colors.length]
}

/** Deterministic shadow glow from agent name. */
export function hashGlow(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const glows = [
    'shadow-[0_0_8px_rgba(59,130,246,0.3)]', 'shadow-[0_0_8px_rgba(16,185,129,0.3)]',
    'shadow-[0_0_8px_rgba(139,92,246,0.3)]', 'shadow-[0_0_8px_rgba(245,158,11,0.3)]',
    'shadow-[0_0_8px_rgba(244,63,94,0.3)]', 'shadow-[0_0_8px_rgba(6,182,212,0.3)]',
    'shadow-[0_0_8px_rgba(99,102,241,0.3)]', 'shadow-[0_0_8px_rgba(20,184,166,0.3)]',
    'shadow-[0_0_8px_rgba(249,115,22,0.3)]', 'shadow-[0_0_8px_rgba(236,72,153,0.3)]',
    'shadow-[0_0_8px_rgba(132,204,22,0.3)]', 'shadow-[0_0_8px_rgba(192,38,211,0.3)]',
  ]
  return glows[Math.abs(hash) % glows.length]
}
```

In `office-panel.tsx`, thread the color to:

1. **Agent name label** (~line 2143): Add `hashBorderColor(agent.name)` to the name label's border
2. **Speech bubble border** (~line 2207): Replace `border-void-cyan/30` with `hashBorderColor(agent.name)`
3. **Desk chair area** (~line 2044): Add subtle `hashGlow(agent.name)` to the chair sprite container
4. **Meeting marker initials** (~line 2220): Use `hashBorderColor(meeting.initiator_name)` and `hashBorderColor(meeting.participant_name)` instead of the status-only color

**Verification:** Visual — each agent should have a consistent color across all their UI elements. Typecheck + tests pass.

---

## Task 2: Dark-Themed Speech Bubbles with Exit Animation (High ROI, ~1 hour)

**Problem:** Speech bubbles are white (`bg-white/95`) on a dark office canvas — visually jarring. They disappear instantly with no exit animation.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — speech bubble rendering (~lines 2200-2215)

**Implementation:**

Replace the speech bubble JSX (inside the `meetingSpeechBubbles.has(agent.id)` conditional):

```tsx
{meetingSpeechBubbles.has(agent.id) && (
  <div
    className="absolute -translate-x-1/2 pointer-events-none z-40 animate-in fade-in slide-in-from-bottom-2 duration-300"
    style={{ left: `${x}%`, top: `calc(${y}% - 80px)` }}
  >
    <div className={`max-w-[180px] rounded-lg bg-card/95 backdrop-blur-sm border ${hashBorderColor(agent.name)} shadow-lg px-2.5 py-1.5 text-[10px] text-foreground/90 leading-tight`}>
      <div className={`font-medium text-[9px] mb-0.5 ${hashTextColor ? hashTextColor(agent.name) : 'text-void-cyan'}`}>
        {meetingSpeechBubbles.get(agent.id)!.agentName}
      </div>
      <div>{String(meetingSpeechBubbles.get(agent.id)!.content).slice(0, 120)}{String(meetingSpeechBubbles.get(agent.id)!.content).length > 120 ? '...' : ''}</div>
    </div>
    <div className={`w-2 h-2 bg-card/95 border-r border-b ${hashBorderColor(agent.name)} rotate-45 mx-auto -mt-1`} />
  </div>
)}
```

Key changes:
- `bg-white/95` → `bg-card/95 backdrop-blur-sm` (matches dark theme)
- `border-void-cyan/30` → `hashBorderColor(agent.name)` (per-agent color)
- `text-slate-800` → `text-foreground/90` (theme-aware)

For exit animation: The current approach uses timer-based removal which can't animate. To add exit animation without a full animation library, use CSS `@keyframes` with a delayed opacity transition. Add to the `<style jsx>` block:

```css
@keyframes mcBubbleFadeOut {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(8px); }
}
```

Then track a `fadingBubbles` set — when a bubble's timer fires, move it to `fadingBubbles` with a 300ms delay before actual removal. Render fading bubbles with `animation: mcBubbleFadeOut 300ms ease-out forwards`.

---

## Task 3: Spring-Animated Meeting Panel Transitions (High ROI, ~2 hours)

**Problem:** Meeting panel appears/disappears instantly when toggled. Meeting cards have no entry animation. The panel feels static and flat compared to Linear's spring physics.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — grid layout transition
- Modify: `src/components/panels/meeting-panel.tsx` — card animations

**Implementation:**

For the grid layout transition, use CSS `transition` on the grid container:
```tsx
<div className={`grid grid-cols-1 ${gridClass} gap-4 transition-all duration-300 ease-out`}>
```

For meeting panel entry, wrap in a CSS animation container:
```tsx
{showMeetingPanel && (
  <div className="animate-in slide-in-from-right-4 fade-in duration-300">
    <MeetingPanel ... />
  </div>
)}
```

For meeting cards inside meeting-panel.tsx, add staggered entry animation:
```tsx
{activeMeetings.map((meeting, index) => (
  <div
    key={meeting.meeting_id}
    className={`rounded-lg border ${borderColor} bg-black/20 p-2 animate-in fade-in slide-in-from-bottom-2 duration-200`}
    style={{ animationDelay: `${index * 50}ms` }}
  >
```

---

## Task 4: CSS Transition-Based Agent Movement (Critical, ~4 hours)

**Problem:** Agent movement uses `requestAnimationFrame` calling `setMovingWorkers` every frame → full React re-render every 16ms. This is the single largest performance issue.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — movement system (~lines 1062-1178)

**Implementation:**

Replace the rAF-driven movement with CSS transitions. Instead of:
1. Storing `movingWorkers` in React state
2. Updating progress every frame via rAF
3. Computing positions in `useMemo`

Use:
1. Apply `transition: left 2.2s cubic-bezier(0.4, 0, 0.2, 1), top 2.2s cubic-bezier(0.4, 0, 0.2, 1)` to agent sprite containers
2. When an agent needs to move, just update their target position in `currentSeatMap`
3. The browser handles the interpolation natively — zero JS per frame

**Approach:**

1. Keep the `enqueueMovement` function signature but change its implementation:
   - Instead of creating a `MovingWorker` with path waypoints, directly update the agent's rendered position
   - Set a `movingAgentIds` set (already exists) with a timeout to clear after duration

2. Remove the rAF `useEffect` (lines 1150-1174) entirely

3. Remove `movingPositionByAgent` and `movingDirectionByAgent` memos

4. In the agent sprite container, add inline style:
   ```tsx
   style={{
     left: `${x}%`,
     top: `${y}%`,
     transition: 'left 2.2s cubic-bezier(0.4, 0, 0.2, 1), top 2.2s cubic-bezier(0.4, 0, 0.2, 1)',
   }}
   ```

5. The A* pathfinding (`buildPath`, `findGridPath`) can be kept for future PixiJS migration but is no longer used for visual interpolation — CSS handles the smooth movement.

**Trade-off:** CSS transitions move in a straight line (no grid pathfinding). For a pixel-art office this is acceptable — agents "walk" directly to their destination. The pathfinding was visually nice but the performance cost is not worth it at the DOM rendering layer.

**Verification:** Agent movement should be smooth without any `requestAnimationFrame` running. React DevTools profiler should show zero re-renders during movement.

---

## Task 5: Hover Tooltips on Canvas Agents (Medium ROI, ~3 hours)

**Problem:** No layered disclosure — clicking an agent opens a full modal immediately. No hover preview showing status, role, and current activity.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — agent sprite rendering
- Modify: `messages/en.json` — tooltip i18n keys

**Implementation:**

Add a `hoveredAgentId` state. On agent `onMouseEnter`, set it. On `onMouseLeave`, clear it.

When `hoveredAgentId === agent.id`, render a tooltip above the agent:

```tsx
{hoveredAgentId === agent.id && (
  <div
    className="absolute -translate-x-1/2 pointer-events-none z-35 animate-in fade-in duration-150"
    style={{ left: `${x}%`, top: `calc(${y}% - 95px)` }}
  >
    <div className="rounded-lg bg-card/95 backdrop-blur-sm border border-border shadow-xl px-3 py-2 text-[10px] min-w-[140px]">
      <div className="font-medium text-foreground text-[11px]">{agent.name}</div>
      <div className="text-muted-foreground">{agent.role}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className={`w-2 h-2 rounded-full ${statusDot[agent.status]}`} />
        <span className="text-foreground/80">{statusLabel[agent.status]}</span>
      </div>
      {meetingAgentIds.has(agent.id) && (
        <div className="text-void-cyan text-[9px] mt-1">{t('meetingBadge')}</div>
      )}
      {agent.last_activity && (
        <div className="text-muted-foreground text-[9px] mt-1 truncate max-w-[160px]">{agent.last_activity}</div>
      )}
    </div>
  </div>
)}
```

Change the agent click behavior:
- **Hover** → tooltip (lightweight, no fetch)
- **Click** → still opens the full modal (existing behavior)

---

## Task 6: Force-Directed Trust Network Graph (Medium ROI, ~4 hours)

**Problem:** Trust network is shown as horizontal bars in the analytics panel. A force-directed graph would be far more insightful for understanding agent social dynamics.

**Files:**
- Modify: `src/components/panels/meeting-analytics-panel.tsx` — replace trust bars with graph

**Implementation:**

Use a simple force simulation in React (no D3 dependency needed):

```typescript
interface GraphNode { id: number; name: string; x: number; y: number; vx: number; vy: number }
interface GraphEdge { source: number; target: number; weight: number }

function useForceLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const [positions, setPositions] = useState(nodes)

  useEffect(() => {
    let frame: number
    let iteration = 0
    const maxIterations = 100
    const localNodes = nodes.map(n => ({ ...n, x: width/2 + (Math.random()-0.5)*width*0.6, y: height/2 + (Math.random()-0.5)*height*0.6, vx: 0, vy: 0 }))

    function tick() {
      if (iteration >= maxIterations) return
      // Repulsion (all pairs)
      for (let i = 0; i < localNodes.length; i++) {
        for (let j = i+1; j < localNodes.length; j++) {
          const dx = localNodes[j].x - localNodes[i].x
          const dy = localNodes[j].y - localNodes[i].y
          const dist = Math.max(1, Math.hypot(dx, dy))
          const force = 500 / (dist * dist)
          localNodes[i].vx -= (dx / dist) * force
          localNodes[i].vy -= (dy / dist) * force
          localNodes[j].vx += (dx / dist) * force
          localNodes[j].vy += (dy / dist) * force
        }
      }
      // Attraction (edges)
      for (const edge of edges) {
        const a = localNodes.find(n => n.id === edge.source)
        const b = localNodes.find(n => n.id === edge.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const force = dist * 0.01 * edge.weight
        a.vx += (dx / dist) * force
        a.vy += (dy / dist) * force
        b.vx -= (dx / dist) * force
        b.vy -= (dy / dist) * force
      }
      // Apply velocity with damping
      for (const node of localNodes) {
        node.vx *= 0.8
        node.vy *= 0.8
        node.x = Math.max(20, Math.min(width-20, node.x + node.vx))
        node.y = Math.max(20, Math.min(height-20, node.y + node.vy))
      }
      iteration++
      setPositions(localNodes.map(n => ({ ...n })))
      if (iteration < maxIterations) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [nodes, edges, width, height])

  return positions
}
```

Render as SVG:
```tsx
<svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
  {/* Edges */}
  {edges.map((e, i) => {
    const a = positions.find(n => n.id === e.source)
    const b = positions.find(n => n.id === e.target)
    if (!a || !b) return null
    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="hsl(var(--void-cyan))" strokeOpacity={e.weight} strokeWidth={1 + e.weight * 2} />
  })}
  {/* Nodes */}
  {positions.map(node => (
    <g key={node.id}>
      <circle cx={node.x} cy={node.y} r={12} fill="hsl(var(--card))" stroke="hsl(var(--void-cyan))" strokeWidth={1.5} />
      <text x={node.x} y={node.y + 3} textAnchor="middle" fontSize={8} fill="hsl(var(--foreground))">{getInitials(node.name)}</text>
    </g>
  ))}
</svg>
```

---

## Task 7: Reduce Floor Tile DOM Nodes (Medium ROI, ~1 hour)

**Problem:** 384 individual `<div>` elements for purely decorative floor tiles. Each has a background-image.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — floor tile rendering (~lines 1896-1913)

**Implementation:**

Replace the 384 individual divs with a single div using CSS `background-repeat`:

```tsx
<div
  className="absolute inset-0 z-0"
  style={{
    backgroundImage: `url('/office-sprites/kenney/floorFull.png')`,
    backgroundSize: `${100/MAP_COLS}% ${100/MAP_ROWS}%`,
    backgroundRepeat: 'repeat',
    opacity: themePalette.floorOpacityA,
    filter: themePalette.floorFilter,
  }}
/>
```

Remove the `floorTiles` useMemo and the `.map()` that renders 384 divs. This eliminates 384 DOM nodes.

For the alternating opacity pattern (checkerboard), use a CSS pseudo-element or a second overlaid div with a checkerboard mask. Alternatively, the slight opacity alternation is barely visible and can be dropped entirely for the performance win.

---

## Task 8: Active vs Idle Agent Dimming (Low effort, ~30 min)

**Problem:** All agents render at equal visual weight regardless of status. Agents in meetings should be visually elevated.

**Files:**
- Modify: `src/components/panels/office-panel.tsx` — agent sprite container

**Implementation:**

In the agent sprite `<Button>` container, add conditional opacity:

```tsx
className={`absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 hover:scale-110 h-auto p-0 rounded-none hover:bg-transparent ${
  meetingAgentIds.has(agent.id) ? 'brightness-110' :
  agent.status === 'busy' ? '' :
  agent.status === 'idle' ? 'opacity-70 saturate-50' :
  'opacity-50'
}`}
```

Meeting agents: full brightness + slight glow. Busy agents: normal. Idle agents: 70% opacity + desaturated. Offline: 50% opacity.

---

## Task 9: Final Build and Deploy

**Step 1:** Run typecheck + tests
```bash
cd "/Users/oudaymneimneh/Mission Control" && pnpm typecheck && pnpm test
```

**Step 2:** Build
```bash
pnpm build
```

**Step 3:** Restart production server
```bash
launchctl stop com.mission-control && launchctl start com.mission-control
```

**Step 4:** Verify
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health
```

---

## Success Metrics

| Task | Metric | Target |
|---|---|---|
| Color threading | Same agent has consistent color across all UI elements | Visual verification |
| Dark speech bubbles | Bubbles match dark theme, smooth entry + exit | No white flash, 300ms fade |
| Panel transitions | Panel slides in/out smoothly | No layout jump |
| CSS movement | Zero rAF re-renders during agent movement | React DevTools profiler |
| Hover tooltips | Tooltip appears <100ms on hover, disappears on leave | No flicker |
| Trust graph | Nodes cluster by trust, edges visible | Force layout converges in <2s |
| Floor tiles | Single DOM node instead of 384 | DOM inspector |
| Agent dimming | Meeting agents visually elevated, idle dimmed | Visual verification |
| Full suite | Typecheck + tests | 0 errors, 1288+ pass |
