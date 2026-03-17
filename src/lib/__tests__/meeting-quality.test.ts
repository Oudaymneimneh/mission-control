import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn(),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true }),
}))

import { evaluateMeetingQuality } from '@/lib/meeting-quality'
import { complete } from '@/lib/llm/router'

describe('evaluateMeetingQuality', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns parsed quality scores from LLM', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify({ coherence: 4, actionability: 3, role_adherence: 5 }),
      tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 400, model: 'test',
    })
    const result = await evaluateMeetingQuality('Atlas: Hi\nNova: Hello', 'Greeting', 1, 1)
    expect(result.coherence).toBe(4)
    expect(result.actionability).toBe(3)
    expect(result.role_adherence).toBe(5)
  })

  it('returns neutral scores on LLM failure', async () => {
    vi.mocked(complete).mockRejectedValueOnce(new Error('timeout'))
    const result = await evaluateMeetingQuality('Atlas: Hi', 'Chat', 1, 1)
    expect(result).toEqual({ coherence: 3, actionability: 3, role_adherence: 3 })
  })

  it('clamps scores to 1-5 range', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: JSON.stringify({ coherence: 0, actionability: 7, role_adherence: -1 }),
      tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 400, model: 'test',
    })
    const result = await evaluateMeetingQuality('Atlas: Hi', 'Chat', 1, 1)
    expect(result.coherence).toBe(1)
    expect(result.actionability).toBe(5)
    expect(result.role_adherence).toBe(1)
  })

  it('handles malformed JSON gracefully', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: 'not json', tokenCount: { input: 100, output: 10 }, cost: 0.001, latencyMs: 200, model: 'test',
    })
    const result = await evaluateMeetingQuality('Test', 'Test', 1, 1)
    expect(result).toEqual({ coherence: 3, actionability: 3, role_adherence: 3 })
  })

  it('handles markdown-wrapped JSON', async () => {
    vi.mocked(complete).mockResolvedValueOnce({
      text: '```json\n{"coherence": 5, "actionability": 4, "role_adherence": 3}\n```',
      tokenCount: { input: 150, output: 30 }, cost: 0.001, latencyMs: 400, model: 'test',
    })
    const result = await evaluateMeetingQuality('Test', 'Test', 1, 1)
    expect(result.coherence).toBe(5)
    expect(result.actionability).toBe(4)
    expect(result.role_adherence).toBe(3)
  })
})
