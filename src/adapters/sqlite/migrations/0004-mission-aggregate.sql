-- Migration: 0004-mission-aggregate
-- Persist the checked Mission aggregate as relational domain data. Child
-- tables are aggregate-owned value collections, not independently writable
-- entities. Repository observations remain in known_repositories; missions
-- retain only the stable RepositoryId reference.

ALTER TABLE known_repositories ADD COLUMN display_name TEXT;

CREATE TABLE missions (
  id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('backlog', 'refined', 'active', 'review', 'integration', 'done')
  ),
  raw_status TEXT,
  assignee TEXT,
  net_engineering_lines INTEGER CHECK (
    net_engineering_lines IS NULL OR net_engineering_lines >= 0
  ),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (
    closed_at IS NULL OR status = 'done'
  )
);

CREATE INDEX idx_missions_repository ON missions (repository_id);
CREATE INDEX idx_missions_status ON missions (status);

CREATE TABLE mission_labels (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL CHECK (length(label) > 0),
  PRIMARY KEY (mission_id, position),
  UNIQUE (mission_id, label)
);

CREATE TABLE mission_checkpoints (
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  checkpoint_mission_id TEXT NOT NULL,
  name TEXT NOT NULL,
  raw_filename TEXT,
  first_line TEXT,
  next_action_text TEXT NOT NULL,
  PRIMARY KEY (mission_id, position)
);

CREATE TABLE mission_checkpoint_goal_checks (
  mission_id TEXT NOT NULL,
  checkpoint_position INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  criterion TEXT NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY (mission_id, checkpoint_position, position),
  FOREIGN KEY (mission_id, checkpoint_position)
    REFERENCES mission_checkpoints(mission_id, position) ON DELETE CASCADE
);

CREATE TABLE mission_reviews (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  intervention_requested_at TEXT,
  intervention_requested_by TEXT CHECK (
    intervention_requested_by IS NULL
    OR intervention_requested_by IN ('reviewer', 'implementer', 'workflow')
  ),
  intervention_reason TEXT,
  CHECK (
    (intervention_requested_at IS NULL
      AND intervention_requested_by IS NULL
      AND intervention_reason IS NULL)
    OR
    (intervention_requested_at IS NOT NULL
      AND intervention_requested_by IS NOT NULL
      AND intervention_reason IS NOT NULL)
  )
);

CREATE TABLE mission_review_rounds (
  mission_id TEXT NOT NULL REFERENCES mission_reviews(mission_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('pull-request', 'local-branch')),
  provider TEXT,
  provider_change_id TEXT,
  provider_url TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  revision TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  implementer TEXT NOT NULL,
  started_at TEXT NOT NULL,
  decision_kind TEXT CHECK (decision_kind IS NULL OR decision_kind IN ('approved', 'changes-requested')),
  decided_at TEXT,
  decision_comment TEXT,
  approval_source_kind TEXT CHECK (
    approval_source_kind IS NULL OR approval_source_kind IN ('provider', 'local')
  ),
  approval_source_provider TEXT,
  responded_at TEXT,
  resulting_revision TEXT,
  PRIMARY KEY (mission_id, position),
  UNIQUE (mission_id, round_number),
  CHECK (
    (change_kind = 'pull-request' AND provider IS NOT NULL AND provider_change_id IS NOT NULL)
    OR
    (change_kind = 'local-branch' AND provider IS NULL
      AND provider_change_id IS NULL AND provider_url IS NULL)
  ),
  CHECK (
    (decision_kind IS NULL AND decided_at IS NULL AND approval_source_kind IS NULL)
    OR
    (decision_kind = 'approved' AND decided_at IS NOT NULL AND approval_source_kind IS NOT NULL)
    OR
    (decision_kind = 'changes-requested' AND decided_at IS NOT NULL
      AND approval_source_kind IS NULL AND approval_source_provider IS NULL)
  ),
  CHECK (
    (responded_at IS NULL AND resulting_revision IS NULL)
    OR (responded_at IS NOT NULL AND resulting_revision IS NOT NULL)
  )
);

CREATE TABLE mission_review_findings (
  mission_id TEXT NOT NULL,
  round_position INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  finding_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  location TEXT,
  PRIMARY KEY (mission_id, round_position, position),
  UNIQUE (mission_id, round_position, finding_id),
  FOREIGN KEY (mission_id, round_position)
    REFERENCES mission_review_rounds(mission_id, position) ON DELETE CASCADE
);

CREATE TABLE mission_review_resolutions (
  mission_id TEXT NOT NULL,
  round_position INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  finding_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed', 'disputed')),
  explanation TEXT NOT NULL,
  PRIMARY KEY (mission_id, round_position, position),
  UNIQUE (mission_id, round_position, finding_id),
  FOREIGN KEY (mission_id, round_position)
    REFERENCES mission_review_rounds(mission_id, position) ON DELETE CASCADE,
  FOREIGN KEY (mission_id, round_position, finding_id)
    REFERENCES mission_review_findings(mission_id, round_position, finding_id)
);
