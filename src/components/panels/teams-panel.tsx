'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  id: number
  name: string
  role: string
  status: string
}

interface Team {
  id: number
  name: string
  description: string | null
  parent_id: number | null
  workspace_id: number
  created_at: number
  updated_at: number
  member_count: number
  members: TeamMember[]
}

interface Agent {
  id: number
  name: string
  role: string
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDotColor(status: string): string {
  switch (status) {
    case 'idle': return 'bg-green-400'
    case 'busy': return 'bg-amber-400'
    case 'offline': return 'bg-zinc-500'
    case 'error': return 'bg-red-400'
    default: return 'bg-zinc-500'
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function TeamsPanel() {
  const [teams, setTeams] = useState<Team[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set())

  // Create department form
  const [showCreateDept, setShowCreateDept] = useState(false)
  const [newDeptName, setNewDeptName] = useState('')
  const [creating, setCreating] = useState(false)

  // Create team form (per department)
  const [showCreateTeamFor, setShowCreateTeamFor] = useState<number | null>(null)
  const [newTeamName, setNewTeamName] = useState('')

  // Add agent picker (per team)
  const [showAgentPickerFor, setShowAgentPickerFor] = useState<number | null>(null)

  // ------ Data fetching ------

  const fetchData = useCallback(async () => {
    setError(null)
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        fetch('/api/teams?include=members'),
        fetch('/api/agents'),
      ])
      if (!teamsRes.ok) throw new Error('Failed to fetch teams')
      if (!agentsRes.ok) throw new Error('Failed to fetch agents')
      const teamsJson = await teamsRes.json()
      const agentsJson = await agentsRes.json()
      setTeams(teamsJson.teams ?? [])
      setAgents(agentsJson.agents ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ------ Derived data ------

  const departments = teams.filter(t => t.parent_id === null)
  const teamsByParent = new Map<number, Team[]>()
  for (const t of teams) {
    if (t.parent_id !== null) {
      const list = teamsByParent.get(t.parent_id) ?? []
      list.push(t)
      teamsByParent.set(t.parent_id, list)
    }
  }

  const assignedAgentIds = new Set<number>()
  for (const t of teams) {
    for (const m of t.members) {
      assignedAgentIds.add(m.id)
    }
  }
  const unassignedAgents = agents.filter(a => !assignedAgentIds.has(a.id))

  // ------ Helpers for unassigned agents per-team picker ------

  const availableAgentsForTeam = (teamId: number): Agent[] => {
    const teamMemberIds = new Set(
      (teams.find(t => t.id === teamId)?.members ?? []).map(m => m.id)
    )
    return agents.filter(a => !teamMemberIds.has(a.id))
  }

  // ------ Actions ------

  const toggleDept = (id: number) => {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const createDepartment = useCallback(async () => {
    if (!newDeptName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDeptName.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create department')
      }
      setNewDeptName('')
      setShowCreateDept(false)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department')
    } finally {
      setCreating(false)
    }
  }, [newDeptName, fetchData])

  const createTeam = useCallback(async (parentId: number) => {
    if (!newTeamName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim(), parent_id: parentId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create team')
      }
      setNewTeamName('')
      setShowCreateTeamFor(null)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setCreating(false)
    }
  }, [newTeamName, fetchData])

  const addAgentToTeam = useCallback(async (teamId: number, agentId: number) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to add agent')
      }
      setShowAgentPickerFor(null)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add agent')
    }
  }, [fetchData])

