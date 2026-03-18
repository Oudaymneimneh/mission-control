'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: number
  name: string
  slug: string
  description: string | null
  ticket_prefix: string
  ticket_counter: number
  status: string
  color: string | null
  team_id: number | null
  team_name: string | null
  task_count: number
  meeting_count: number
  decision_count: number
  created_at: number
  updated_at: number
}

interface Team {
  id: number
  name: string
}

interface ActivityItem {
  type: string
  id: number
  title: string
  detail: string | null
  timestamp: number
  extra1: string | null
  extra2: string | null
  extra3: string | null
}

interface Decision {
  id: number
  project_id: number
  meeting_id: number | null
  title: string
  description: string
  decided_by: string
  status: string
  meeting_topic: string | null
  created_at: number
}

interface Artifact {
  id: number
  project_id: number
  title: string
  content: string
  artifact_type: string
  created_by_name: string | null
  created_at: number
}

interface Meeting {
  id: number
  topic: string | null
  status: string
  current_turn: number
  max_turns: number
  summary: string | null
  initiator_name: string
  participant_name: string
  project_id: number | null
  created_at: number
}

interface Task {
  id: number
  title: string
  status: string
  priority: string | null
  ticket_ref: string | null
  created_at: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(unix: number): string {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function activityBorderColor(type: string): string {
  switch (type) {
    case 'meeting': return 'border-l-foreground/30'
    case 'decision': return 'border-l-green-500'
    case 'artifact': return 'border-l-blue-500'
    case 'task': return 'border-l-amber-500'
    default: return 'border-l-border'
  }
}

function activityBadgeColor(type: string): string {
  switch (type) {
    case 'meeting': return 'bg-foreground/10 text-foreground'
    case 'decision': return 'bg-green-500/15 text-green-400'
    case 'artifact': return 'bg-blue-500/15 text-blue-400'
    case 'task': return 'bg-amber-500/15 text-amber-400'
    default: return 'bg-secondary text-muted-foreground'
  }
}

function decisionStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'bg-green-500/15 text-green-400'
    case 'superseded': return 'bg-amber-500/15 text-amber-400'
    case 'reversed': return 'bg-red-500/15 text-red-400'
    default: return 'bg-secondary text-muted-foreground'
  }
}

function taskPriorityBorder(priority: string | null): string {
  switch (priority) {
    case 'critical': return 'border-l-red-500'
    case 'high': return 'border-l-amber-500'
    case 'medium': return 'border-l-blue-500'
    case 'low': return 'border-l-green-500'
    default: return 'border-l-border'
  }
}

function taskStatusBadge(status: string): string {
  switch (status) {
    case 'done': case 'completed': return 'bg-green-500/15 text-green-400'
    case 'in_progress': case 'active': return 'bg-blue-500/15 text-blue-400'
    case 'blocked': return 'bg-red-500/15 text-red-400'
    default: return 'bg-secondary text-muted-foreground'
  }
}

// ---------------------------------------------------------------------------
// Tab: Activity
// ---------------------------------------------------------------------------

