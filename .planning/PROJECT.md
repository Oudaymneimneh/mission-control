# Mission Control Agent Orchestration Platform

## Vision

Transform Mission Control from an AI agent monitoring dashboard into the definitive open-source platform for orchestrating AI agent teams — enabling complex multi-agent workflows with spatial visualization, structured deliberation, deep persona simulation, self-scaling, and human-in-the-loop oversight.

## Context

Mission Control v2.0 is a mature agent orchestration platform: 158+ API routes, 33 dashboard panels, 58+ migrations, 1191 unit + 760 E2E tests, RBAC auth, SSE real-time events, LLM router, agent framework integrations, autonomous meeting engine (ai-town-style), and a Zustand-powered UI. The v1 orchestration layer shipped 6 major capabilities (spatial viz, workflow engine, debate rooms, persona simulation, auto-scaling, @mention chat) on top of the v2.0.0 platform baseline. Deep validation + hardening pass completed with 11 fixes and 0 regressions.

## Current State

v2.1 shipped on 2026-03-17. All milestones complete. No active milestone.

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
- ✓ Meeting-driven task creation — v2.1
- ✓ Trust-weighted collaborator suggestions (5-factor UI) — v2.1
- ✓ Meeting scheduling (recurring intervals) — v2.1
- ✓ Meeting analytics dashboard (recharts) — v2.1
- ✓ Conversation quality scoring (LLM-evaluated) — v2.1
- ✓ Per-agent color threading (golden angle) — v2.1
- ✓ Dark speech bubbles with exit animation — v2.1
- ✓ Spring-animated panel transitions — v2.1
- ✓ CSS transition-based agent movement — v2.1
- ✓ Hover tooltips on canvas agents — v2.1
- ✓ Force-directed trust network graph (SVG, Verlet) — v2.1
- ✓ Floor tile DOM reduction (384 → 1) — v2.1
- ✓ Active/idle agent dimming — v2.1
- ✓ Meeting engine unit + integration + E2E test coverage — v2.1
- ✓ 1310 unit + 760 E2E tests, 0 failures — v2.1

### Active

None — no active milestone.

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
| CSS transitions over rAF | Eliminate JS-per-frame re-renders, browser handles interpolation | ✓ Validated |
| Force layout without D3 | Custom force sim avoids heavy dependency (~280 LOC) | ✓ Validated |
| PixiJS deferred | DOM/CSS approach first, PixiJS is future milestone | — Decided |

## Success Criteria (v2.1 — all met)

1. ✓ All 28 v2.1 requirements functional with tests
2. ✓ Zero increase in `any` type usage
3. ✓ No regression — 1310 unit + 760 E2E tests, 0 failures
4. ✓ Agent movement uses zero requestAnimationFrame calls
5. ✓ Office canvas floor: 1 CSS div replacing 384 tile divs
6. ✓ Meeting analytics shows per-agent stats with recharts
7. ✓ Quality scoring evaluates meetings via LLM (0.0-1.0)
8. ✓ Trust graph uses Verlet integration, stabilizes for 20 agents
9. ✓ Typecheck + lint + full test suite pass

---

*Last updated: 2026-03-17 — v2.1 shipped and archived*
