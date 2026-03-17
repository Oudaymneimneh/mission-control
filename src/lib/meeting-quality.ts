import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'

export interface QualityScore {
  coherence: number
  actionability: number
  role_adherence: number
}

const NEUTRAL_SCORE: QualityScore = { coherence: 3, actionability: 3, role_adherence: 3 }
const QUALITY_TIMEOUT_MS = 5_000

function clampScore(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(5, Math.round(n)))
}

export async function evaluateMeetingQuality(
  transcript: string,
  summary: string,
  agentId: number,
  workspaceId: number,
): Promise<QualityScore> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        {
          role: 'system',
          content: 'Rate this meeting transcript on 3 dimensions (1-5 each). Return JSON only: {"coherence": N, "actionability": N, "role_adherence": N}. coherence=logical flow, actionability=concrete outcomes discussed, role_adherence=agents stayed in character.',
        },
        { role: 'user', content: `Summary: ${summary}\n\nTranscript:\n${transcript.slice(0, 1500)}` },
      ],
      { agentId, workspaceId, taskType: 'evaluation' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('quality_eval_timeout')), QUALITY_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    const text = response.text.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(text)

    return {
      coherence: clampScore(parsed.coherence),
      actionability: clampScore(parsed.actionability),
      role_adherence: clampScore(parsed.role_adherence),
    }
  } catch (err) {
    logger.warn({ err }, 'Meeting quality evaluation failed, using neutral scores')
    return NEUTRAL_SCORE
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