function ActivityTab({ projectId }: { projectId: number }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchActivity = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/activity?page=${p}`)
      if (!res.ok) throw new Error('Failed to fetch activity')
      const json = await res.json()
      setItems(json.activity ?? [])
      setTotalPages(json.totalPages ?? 1)
      setPage(json.page ?? p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchActivity(1) }, [fetchActivity])

  if (loading) return <div className="flex justify-center py-8"><Loader /></div>
  if (error) return <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
  if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={`${item.type}-${item.id}`} className={`border-l-2 ${activityBorderColor(item.type)} pl-3 py-2`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${activityBadgeColor(item.type)}`}>
              {item.type}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{item.title}</span>
            <span className="text-2xs text-muted-foreground ml-auto shrink-0">{formatTs(item.timestamp)}</span>
          </div>
          {item.detail && (
            <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
          )}
        </div>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => fetchActivity(page - 1)}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => fetchActivity(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Decisions
// ---------------------------------------------------------------------------

function DecisionsTab({ projectId }: { projectId: number }) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDecisions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/decisions`)
      if (!res.ok) throw new Error('Failed to fetch decisions')
      const json = await res.json()
      setDecisions(json.decisions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decisions')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchDecisions() }, [fetchDecisions])

  if (loading) return <div className="flex justify-center py-8"><Loader /></div>
  if (error) return <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
  if (decisions.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No decisions recorded.</p>

  return (
    <div className="space-y-2">
      {decisions.map(d => (
        <div key={d.id} className="p-3 rounded-lg border border-border bg-surface-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${decisionStatusColor(d.status)}`}>
              {d.status}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{d.title}</span>
            <span className="text-2xs text-muted-foreground ml-auto shrink-0">{formatTs(d.created_at)}</span>
          </div>
          {d.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>
          )}
          {d.meeting_topic && (
            <p className="text-2xs text-muted-foreground mt-1">From meeting: {d.meeting_topic}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Artifacts
// ---------------------------------------------------------------------------

function ArtifactsTab({ projectId }: { projectId: number }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const fetchArtifacts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/artifacts`)
      if (!res.ok) throw new Error('Failed to fetch artifacts')
      const json = await res.json()
      setArtifacts(json.artifacts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artifacts')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchArtifacts() }, [fetchArtifacts])

  if (loading) return <div className="flex justify-center py-8"><Loader /></div>
  if (error) return <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
  if (artifacts.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No artifacts yet.</p>

  return (
    <div className="space-y-2">
      {artifacts.map(a => (
        <div key={a.id} className="rounded-lg border border-border bg-surface-1 overflow-hidden">
          <button
            onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
            className="w-full text-left flex items-center gap-2 px-3 py-2.5 hover:bg-secondary/50 transition-colors duration-150"
          >
            <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400">
              {a.artifact_type}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{a.title}</span>
            {a.created_by_name && (
              <span className="text-2xs text-muted-foreground ml-auto shrink-0">by {a.created_by_name}</span>
            )}
            <span className="text-muted-foreground text-xs w-4 text-center shrink-0">
              {expandedId === a.id ? '\u25B2' : '\u25BC'}
            </span>
          </button>
          {expandedId === a.id && (
            <div className="px-3 pb-3">
              <pre className="text-xs text-muted-foreground bg-card p-3 rounded border border-border overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {a.content}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Meetings
// ---------------------------------------------------------------------------

function MeetingsTab({ projectId }: { projectId: number }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMeetings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/meetings?project_id=${projectId}&limit=100`)
      if (!res.ok) throw new Error('Failed to fetch meetings')
      const json = await res.json()
      setMeetings(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchMeetings() }, [fetchMeetings])

  if (loading) return <div className="flex justify-center py-8"><Loader /></div>
  if (error) return <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
  if (meetings.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No meetings yet.</p>

  return (
    <div className="space-y-2">
      {meetings.map(m => (
        <div key={m.id} className="p-3 rounded-lg border border-border bg-surface-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${m.status === 'concluded' ? 'bg-green-500/15 text-green-400' : m.status === 'active' ? 'bg-blue-500/15 text-blue-400' : 'bg-secondary text-muted-foreground'}`}>
              {m.status}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{m.topic || 'Untitled Meeting'}</span>
            <span className="text-2xs text-muted-foreground ml-auto shrink-0">{formatTs(m.created_at)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {m.initiator_name} & {m.participant_name} — Turn {m.current_turn}/{m.max_turns}
          </p>
          {m.summary && m.status === 'concluded' && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.summary}</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Tasks
// ---------------------------------------------------------------------------

function TasksTab({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const json = await res.json()
      setTasks(json.tasks ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  if (loading) return <div className="flex justify-center py-8"><Loader /></div>
  if (error) return <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No tasks yet.</p>

  return (
    <div className="space-y-2">
      {tasks.map(t => (
        <div key={t.id} className={`border-l-2 ${taskPriorityBorder(t.priority)} p-3 rounded-lg border border-border bg-surface-1`}>
          <div className="flex items-center gap-2">
            <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${taskStatusBadge(t.status)}`}>
              {t.status}
            </span>
            <span className="text-sm text-foreground font-medium truncate">{t.title}</span>
            {t.ticket_ref && (
              <span className="text-2xs text-muted-foreground font-mono">{t.ticket_ref}</span>
            )}
            <span className="text-2xs text-muted-foreground ml-auto shrink-0">{formatTs(t.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

type TabId = 'activity' | 'meetings' | 'decisions' | 'artifacts' | 'tasks'

const TABS: { id: TabId; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'tasks', label: 'Tasks' },
]

export function ProjectsPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Detail view
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('activity')

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPrefix, setFormPrefix] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTeamId, setFormTeamId] = useState<number | ''>('')
  const [creating, setCreating] = useState(false)

  // ------ Data fetching ------

  const fetchProjects = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')
      const json = await res.json()
      setProjects(json.projects ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/teams')
      if (!res.ok) return
      const json = await res.json()
      setTeams(json.teams ?? [])
    } catch {
      // Non-critical — team dropdown won't populate
    }
  }, [])

  useEffect(() => {
    fetchProjects()
    fetchTeams()
  }, [fetchProjects, fetchTeams])

  // ------ Actions ------

  const createProject = useCallback(async () => {
    if (!formName.trim() || !formPrefix.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          ticket_prefix: formPrefix.trim(),
          description: formDesc.trim() || undefined,
          team_id: formTeamId || undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create project')
      }
      setFormName('')
      setFormPrefix('')
      setFormDesc('')
      setFormTeamId('')
      setShowCreate(false)
      await fetchProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }, [formName, formPrefix, formDesc, formTeamId, fetchProjects])

  const openDetail = useCallback((project: Project) => {
    setSelectedProject(project)
    setActiveTab('activity')
  }, [])

  const goBack = useCallback(() => {
    setSelectedProject(null)
    setActiveTab('activity')
  }, [])

  // ------ Detail View ------

  if (selectedProject) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
            <span className="text-sm">&larr;</span> Back
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            {selectedProject.color && (
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedProject.color }} />
            )}
            <h1 className="text-lg font-semibold text-foreground truncate">{selectedProject.name}</h1>
            {selectedProject.team_name && (
              <span className="text-xs text-muted-foreground shrink-0">({selectedProject.team_name})</span>
            )}
          </div>
        </div>

        {selectedProject.description && (
          <p className="text-sm text-muted-foreground">{selectedProject.description}</p>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-foreground border-foreground'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-foreground/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'activity' && <ActivityTab projectId={selectedProject.id} />}
          {activeTab === 'meetings' && <MeetingsTab projectId={selectedProject.id} />}
          {activeTab === 'decisions' && <DecisionsTab projectId={selectedProject.id} />}
          {activeTab === 'artifacts' && <ArtifactsTab projectId={selectedProject.id} />}
          {activeTab === 'tasks' && <TasksTab projectId={selectedProject.id} />}
        </div>
      </div>
    )
  }

  // ------ List View ------

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Projects</h1>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(!showCreate)}>
          + New Project
        </Button>
      </div>

      {/* Create project form */}
      {showCreate && (
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="Project name *"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1"
              autoFocus
            />
            <input
              type="text"
              value={formPrefix}
              onChange={e => setFormPrefix(e.target.value)}
              placeholder="Prefix (e.g. PROJ) *"
              className="w-36 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1 font-mono"
            />
          </div>
          <input
            type="text"
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1"
          />
          <div className="flex items-center gap-2">
            {teams.length > 0 && (
              <select
                value={formTeamId}
                onChange={e => setFormTeamId(e.target.value ? Number(e.target.value) : '')}
                className="bg-transparent text-sm text-foreground border border-border rounded px-2 py-1"
              >
                <option value="">No team</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={createProject}
              disabled={creating || !formName.trim() || !formPrefix.trim()}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setFormName(''); setFormPrefix(''); setFormDesc(''); setFormTeamId('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <Loader />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && projects.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="mb-2">No projects yet.</p>
          <p>Click <strong>+ New Project</strong> to create your first one.</p>
        </div>
      )}

      {/* Project cards */}
      {!loading && projects.map(project => (
        <button
          key={project.id}
          onClick={() => openDetail(project)}
          className="w-full text-left p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors duration-150"
        >
          <div className="flex items-center gap-2 mb-1">
            {project.color && (
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
            )}
            <span className="text-sm font-medium text-foreground truncate">{project.name}</span>
            {project.team_name && (
              <span className="text-xs text-muted-foreground shrink-0">{project.team_name}</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{project.task_count} task{project.task_count !== 1 ? 's' : ''}</span>
            <span>{project.meeting_count} meeting{project.meeting_count !== 1 ? 's' : ''}</span>
            <span>{project.decision_count} decision{project.decision_count !== 1 ? 's' : ''}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
