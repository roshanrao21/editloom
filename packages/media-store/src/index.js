import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";

const DATA_VERSION = 1;
const ASSET_ROLES = new Set(["source", "derived"]);
const ASSET_LIFECYCLE_STATES = new Set(["pending_upload", "available", "superseded", "deleted"]);
const RENDER_VERSION_STATES = new Set(["draft", "queued", "rendering", "ready", "failed"]);

function now() {
  return new Date().toISOString();
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

function ensureSetValue(value, field, allowed) {
  const normalized = requiredString(value, field);
  if (!allowed.has(normalized)) throw new Error(`${field} must be one of: ${[...allowed].join(", ")}`);
  return normalized;
}

function normalizeDuration(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("durationSeconds must be a non-negative number or null");
  }
  return value;
}

function normalizeFormat(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("format is required");
  return {
    container: requiredString(value.container, "format.container").toLowerCase(),
    mimeType: requiredString(value.mimeType, "format.mimeType").toLowerCase(),
    videoCodec: optionalString(value.videoCodec, "format.videoCodec"),
    audioCodec: optionalString(value.audioCodec, "format.audioCodec")
  };
}

function privateTenantSegment(ownerId) {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
}

function safeObjectFileName(value) {
  const normalized = requiredString(value, "fileName").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_").replace(/^\.+/, "");
  if (normalized === "") throw new Error("fileName is invalid");
  return normalized;
}

function publicAsset(asset) {
  const { storageRef: _storageRef, ...result } = asset;
  return result;
}

function publicProject(project, assets, renderVersions) {
  return {
    ...project,
    assets: assets.map(publicAsset),
    renderVersions: [...renderVersions]
  };
}

function blankDatabase() {
  return { version: DATA_VERSION, projects: [], assets: [], renderVersions: [], auditEvents: [] };
}

/**
 * Local durable implementation of the Project/Asset repository. Production
 * adapters must preserve this interface while storing metadata in Postgres and
 * object bodies in the selected object store.
 */
export class LocalMediaStore {
  #root;
  #metadataPath;
  #database;
  #ready;

  constructor({ storageRoot }) {
    this.#root = requiredString(storageRoot, "storageRoot");
    this.#metadataPath = join(this.#root, "metadata.json");
    this.#ready = this.#load();
  }

  async #load() {
    await mkdir(this.#root, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.#metadataPath, "utf8"));
      if (parsed.version !== DATA_VERSION) throw new Error("Unsupported metadata store version");
      this.#database = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.#database = blankDatabase();
      await this.#persist();
    }
  }

  async #persist() {
    const temporaryPath = join(dirname(this.#metadataPath), `metadata.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(this.#database, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.#metadataPath);
  }

  async #transaction(change) {
    await this.#ready;
    const result = change(this.#database);
    await this.#persist();
    return result;
  }

  #projectForOwner(projectId, ownerId) {
    const project = this.#database.projects.find((candidate) => candidate.id === projectId && candidate.ownerId === ownerId);
    if (!project) throw new Error("Project not found for owner");
    return project;
  }

  #recordAudit({ actorId, projectId, type, details }) {
    this.#database.auditEvents.push({
      id: `audit_${randomUUID()}`,
      actorId,
      projectId,
      type,
      details,
      occurredAt: now()
    });
  }

  async createProject({ ownerId, title = "Untitled project" }) {
    return this.#transaction(() => {
      const timestamp = now();
      const project = {
        id: `project_${randomUUID()}`,
        ownerId: requiredString(ownerId, "ownerId"),
        title: requiredString(title, "title"),
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.#database.projects.push(project);
      this.#recordAudit({ actorId: project.ownerId, projectId: project.id, type: "project.created", details: { title: project.title } });
      return publicProject(project, [], []);
    });
  }

  async createAsset({ projectId, ownerId, role, lifecycleStatus = "pending_upload", format, durationSeconds = null, fileName, derivedFromAssetId = null }) {
    return this.#transaction(() => {
      const project = this.#projectForOwner(requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId"));
      const normalizedRole = ensureSetValue(role, "role", ASSET_ROLES);
      const normalizedLifecycle = ensureSetValue(lifecycleStatus, "lifecycleStatus", ASSET_LIFECYCLE_STATES);
      const projectAssets = this.#database.assets.filter((asset) => asset.projectId === project.id);

      if (normalizedRole === "source" && projectAssets.some((asset) => asset.role === "source" && asset.lifecycleStatus !== "deleted")) {
        throw new Error("A project can have only one active source asset");
      }

      let parentAssetId = null;
      if (normalizedRole === "derived") {
        parentAssetId = requiredString(derivedFromAssetId, "derivedFromAssetId");
        if (!projectAssets.some((asset) => asset.id === parentAssetId)) {
          throw new Error("derivedFromAssetId must belong to the project");
        }
      }

      const assetId = `asset_${randomUUID().replaceAll("-", "")}`;
      const safeFileName = safeObjectFileName(fileName);
      const timestamp = now();
      const asset = {
        id: assetId,
        projectId: project.id,
        ownerId: project.ownerId,
        role: normalizedRole,
        derivedFromAssetId: parentAssetId,
        format: normalizeFormat(format),
        durationSeconds: normalizeDuration(durationSeconds),
        lifecycleStatus: normalizedLifecycle,
        checksumSha256: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        // This private reference is used only by internal workers/storage code.
        storageRef: join("tenants", privateTenantSegment(project.ownerId), "projects", project.id, "assets", assetId, safeFileName)
      };
      this.#database.assets.push(asset);
      project.updatedAt = timestamp;
      this.#recordAudit({ actorId: project.ownerId, projectId: project.id, type: "asset.created", details: { assetId, role: asset.role, lifecycleStatus: asset.lifecycleStatus } });
      return publicAsset(asset);
    });
  }

  async createRenderVersion({ projectId, ownerId, sourceAssetId, edlVersionId, status = "draft" }) {
    return this.#transaction(() => {
      const project = this.#projectForOwner(requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId"));
      const sourceAsset = this.#database.assets.find((asset) => asset.id === requiredString(sourceAssetId, "sourceAssetId") && asset.projectId === project.id);
      if (!sourceAsset || sourceAsset.role !== "source") throw new Error("sourceAssetId must reference the project's source asset");
      const renderVersion = {
        id: `render_${randomUUID()}`,
        projectId: project.id,
        sourceAssetId: sourceAsset.id,
        edlVersionId: requiredString(edlVersionId, "edlVersionId"),
        status: ensureSetValue(status, "status", RENDER_VERSION_STATES),
        outputAssetIds: [],
        createdAt: now()
      };
      this.#database.renderVersions.push(renderVersion);
      this.#recordAudit({ actorId: project.ownerId, projectId: project.id, type: "render_version.created", details: { renderVersionId: renderVersion.id, sourceAssetId: sourceAsset.id } });
      return { ...renderVersion };
    });
  }

  async getProject({ projectId, ownerId }) {
    await this.#ready;
    const project = this.#projectForOwner(requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId"));
    return publicProject(
      project,
      this.#database.assets.filter((asset) => asset.projectId === project.id),
      this.#database.renderVersions.filter((renderVersion) => renderVersion.projectId === project.id)
    );
  }

  async getAuditEvents({ projectId, ownerId }) {
    await this.#ready;
    this.#projectForOwner(requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId"));
    return this.#database.auditEvents.filter((event) => event.projectId === projectId).map((event) => ({ ...event }));
  }
}

