CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'uploading', 'ingesting', 'analyzing', 'recommendations_ready', 'preview_rendering', 'review_ready', 'approved', 'final_rendering', 'delivered', 'failed_retryable', 'failed_action_required', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('source', 'derived')),
  derived_from_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
  format JSONB NOT NULL,
  duration_seconds DOUBLE PRECISION,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('pending_upload', 'available', 'superseded', 'deleted')),
  checksum_sha256 TEXT,
  storage_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS assets_one_active_source_per_project
  ON assets(project_id)
  WHERE role = 'source' AND lifecycle_status <> 'deleted';

CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets(project_id);

CREATE TABLE IF NOT EXISTS render_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  edl_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'queued', 'rendering', 'ready', 'failed')),
  output_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS render_versions_project_id_idx ON render_versions(project_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  details JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_project_id_occurred_at_idx ON audit_events(project_id, occurred_at);
