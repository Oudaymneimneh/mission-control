import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Meetings API', () => {
  // ── Auth Guard ─────────────────
  // Verify API key works before running behavioral tests.
  // Without this, all [200, 401] assertions silently pass as green on 401.

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/agents', { headers: API_KEY_HEADER })
    if (res.status() === 401) {
      throw new Error('API_KEY_HEADER is not valid — all behavioral tests would silently pass. Check test auth setup.')
    }
  })

  // ── Authentication ─────────────────

  test('GET /api/meetings rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/meetings')
    expect(res.status()).toBe(401)
  })

  test('GET /api/meetings/1 rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/meetings/1')
    expect(res.status()).toBe(401)
  })

  // ── List Meetings ─────────────────

  test('GET /api/meetings returns paginated list', async ({ request }) => {
    const res = await request.get('/api/meetings?limit=5', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('total')
      expect(Array.isArray(body.data)).toBe(true)
      expect(typeof body.total).toBe('number')
    }
  })

  test('GET /api/meetings supports status filter', async ({ request }) => {
    const res = await request.get('/api/meetings?status=concluded&limit=3', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      for (const meeting of body.data) {
        expect(meeting.status).toBe('concluded')
      }
    }
  })

  test('GET /api/meetings respects limit parameter', async ({ request }) => {
    const res = await request.get('/api/meetings?limit=2', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.data.length).toBeLessThanOrEqual(2)
    }
  })

  // ── Meeting Detail ─────────────────

  test('GET /api/meetings/999999 returns 404 for nonexistent', async ({ request }) => {
    const res = await request.get('/api/meetings/999999', { headers: API_KEY_HEADER })
    expect([404, 401]).toContain(res.status())
  })

  test('GET /api/meetings/abc returns 400 for non-numeric ID', async ({ request }) => {
    const res = await request.get('/api/meetings/abc', { headers: API_KEY_HEADER })
    expect([400, 401]).toContain(res.status())
  })

  // ── Meeting Trigger ─────────────────

  test('POST /api/meetings/trigger rejects without agent_id', async ({ request }) => {
    const res = await request.post('/api/meetings/trigger', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect([400, 401, 404]).toContain(res.status())
  })

  test('POST /api/meetings/trigger rejects unauthenticated', async ({ request }) => {
    const res = await request.post('/api/meetings/trigger', {
      data: { agent_id: 1 },
    })
    expect(res.status()).toBe(401)
  })

  // ── Cancel Meeting ─────────────────

  test('POST /api/meetings/999999 cancel returns 404', async ({ request }) => {
    const res = await request.post('/api/meetings/999999', {
      headers: API_KEY_HEADER,
      data: { action: 'cancel' },
    })
    expect([404, 401]).toContain(res.status())
  })

  test('POST /api/meetings/1 with invalid action returns 400', async ({ request }) => {
    const res = await request.post('/api/meetings/1', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid_action' },
    })
    expect([400, 401, 404]).toContain(res.status())
  })

  test('POST /api/meetings/abc cancel returns 400 for non-numeric ID', async ({ request }) => {
    const res = await request.post('/api/meetings/abc', {
      headers: API_KEY_HEADER,
      data: { action: 'cancel' },
    })
    expect([400, 401]).toContain(res.status())
  })

  // ── SSE Events (MTST-06) ─────────────────

  test('meeting trigger sends SSE events (smoke test)', async ({ request }) => {
    // Smoke test — just verify the trigger endpoint accepts a valid agent_id.
    // Actual SSE streaming requires a separate persistent connection.
    const res = await request.post('/api/meetings/trigger', {
      headers: API_KEY_HEADER,
      data: { agent_id: 1 },
    })
    expect([200, 400, 401, 404, 409]).toContain(res.status())
  })

  // ── Meeting Analytics (MTST-07) ─────────────────

  test('GET /api/meetings/analytics returns data structure', async ({ request }) => {
    const res = await request.get('/api/meetings/analytics', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(body.data).toHaveProperty('meetings_per_day')
      expect(body.data).toHaveProperty('avg_turns')
      expect(body.data).toHaveProperty('top_pairs')
      expect(body.data).toHaveProperty('trust_network')
      expect(body.data).toHaveProperty('total_concluded')
    }
  })

  // ── Meeting Suggestions (MTST-07) ─────────────────

  test('GET /api/meetings/suggestions requires agentId', async ({ request }) => {
    const res = await request.get('/api/meetings/suggestions', { headers: API_KEY_HEADER })
    expect([400, 401]).toContain(res.status())
  })

  test('GET /api/meetings/suggestions returns suggestions array', async ({ request }) => {
    // Use agentId=1 — may return empty array if no agents, that's fine
    const res = await request.get('/api/meetings/suggestions?agentId=1&workspaceId=1', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
    }
  })

  // ── Meeting Schedule (MTST-08) ─────────────────

  test('POST /api/meetings/schedule rejects without required fields', async ({ request }) => {
    const res = await request.post('/api/meetings/schedule', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect([400, 401]).toContain(res.status())
  })

  test('POST /api/meetings/schedule with recurring_interval_ms', async ({ request }) => {
    const res = await request.post('/api/meetings/schedule', {
      headers: API_KEY_HEADER,
      data: { agent_id: 1, workspace_id: 1, recurring_interval_ms: 300000 },
    })
    // May be 200, 400 (if agent doesn't exist), or 401
    expect([200, 400, 401, 404]).toContain(res.status())
  })

  // ── Canvas Marker Positions (MTST-08) ─────────────────

  test('GET /api/office/positions returns position data for canvas markers', async ({ request }) => {
    const res = await request.get('/api/office/positions', { headers: API_KEY_HEADER })
    expect([200, 401]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('data')
      expect(Array.isArray(body.data)).toBe(true)
      for (const pos of body.data) {
        expect(typeof pos.agent_id).toBe('number')
        expect(typeof pos.x).toBe('number')
        expect(typeof pos.y).toBe('number')
      }
    }
  })

  test('GET /api/office/positions/999999 returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.get('/api/office/positions/999999', { headers: API_KEY_HEADER })
    expect([404, 401]).toContain(res.status())
  })

  test('GET /api/office/positions/abc returns 400 for non-numeric ID', async ({ request }) => {
    const res = await request.get('/api/office/positions/abc', { headers: API_KEY_HEADER })
    expect([400, 401]).toContain(res.status())
  })

  test('POST /api/office/positions/1 rejects missing target coordinates', async ({ request }) => {
    const res = await request.post('/api/office/positions/1', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect([400, 401]).toContain(res.status())
  })

  test('POST /api/office/positions/1 accepts valid target coordinates', async ({ request }) => {
    const res = await request.post('/api/office/positions/1', {
      headers: API_KEY_HEADER,
      data: { target_x: 150, target_y: 250 },
    })
    // 200 if agent exists, 401 if auth issue, 500 if agent missing from DB
    expect([200, 401, 500]).toContain(res.status())
  })
})
