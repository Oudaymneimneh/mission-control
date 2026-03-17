# Mission Control Agent Orchestration Platform

## Vision

Transform Mission Control from an AI agent monitoring dashboard into the definitive open-source platform for orchestrating AI agent teams — enabling complex multi-agent workflows with spatial visualization, structured deliberation, deep persona simulation, self-scaling, and human-in-the-loop oversight.

## Context

Mission Control v2.0 is a mature agent orchestration platform: 158+ API routes, 33 dashboard panels, 58+ migrations, 1191 unit + 760 E2E tests, RBAC auth, SSE real-time events, LLM router, agent framework integrations, autonomous meeting engine (ai-town-style), and a Zustand-powered UI. The v1 orchestration layer shipped 6 major capabilities (spatial viz, workflow engine, debate rooms, persona simulation, auto-scaling, @mention chat) on top of the v2.0.0 platform baseline. Deep validation + hardening pass completed with 11 fixes and 0 regressions.

## Current Milestone: v2.1 Meeting Engine Polish

**Goal:** Complete the meeting system with production features, polish the office canvas visual quality, and achieve comprehensive meeting test coverage.

**Target features:**

### Track 1: Meeting Engine Completion
- [ ] Meeting-driven task creation (meetings → actionable tasks in task board)
- [ ] Trust-weighted collaborator suggestions (5-factor partner selection surfaced in UI)
- [ ] Meeting scheduling (time-based meeting triggers, not just random initiation)
- [ ] Meeting analytics dashboard (recharts visualizations of meeting patterns)
- [ ] Conversation quality scoring (LLM-evaluated meeting output quality)

### Track 2: Visual Quality
- [ ] Per-agent color threading (consistent color across desk, bubble, name, marker)
- [ ] Dark-themed speech bubbles with exit animations
- [ ] Spring-animated meeting panel transitions
- [ ] CSS transition-based agent movement (replace rAF re-renders)
- [ ] Hover tooltips on canvas agents (layered disclosure)
- [ ] Force-directed trust network graph (SVG, no D3)
- [ ] Reduce floor tile DOM nodes (384 → 1 via CSS repeat)
- [ ] Active vs idle agent dimming

### Track 3: Meeting System Testing
- [ ] Engine correctness unit tests (state machine, trust, partner selection)
- [ ] Integration tests with recorded LLM responses (conversation flow + quality eval)
- [ ] E2E visual tests (SSE delivery, panel rendering, canvas markers)

## Requirements

### Validated

- ✓ Agent CRUD + lifecycle management — existing
- ✓ Task board with status tracking — existing
- ✓ Real-time SSE events — existing
- ✓ Tiered LLM router with budget enforcement — existing
- ✓ RBAC authentication — existing
- ✓ Agent framework adapters (AutoGen, CrewAI, LangGraph, Claude SDK, OpenClaw) — existing
- ✓ Webhook system with HMAC signatures and retry — existing
- ✓ Cron scheduler — existing
- ✓ Quality review system — existing
- ✓ Notification and alert system — existing
- ✓ Hermes chat/messaging system — existing
- ✓ Multi-tenant workspace isolation — existing
- ✓ Skill registry with security scanning — existing
- ✓ Audit logging — existing
- ✓ CSP nonces, security headers, timing-safe auth — existing
- ✓ Spatial 2D Visualization (@xyflow/react canvas, dagre layout, SSE updates) — v1
- ✓ Structured Workflow Engine (SOP phases, artifact validation, approval gates) — v1
- ✓ Debate/Consensus Rooms (structured rounds, voting, token budgets) — v1
- ✓ Deep Persona Simulation (Big Five, PAD, cognitive biases, pairwise trust) — v1
- ✓ Auto-Hiring/Self-Scaling (lazy eval, cooldown, template spawning, global caps) — v1
- ✓ @Mention Team Chat (mention routing, @all, @team:name, loop prevention) — v1
- ✓ Autonomous Meeting Engine (ai-town-style, 5-factor partner selection, LLM conversations, trust updates, SSE office viz) — v2.0
- ✓ 1191 unit + 760 E2E tests, CI quality gate — v2.0

