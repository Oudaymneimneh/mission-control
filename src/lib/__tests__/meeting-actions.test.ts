import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn(),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))

import { extractMeetingActions } from '@/lib/meeting-actions'
import { complete } from '@/lib/llm/router'

const participants = [{ id: 1, name: 'Atlas' }, { id: 2, name: 'Nova' }]

describe('extractMeetingActions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('extracts actions from transcript', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify([
        { title: 'Update deployment config', description: 'Switch staging to blue-green', assignee: 'Atlas' },
        { title: 'Review metrics dashboard', description: 'Check error rate trends', assignee: 'Nova' },
      ]),
      tokenCount: { input: 200, output: 100 }, cost: 0.002, latencyMs: 800, model: 'test',
    })

    const result = await extractMeetingActions({
      transcript: 'Atlas: Let me update the deployment config.\nNova: I will review the metrics.',
      summary: 'Discussed deployment pipeline improvements.',
      participants, workspaceId: 1,
    })

    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('Update deployment config')
    expect(result[0].assignee_name).toBe('Atlas')
    expect(result[0].assignee_id).toBe(1)
    expect(result[1].assignee_name).toBe('Nova')
  })

  it('returns empty array when LLM returns no actions', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: '[]', tokenCount: { input: 100, output: 5 }, cost: 0.001, latencyMs: 300, model: 'test',
    })
    const result = await extractMeetingActions({ transcript: 'Casual chat.', summary: 'Chat.', participants, workspaceId: 1 })
    expect(result).toHaveLength(0)
  })

  it('returns empty array on LLM timeout', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('timeout'))
    const result = await extractMeetingActions({ transcript: 'Bug fix.', summary: 'Bug.', participants, workspaceId: 1 })
    expect(result).toHaveLength(0)
  })

  it('caps actions at 3 maximum', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify([
        { title: 'A1', description: 'd1', assignee: 'Atlas' },
        { title: 'A2', description: 'd2', assignee: 'Nova' },
        { title: 'A3', description: 'd3', assignee: 'Atlas' },
        { title: 'A4', description: 'd4', assignee: 'Nova' },
      ]),
      tokenCount: { input: 200, output: 150 }, cost: 0.003, latencyMs: 900, model: 'test',
    })
    const result = await extractMeetingActions({ transcript: 'Many items.', summary: 'Lots.', participants, workspaceId: 1 })
    expect(result).toHaveLength(3)
  })

  it('handles malformed LLM JSON gracefully', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: 'not json at all', tokenCount: { input: 100, output: 10 }, cost: 0.001, latencyMs: 200, model: 'test',
    })
    const result = await extractMeetingActions({ transcript: 'Test.', summary: 'Test.', participants, workspaceId: 1 })
    expect(result).toHaveLength(0)
  })
})
