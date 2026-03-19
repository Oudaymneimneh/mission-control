import type Database from 'better-sqlite3'
import { registerMigrations } from './migrations'

/**
 * Phase 0-5 migrations. All IDs use a `phase_` prefix to avoid collision
 * with upstream migration IDs. Every DDL statement uses IF NOT EXISTS /
 * PRAGMA guards so they are safe to run on databases that already have
 * the schemas from the old branch.
 */
registerMigrations([
  {
    id: 'phase_028_claude_intelligence',
    up: (db: Database.Database) => {
      const sessionCols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      const has = (name: string) => sessionCols.some((c) => c.name === name)

      if (!has('total_loc_delta')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN total_loc_delta INTEGER NOT NULL DEFAULT 0`)
      if (!has('tool_success_count')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN tool_success_count INTEGER NOT NULL DEFAULT 0`)
      if (!has('tool_error_count')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN tool_error_count INTEGER NOT NULL DEFAULT 0`)

      db.exec(`
        CREATE TABLE IF NOT EXISTS git_health (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_slug TEXT NOT NULL,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          branch TEXT,
          commit_hash TEXT,
          is_dirty INTEGER NOT NULL DEFAULT 0,
          ahead_by INTEGER NOT NULL DEFAULT 0,
          behind_by INTEGER NOT NULL DEFAULT 0,
          untracked_count INTEGER NOT NULL DEFAULT 0,
          staged_count INTEGER NOT NULL DEFAULT 0,
          last_commit_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(project_slug, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_git_health_project ON git_health(project_slug);
        CREATE INDEX IF NOT EXISTS idx_git_health_workspace ON git_health(workspace_id);
      `)
    }
  },
  {
    id: 'phase_029_intelligence_insights',
    up: (db: Database.Database) => {
      const sessionCols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      const has = (name: string) => sessionCols.some((c) => c.name === name)

      if (!has('loc_by_language')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN loc_by_language TEXT`)
      if (!has('error_density')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN error_density REAL NOT NULL DEFAULT 0`)
      if (!has('stability_score')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN stability_score REAL NOT NULL DEFAULT 0`)
    }
  },
  {
    id: 'phase_030_aegis_alerting',
    up: (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      const has = (name: string) => cols.some((c) => c.name === name)

      if (!has('alert_status')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN alert_status TEXT NOT NULL DEFAULT 'nominal'`)
      if (!has('is_sidechain')) db.exec(`ALTER TABLE claude_sessions ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0`)
    }
  },
  {
    id: 'phase_031_tool_timelines',
    up: (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'tool_timeline')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN tool_timeline TEXT`)
      }
    }
  },
  {
    id: 'phase_032_fleet_connectivity',
    up: (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'parent_session_id')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN parent_session_id TEXT`)
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_parent ON claude_sessions(parent_session_id)`)
    }
  },
  {
    id: 'phase_033_intent_handoffs',
    up: (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'intent_task')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN intent_task TEXT`)
      }
    }
  },
  {
    id: 'phase_034_historic_stability',
    up: (db: Database.Database) => {
      const sessionCols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!sessionCols.some((c) => c.name === 'history_stability')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN history_stability TEXT DEFAULT '[]'`)
      }
    }
  },
  {
    id: 'phase_035_strategic_area',
    up: (db: Database.Database) => {
      const sessionCols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!sessionCols.some((c) => c.name === 'area')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN area TEXT DEFAULT 'unknown'`)
      }
    }
  },
  {
    id: 'phase_036_claude_sessions_anomaly',
    up: (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(claude_sessions)`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'is_anomaly')) {
        db.exec(`ALTER TABLE claude_sessions ADD COLUMN is_anomaly INTEGER DEFAULT 0`)
      }
    }
  },
  {
    id: 'phase_037_sovereign_memory',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sovereign_memory (
          key TEXT PRIMARY KEY,
          value TEXT,
          project_slug TEXT,
          actor TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sovereign_memory_project ON sovereign_memory(project_slug);
      `)
    }
  },
  {
    id: 'phase_038_virtual_office_messages',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS virtual_office_messages (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          message TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'text',
          thinking TEXT,
          timestamp TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_virtual_office_messages_timestamp ON virtual_office_messages(timestamp);
      `)
    }
  },
  {
    id: 'phase_039_agent_memories',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('observation','reflection','relationship')),
          description TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 0,
          last_access INTEGER NOT NULL DEFAULT (unixepoch()),
          related_agent_id INTEGER,
          source_memory_ids TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_mem_agent_type ON agent_memories(agent_id, type);
        CREATE INDEX IF NOT EXISTS idx_mem_importance ON agent_memories(agent_id, importance DESC);
        CREATE INDEX IF NOT EXISTS idx_mem_recency ON agent_memories(agent_id, last_access DESC);
        CREATE INDEX IF NOT EXISTS idx_mem_workspace ON agent_memories(workspace_id);
      `)
    }
  },
  {
    id: 'phase_040_conversation_lifecycle',
    up: (db: Database.Database) => {
      const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'conversation_phase')) {
        db.exec(`ALTER TABLE messages ADD COLUMN conversation_phase TEXT`)
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_state (
          conversation_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','consensus','timeout','paused','completed')),
          hop_count INTEGER NOT NULL DEFAULT 0,
          consensus TEXT,
          initiator_agent_id INTEGER,
          started_at INTEGER NOT NULL,
          max_messages INTEGER NOT NULL DEFAULT 8,
          max_duration_ms INTEGER NOT NULL DEFAULT 600000,
          config TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_conv_state_status ON conversation_state(status);
      `)
    }
  },
  {
    id: 'phase_041_sop_engine',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sop_messages (
          id TEXT PRIMARY KEY,
          workflow_run_id TEXT NOT NULL,
          content TEXT NOT NULL,
          instruct_content TEXT,
          cause_by TEXT NOT NULL,
          sent_from TEXT NOT NULL,
          send_to TEXT DEFAULT '__all__',
          created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_sop_msgs_workflow ON sop_messages(workflow_run_id, cause_by);

        CREATE TABLE IF NOT EXISTS sop_role_state (
          workflow_run_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          state INTEGER DEFAULT -1,
          is_idle INTEGER DEFAULT 1,
          last_observed_msg_id TEXT,
          PRIMARY KEY (workflow_run_id, role_id)
        );
      `)
    }
  },
  {
    id: 'phase_042_token_usage_cost',
    up: (db: Database.Database) => {
      const cols = db.prepare('PRAGMA table_info(token_usage)').all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === 'cost')) {
        db.exec(`ALTER TABLE token_usage ADD COLUMN cost REAL NOT NULL DEFAULT 0`)
      }
    }
  },
  {
    id: 'phase_043_agent_relationships',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_relationships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          target_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('delegation','communication','supervision')),
          metadata TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(source_agent_id, target_agent_id, type)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_rel_source ON agent_relationships(source_agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_rel_target ON agent_relationships(target_agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_rel_workspace ON agent_relationships(workspace_id);
      `)
    }
  },
  {
    id: 'phase_044_spatial_positions',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spatial_positions (
          agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `)
    }
  },
  {
    id: 'phase_045_workflow_phases',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_phases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          phase_order INTEGER NOT NULL,
          agent_role TEXT,
          input_schema TEXT,
          output_schema TEXT,
          requires_approval INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          UNIQUE(template_id, phase_order)
        );
        CREATE INDEX IF NOT EXISTS idx_wf_phases_template ON workflow_phases(template_id);
      `)
    }
  },
  {
    id: 'phase_046_workflow_runs',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
          current_phase_id INTEGER REFERENCES workflow_phases(id),
          input_data TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_wf_runs_template ON workflow_runs(template_id);
        CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_wf_runs_workspace ON workflow_runs(workspace_id);
      `)
    }
  },
  {
    id: 'phase_047_workflow_phase_runs',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_phase_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
          phase_id INTEGER NOT NULL REFERENCES workflow_phases(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed','rejected')),
          input_artifact TEXT,
          output_artifact TEXT,
          validation_error TEXT,
          approved_by TEXT,
          approved_at INTEGER,
          started_at INTEGER,
          completed_at INTEGER,
          UNIQUE(run_id, phase_id)
        );
        CREATE INDEX IF NOT EXISTS idx_wf_phase_runs_run ON workflow_phase_runs(run_id);
      `)
    }
  },
  {
    id: 'phase_048_teams',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS teams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(name, workspace_id)
        );
        CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id);
      `)
    }
  },
  {
    id: 'phase_049_team_members',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS team_members (
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (team_id, agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_team_members_agent ON team_members(agent_id);
      `)
    }
  },
  {
    id: 'phase_050_debates',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS debates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','propose','critique','rebut','vote','concluded','budget_exhausted')),
          current_round INTEGER NOT NULL DEFAULT 1,
          max_rounds INTEGER NOT NULL DEFAULT 3,
          token_budget INTEGER NOT NULL DEFAULT 100000,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          outcome TEXT,
          vote_accept INTEGER NOT NULL DEFAULT 0,
          vote_reject INTEGER NOT NULL DEFAULT 0,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          concluded_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_debates_status ON debates(status);
        CREATE INDEX IF NOT EXISTS idx_debates_workspace ON debates(workspace_id);
      `)
    }
  },
  {
    id: 'phase_051_debate_arguments',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS debate_arguments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          debate_id INTEGER NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL,
          agent_name TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          phase TEXT NOT NULL CHECK(phase IN ('propose','critique','rebut')),
          content TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_debate_args_debate ON debate_arguments(debate_id, round_number, phase);
      `)
    }
  },
  {
    id: 'phase_052_debate_votes',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS debate_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          debate_id INTEGER NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL,
          agent_name TEXT NOT NULL,
          vote TEXT NOT NULL CHECK(vote IN ('accept','reject')),
          reason TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(debate_id, agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_debate_votes_debate ON debate_votes(debate_id);
      `)
    }
  },
  {
    id: 'phase_053_debate_participants',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS debate_participants (
          debate_id INTEGER NOT NULL REFERENCES debates(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          agent_name TEXT NOT NULL,
          joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (debate_id, agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_debate_participants_debate ON debate_participants(debate_id);
      `)
    }
  },
  {
    id: 'phase_054_pairwise_trust',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_pairwise_trust (
          source_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          target_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          trust_score REAL NOT NULL DEFAULT 0.5,
          interaction_count INTEGER NOT NULL DEFAULT 0,
          last_interaction_at INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          PRIMARY KEY (source_agent_id, target_agent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_pairwise_trust_source ON agent_pairwise_trust(source_agent_id);
        CREATE INDEX IF NOT EXISTS idx_pairwise_trust_target ON agent_pairwise_trust(target_agent_id);
      `)
    }
  },
  {
    id: 'phase_055_scaling_policies',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scaling_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          min_agents INTEGER NOT NULL DEFAULT 1,
          max_agents INTEGER NOT NULL DEFAULT 10,
          scale_up_threshold INTEGER NOT NULL DEFAULT 5,
          scale_down_threshold INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 60,
          idle_timeout_seconds INTEGER NOT NULL DEFAULT 300,
          auto_approve INTEGER NOT NULL DEFAULT 0,
          agent_template TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `)
    }
  },
  {
    id: 'phase_056_scaling_events',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scaling_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          policy_id INTEGER REFERENCES scaling_policies(id),
          event_type TEXT NOT NULL,
          agent_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          reason TEXT NOT NULL,
          metrics_snapshot TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          resolved_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_scaling_events_policy ON scaling_events(policy_id);
        CREATE INDEX IF NOT EXISTS idx_scaling_events_status ON scaling_events(status);
      `)
    }
  },
  {
    id: 'phase_057_scaling_policy_unique_name',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scaling_policies_workspace_name
        ON scaling_policies(workspace_id, name);
      `)
    }
  },
  {
    id: 'phase_058_agent_meetings',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          initiator_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          participant_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'walking',
          topic TEXT,
          summary TEXT,
          location_x INTEGER,
          location_y INTEGER,
          turn_count INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER NOT NULL DEFAULT 6,
          started_at INTEGER,
          concluded_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_meetings_workspace ON agent_meetings(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_agent_meetings_status ON agent_meetings(status);
        CREATE INDEX IF NOT EXISTS idx_agent_meetings_initiator ON agent_meetings(initiator_id);
        CREATE INDEX IF NOT EXISTS idx_agent_meetings_participant ON agent_meetings(participant_id);

        CREATE TABLE IF NOT EXISTS meeting_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meeting_id INTEGER NOT NULL REFERENCES agent_meetings(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          turn_number INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_messages_meeting ON meeting_messages(meeting_id);

        CREATE TABLE IF NOT EXISTS agent_office_positions (
          agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
          workspace_id INTEGER NOT NULL,
          x INTEGER NOT NULL DEFAULT 0,
          y INTEGER NOT NULL DEFAULT 0,
          target_x INTEGER,
          target_y INTEGER,
          zone TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_agent_office_positions_workspace ON agent_office_positions(workspace_id);
      `)
    }
  },
  {
    id: 'phase_059_meeting_task_source',
    up: (db: Database.Database) => {
      const cols = db.pragma('table_info(tasks)') as Array<{ name: string }>
      const colNames = cols.map(c => c.name)
      if (!colNames.includes('source_type')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN source_type TEXT`)
      }
      if (!colNames.includes('source_id')) {
        db.exec(`ALTER TABLE tasks ADD COLUMN source_id INTEGER`)
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type, source_id)`)
    }
  },
  {
    id: 'phase_060_meeting_quality_scheduling',
    up: (db: Database.Database) => {
      const cols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
      const colNames = cols.map(c => c.name)
      if (!colNames.includes('quality_score')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN quality_score TEXT`)
      }
      if (!colNames.includes('scheduled_for')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN scheduled_for INTEGER`)
      }
    }
  },
  {
    id: 'phase_061_recurring_meetings',
    up: (db: Database.Database) => {
      const cols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
      if (!cols.some(c => c.name === 'recurring_interval_ms')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN recurring_interval_ms INTEGER DEFAULT NULL`)
      }
    }
  },
  {
    id: 'phase_062_departments_project_wiring',
    up: (db: Database.Database) => {
      const teamCols = db.pragma('table_info(teams)') as Array<{ name: string }>
      if (!teamCols.some(c => c.name === 'parent_id')) {
        db.exec(`ALTER TABLE teams ADD COLUMN parent_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_id)`)
      }
      const projCols = db.pragma('table_info(projects)') as Array<{ name: string }>
      if (!projCols.some(c => c.name === 'team_id')) {
        db.exec(`ALTER TABLE projects ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id)`)
      }
      const mtgCols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
      if (!mtgCols.some(c => c.name === 'project_id')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_meetings_project ON agent_meetings(project_id)`)
      }
    }
  },
  {
    id: 'phase_063_project_decisions',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          decided_by TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_decisions_project ON project_decisions(project_id);
        CREATE INDEX IF NOT EXISTS idx_decisions_meeting ON project_decisions(meeting_id);
      `)
    }
  },
  {
    id: 'phase_064_project_artifacts',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_artifacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          meeting_id INTEGER REFERENCES agent_meetings(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          artifact_type TEXT NOT NULL DEFAULT 'document',
          created_by_agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_project ON project_artifacts(project_id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_created_by ON project_artifacts(created_by_agent_id);
      `)
    }
  },
  {
    id: 'phase_065_meeting_columns_and_indexes',
    up: (db: Database.Database) => {
      const cols = db.pragma('table_info(agent_meetings)') as Array<{ name: string }>
      const colNames = new Set(cols.map(c => c.name))
      if (!colNames.has('turn_count')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0`)
      }
      if (!colNames.has('max_turns')) {
        db.exec(`ALTER TABLE agent_meetings ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 6`)
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_phase_runs_phase ON workflow_phase_runs(phase_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_artifacts_meeting ON project_artifacts(meeting_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wf_runs_current_phase ON workflow_runs(current_phase_id)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_spatial_positions_workspace ON spatial_positions(workspace_id)`)
    }
  },
])