### Active

- [ ] Meeting-driven task creation — meetings generate actionable tasks
- [ ] Trust-weighted collaborator suggestions — surface partner selection in UI
- [ ] Meeting scheduling — time-based triggers beyond random initiation
- [ ] Meeting analytics dashboard — recharts visualizations of meeting patterns
- [ ] Conversation quality scoring — LLM-evaluated meeting output
- [ ] Per-agent color threading — consistent color identity across UI elements
- [ ] Dark speech bubbles with exit animation — match dark theme, smooth transitions
- [ ] Spring-animated panel transitions — Linear-style panel physics
- [ ] CSS transition-based movement — eliminate rAF re-renders for agent movement
- [ ] Hover tooltips on canvas agents — lightweight layered disclosure
- [ ] Force-directed trust graph — SVG trust network visualization
- [ ] Floor tile DOM reduction — single CSS repeat replacing 384 divs
- [ ] Active/idle agent dimming — visual weight by agent status
- [ ] Meeting engine unit test coverage — property-based invariants
- [ ] Meeting integration tests — recorded LLM response verification
- [ ] Meeting E2E visual tests — SSE + panel + canvas verification

### Out of Scope

- Mobile app — Dashboard is desktop-first (responsive later)
- Multi-node clustering — Single-server SQLite deployment
- Billing/payment integration — Open-source, no monetization
- Custom LLM fine-tuning — Use existing provider APIs as-is
- Video/audio channels — Text-based communication only
- Convex or external real-time DB — Stay with SQLite + SSE
- PixiJS migration — Deferred to separate milestone (visual quality uses DOM/CSS approach)

## Technical Constraints

- **Database:** SQLite (better-sqlite3) — all new tables via migration system
- **State:** Zustand 5 for client state, SSE for real-time sync
- **Styling:** Tailwind CSS 3 with existing CSS variable theme system
- **Testing:** Vitest for unit, Playwright for E2E, 60% coverage threshold
- **No icon libraries:** Raw text/emoji per CLAUDE.md convention
- **No `Co-Authored-By`:** Per CLAUDE.md commit convention
- **Package manager:** pnpm only
- **Node.js:** >= 22
- **Build:** Standalone output for deployment
- **Charts:** recharts (already in project)
- **Animations:** CSS transitions + Tailwind animate-in (no new animation libraries)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use @xyflow/react for spatial viz | Already in deps, mature React Flow library | ✓ Good |
| Extend Hermes for @mention chat | Existing chat system has messages + channels | ✓ Good |
| SQLite for all new tables | Consistency with existing data layer | ✓ Good |
| Store personas as JSON columns | Flexible schema for Big Five + emotional state | ✓ Good |
| Workflow engine in src/lib/ | Business logic layer, not UI or API | ✓ Good |
| Auto-scaling via event bus | Existing SSE + event bus for hire events | ✓ Good |
| Phase-based migration approach | Each feature gets numbered migration(s) | ✓ Good |
| CSS transitions over rAF | Eliminate JS-per-frame re-renders, browser handles interpolation | — Pending |
| Force layout without D3 | Custom force sim avoids heavy dependency | — Pending |
| PixiJS deferred | DOM/CSS approach first, PixiJS is future milestone | — Decided |

## Success Criteria

1. All 16 active requirements functional with tests
2. Zero increase in `any` type usage
3. No regression in existing 1191 unit + 760 E2E tests
4. Agent movement uses zero requestAnimationFrame calls
5. Office canvas renders with <400 DOM nodes (down from 384 tiles alone)
6. Meeting analytics shows trends across time with recharts
7. Quality scoring evaluates meeting conversations via LLM
8. Trust graph converges in <2 seconds for 20 agents
9. Typecheck + full test suite passes after each track

---

*Last updated: 2026-03-17 after milestone v2.1 initialization*
