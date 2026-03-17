import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'

interface MeetingActionInput {
  transcript: string
  summary: string
  participants: Array<{ id: number; name: string }>
  workspaceId: number
}

interface ExtractedAction {
  title: string
  description: string
  assignee_name: string
  assignee_id: number | null
}

const EXTRACTION_TIMEOUT_MS = 8_000
const MAX_ACTIONS = 3

export async function extractMeetingActions(input: MeetingActionInput): Promise<ExtractedAction[]> {
  const { transcript, summary, participants, workspaceId } = input
  const participantNames = participants.map(p => p.name).join(', ')

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        {
          role: 'system',
          content: `You extract action items from meeting transcripts. Return a JSON array of 0-3 items. Each item: {"title": "short title", "description": "one sentence", "assignee": "exact participant name"}. Participants: ${participantNames}. Return [] if no concrete actions were discussed. Only include specific, actionable commitments.`,
        },
        {
          role: 'user',
          content: `Meeting summary: ${summary}\n\nTranscript:\n${transcript.slice(0, 2000)}`,
        },
      ],
      { agentId: participants[0]?.id ?? 0, workspaceId, taskType: 'extraction' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('action_extraction_timeout')), EXTRACTION_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    const text = response.text.trim()
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '')
    const raw = JSON.parse(jsonStr)

    if (!Array.isArray(raw)) return []

    return raw.slice(0, MAX_ACTIONS).map((item: any) => {
      const assigneeName = String(item.assignee || '').trim()
      const matched = participants.find(p => p.name.toLowerCase() === assigneeName.toLowerCase())
      return {
        title: String(item.title || '').slice(0, 200),
        description: String(item.description || '').slice(0, 500),
        assignee_name: matched?.name ?? assigneeName,
        assignee_id: matched?.id ?? null,
      }
    }).filter((a: ExtractedAction) => a.title.length > 0)
  } catch (err) {
    logger.warn({ err }, 'Meeting action extraction failed')
    return []
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