  const removeAgentFromTeam = useCallback(async (teamId: number, agentId: number) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to remove agent')
      }
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove agent')
    }
  }, [fetchData])

  // ------ Render ------

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Teams & Departments</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setLoading(true); fetchData() }}>
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setShowCreateDept(true); setShowCreateTeamFor(null) }}
          >
            + Department
          </Button>
        </div>
      </div>

      {/* Create department form */}
      {showCreateDept && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card">
          <input
            type="text"
            value={newDeptName}
            onChange={e => setNewDeptName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createDepartment(); if (e.key === 'Escape') setShowCreateDept(false) }}
            placeholder="Department name..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1"
            autoFocus
          />
          <Button variant="outline" size="sm" onClick={createDepartment} disabled={creating || !newDeptName.trim()}>
            {creating ? 'Creating...' : 'Create'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowCreateDept(false); setNewDeptName('') }}>
            Cancel
          </Button>
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
      {!loading && !error && departments.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="mb-2">No departments yet.</p>
          <p>Click <strong>+ Department</strong> to create your first one.</p>
        </div>
      )}

      {/* Departments list */}
      {!loading && departments.map(dept => {
        const childTeams = teamsByParent.get(dept.id) ?? []
        const isExpanded = expandedDepts.has(dept.id)
        const totalAgents = childTeams.reduce((sum, t) => sum + t.members.length, 0) + dept.members.length

        return (
          <div key={dept.id} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Department header */}
            <button
              onClick={() => toggleDept(dept.id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors duration-150"
            >
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs w-4 text-center">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <span className="font-medium text-foreground text-sm">{dept.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {totalAgents} agent{totalAgents !== 1 ? 's' : ''}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3">
                {/* Department's own members (direct) */}
                {dept.members.length > 0 && (
                  <div className="pl-6 space-y-1">
                    {dept.members.map(member => (
                      <div key={member.id} className="flex items-center justify-between py-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${statusDotColor(member.status)}`} />
                          <span className="text-sm text-foreground">{member.name}</span>
                          <span className="text-xs text-muted-foreground">({member.role})</span>
                        </div>
                        <button
                          onClick={() => removeAgentFromTeam(dept.id, member.id)}
                          className="text-muted-foreground hover:text-red-400 text-xs px-1 transition-colors duration-150"
                          title="Remove agent"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Child teams */}
                {childTeams.map(team => (
                  <div key={team.id} className="ml-4 rounded-md border border-border bg-surface-1 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{team.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {team.members.length} agent{team.members.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-6 px-2"
                        onClick={() => setShowAgentPickerFor(showAgentPickerFor === team.id ? null : team.id)}
                      >
                        + Agent
                      </Button>
                    </div>

                    {/* Agent picker dropdown */}
                    {showAgentPickerFor === team.id && (
                      <div className="rounded-md border border-border bg-card p-2 space-y-1 max-h-40 overflow-y-auto">
                        {availableAgentsForTeam(team.id).length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1 px-2">No available agents</p>
                        ) : (
                          availableAgentsForTeam(team.id).map(agent => (
                            <button
                              key={agent.id}
                              onClick={() => addAgentToTeam(team.id, agent.id)}
                              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary/50 transition-colors duration-150"
                            >
                              <span className={`w-2 h-2 rounded-full ${statusDotColor(agent.status)}`} />
                              <span className="text-sm text-foreground">{agent.name}</span>
                              <span className="text-xs text-muted-foreground">({agent.role})</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {/* Team members */}
                    {team.members.length > 0 && (
                      <div className="space-y-1">
                        {team.members.map(member => (
                          <div key={member.id} className="flex items-center justify-between py-1 pl-1">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${statusDotColor(member.status)}`} />
                              <span className="text-sm text-foreground">{member.name}</span>
                              <span className="text-xs text-muted-foreground">({member.role})</span>
                            </div>
                            <button
                              onClick={() => removeAgentFromTeam(team.id, member.id)}
                              className="text-muted-foreground hover:text-red-400 text-xs px-1 transition-colors duration-150"
                              title="Remove agent"
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Create team form */}
                {showCreateTeamFor === dept.id ? (
                  <div className="ml-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={e => setNewTeamName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createTeam(dept.id); if (e.key === 'Escape') { setShowCreateTeamFor(null); setNewTeamName('') } }}
                      placeholder="Team name..."
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1"
                      autoFocus
                    />
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => createTeam(dept.id)} disabled={creating || !newTeamName.trim()}>
                      {creating ? 'Creating...' : 'Create'}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setShowCreateTeamFor(null); setNewTeamName('') }}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setShowCreateTeamFor(dept.id); setShowCreateDept(false); setNewTeamName('') }}
                    className="ml-4 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
                  >
                    + Team
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Unassigned agents */}
      {!loading && unassignedAgents.length > 0 && (
        <div className="pt-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">Unassigned Agents</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="space-y-1 pl-2">
            {unassignedAgents.map(agent => (
              <div key={agent.id} className="flex items-center gap-2 py-1">
                <span className={`w-2 h-2 rounded-full ${statusDotColor(agent.status)}`} />
                <span className="text-sm text-foreground">{agent.name}</span>
                <span className="text-xs text-muted-foreground">({agent.role})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
