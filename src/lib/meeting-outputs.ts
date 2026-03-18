import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { complete } from '@/lib/llm/router'

type MeetingMessage = { agent_name: string; content: string; turn_number: number }
type ActionItem = { title: string; description: string; assignee_name: string }
type Decision = { title: string; description: string }
type Artifact = { title: string; content: string; type: string }

type MeetingOutputs = {
  action_items: ActionItem[]
  decisions: Decision[]
  artifacts: Artifact[]
}

const EXTRACTION_TIMEOUT_MS = 8_000

export async function extractMeetingOutputs(
  messages: MeetingMessage[],
  topic: string | null,
  meetingId: number,
  projectId: number | null,
  workspaceId: number,
): Promise<MeetingOutputs> {
  const empty: MeetingOutputs = { action_items: [], decisions: [], artifacts: [] }
  if (messages.length < 2) return empty

  const transcript = messages.map(m => `${m.agent_name}: ${m.content}`).join('\n')

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const llmPromise = complete(
      [
        {
          role: 'system',
          content: 'You extract structured information from meeting transcripts. Return valid JSON only.',
        },
        {
          role: 'user',
          content: `Given this meeting transcript${topic ? ` about "${topic}"` : ''}:\n\n${transcript}\n\nExtract:\n1. action_items: 0-3 concrete tasks with {title, description, assignee_name}\n2. decisions: 0-2 key decisions made with {title, description}\n3. artifacts: 0-1 documents/specs/code proposed with {title, content, type}\n\ntype must be one of: document, spec, code, brief\n\nReturn JSON: { "action_items": [...], "decisions": [...], "artifacts": [...] }\nIf none found for a category, return empty array.`,
        },
      ],
      { agentId: 0, workspaceId, taskType: 'extraction' }
    )

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('output_extraction_timeout')), EXTRACTION_TIMEOUT_MS)
    })

    const response = await Promise.race([llmPromise, timeoutPromise])
    const text = response.text.trim()
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '')
    const parsed: MeetingOutputs = JSON.parse(jsonStr)

    if (!Array.isArray(parsed.action_items)) parsed.action_items = []
    if (!Array.isArray(parsed.decisions)) parsed.decisions = []
    if (!Array.isArray(parsed.artifacts)) parsed.artifacts = []
    parsed.action_items = parsed.action_items.slice(0, 3)
    parsed.decisions = parsed.decisions.slice(0, 2)
    parsed.artifacts = parsed.artifacts.slice(0, 1)

    // Save decisions + artifacts to DB if project_id exists
    if (projectId) {
      const db = getDatabase()
      for (const d of parsed.decisions) {
        try {
          db.prepare('INSERT INTO project_decisions (project_id, meeting_id, title, description, decided_by, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run(projectId, meetingId, d.title, d.description, '[]', 'active')
        } catch (err) {
          logger.warn({ err, meetingId }, 'Failed to save decision')
        }
      }
      for (const a of parsed.artifacts) {
        try {
          db.prepare('INSERT INTO project_artifacts (project_id, meeting_id, title, content, artifact_type) VALUES (?, ?, ?, ?, ?)')
            .run(projectId, meetingId, a.title, a.content, a.type || 'document')
        } catch (err) {
          logger.warn({ err, meetingId }, 'Failed to save artifact')
        }
      }
    }

    return parsed
  } catch (err) {
    logger.warn({ err, meetingId }, 'Failed to extract meeting outputs')
    return empty
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