export function createLocalMediaStore(options) {
  return new LocalMediaStore(options);
}

function mapProject(row) {
  return { id: row.id, ownerId: row.owner_id, title: row.title, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

function mapAsset(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    role: row.role,
    derivedFromAssetId: row.derived_from_asset_id,
    format: row.format,
    durationSeconds: row.duration_seconds,
    lifecycleStatus: row.lifecycle_status,
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapRenderVersion(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceAssetId: row.source_asset_id,
    edlVersionId: row.edl_version_id,
    status: row.status,
    outputAssetIds: row.output_asset_ids,
    createdAt: row.created_at.toISOString()
  };
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordPostgresAudit(client, { actorId, projectId, type, details }) {
  await client.query(
    "INSERT INTO audit_events (id, actor_id, project_id, type, details, occurred_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
    [`audit_${randomUUID()}`, actorId, projectId, type, JSON.stringify(details), now()]
  );
}

/** PostgreSQL implementation of the Project/Asset repository. */
export class PostgresMediaStore {
  #pool;

  constructor({ databaseUrl, pool } = {}) {
    if (!pool && !databaseUrl) throw new Error("databaseUrl is required");
    this.#pool = pool ?? new pg.Pool({ connectionString: databaseUrl });
  }

  async migrate() {
    const migration = await readFile(new URL("../../../db/migrations/001_initial.sql", import.meta.url), "utf8");
    await this.#pool.query(migration);
  }

  async close() {
    await this.#pool.end();
  }

  async createProject({ ownerId, title = "Untitled project" }) {
    const timestamp = now();
    const id = `project_${randomUUID()}`;
    const result = await withTransaction(this.#pool, async (client) => {
      const inserted = await client.query(
        "INSERT INTO projects (id, owner_id, title, status, created_at, updated_at) VALUES ($1, $2, $3, 'draft', $4, $4) RETURNING *",
        [id, requiredString(ownerId, "ownerId"), requiredString(title, "title"), timestamp]
      );
      const project = mapProject(inserted.rows[0]);
      await recordPostgresAudit(client, { actorId: project.ownerId, projectId: project.id, type: "project.created", details: { title: project.title } });
      return project;
    });
    return { ...result, assets: [], renderVersions: [] };
  }

  async createAsset({ projectId, ownerId, role, lifecycleStatus = "pending_upload", format, durationSeconds = null, fileName, derivedFromAssetId = null }) {
    return withTransaction(this.#pool, async (client) => {
      const normalizedProjectId = requiredString(projectId, "projectId");
      const normalizedOwnerId = requiredString(ownerId, "ownerId");
      const projectResult = await client.query("SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE", [normalizedProjectId, normalizedOwnerId]);
      if (projectResult.rowCount !== 1) throw new Error("Project not found for owner");
      const project = mapProject(projectResult.rows[0]);
      const normalizedRole = ensureSetValue(role, "role", ASSET_ROLES);
      const normalizedLifecycle = ensureSetValue(lifecycleStatus, "lifecycleStatus", ASSET_LIFECYCLE_STATES);
      const parentAssetId = normalizedRole === "derived" ? requiredString(derivedFromAssetId, "derivedFromAssetId") : null;
      if (parentAssetId) {
        const parent = await client.query("SELECT id FROM assets WHERE id = $1 AND project_id = $2", [parentAssetId, project.id]);
        if (parent.rowCount !== 1) throw new Error("derivedFromAssetId must belong to the project");
      }
      const id = `asset_${randomUUID().replaceAll("-", "")}`;
      const timestamp = now();
      const inserted = await client.query(
        "INSERT INTO assets (id, project_id, owner_id, role, derived_from_asset_id, format, duration_seconds, lifecycle_status, checksum_sha256, storage_ref, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NULL, $9, $10, $10) RETURNING *",
        [id, project.id, project.ownerId, normalizedRole, parentAssetId, JSON.stringify(normalizeFormat(format)), normalizeDuration(durationSeconds), normalizedLifecycle, join("tenants", privateTenantSegment(project.ownerId), "projects", project.id, "assets", id, safeObjectFileName(fileName)), timestamp]
      );
      await client.query("UPDATE projects SET updated_at = $2 WHERE id = $1", [project.id, timestamp]);
      const asset = mapAsset(inserted.rows[0]);
      await recordPostgresAudit(client, { actorId: project.ownerId, projectId: project.id, type: "asset.created", details: { assetId: asset.id, role: asset.role, lifecycleStatus: asset.lifecycleStatus } });
      return asset;
    });
  }

  async createRenderVersion({ projectId, ownerId, sourceAssetId, edlVersionId, status = "draft" }) {
    return withTransaction(this.#pool, async (client) => {
      const projectResult = await client.query("SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE", [requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId")]);
      if (projectResult.rowCount !== 1) throw new Error("Project not found for owner");
      const project = mapProject(projectResult.rows[0]);
      const source = await client.query("SELECT id, role FROM assets WHERE id = $1 AND project_id = $2", [requiredString(sourceAssetId, "sourceAssetId"), project.id]);
      if (source.rowCount !== 1 || source.rows[0].role !== "source") throw new Error("sourceAssetId must reference the project's source asset");
      const id = `render_${randomUUID()}`;
      const inserted = await client.query(
        "INSERT INTO render_versions (id, project_id, source_asset_id, edl_version_id, status, output_asset_ids, created_at) VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6) RETURNING *",
        [id, project.id, source.rows[0].id, requiredString(edlVersionId, "edlVersionId"), ensureSetValue(status, "status", RENDER_VERSION_STATES), now()]
      );
      const renderVersion = mapRenderVersion(inserted.rows[0]);
      await recordPostgresAudit(client, { actorId: project.ownerId, projectId: project.id, type: "render_version.created", details: { renderVersionId: renderVersion.id, sourceAssetId: renderVersion.sourceAssetId } });
      return renderVersion;
    });
  }

  async getProject({ projectId, ownerId }) {
    const projectResult = await this.#pool.query("SELECT * FROM projects WHERE id = $1 AND owner_id = $2", [requiredString(projectId, "projectId"), requiredString(ownerId, "ownerId")]);
    if (projectResult.rowCount !== 1) throw new Error("Project not found for owner");
    const project = mapProject(projectResult.rows[0]);
    const [assets, renderVersions] = await Promise.all([
      this.#pool.query("SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at", [project.id]),
      this.#pool.query("SELECT * FROM render_versions WHERE project_id = $1 ORDER BY created_at", [project.id])
    ]);
    return { ...project, assets: assets.rows.map(mapAsset), renderVersions: renderVersions.rows.map(mapRenderVersion) };
  }

  async getAuditEvents({ projectId, ownerId }) {
    await this.getProject({ projectId, ownerId });
    const events = await this.#pool.query("SELECT * FROM audit_events WHERE project_id = $1 ORDER BY occurred_at", [projectId]);
    return events.rows.map((event) => ({ id: event.id, actorId: event.actor_id, projectId: event.project_id, type: event.type, details: event.details, occurredAt: event.occurred_at.toISOString() }));
  }
}

export async function createPostgresMediaStore(options) {
  const store = new PostgresMediaStore(options);
  await store.migrate();
  return store;
}
