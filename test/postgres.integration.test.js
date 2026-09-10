import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMediaStore } from "../packages/media-store/src/index.js";

const databaseUrl = process.env.DATABASE_URL;

test("PostgreSQL persists project metadata and hides storage references", { skip: !databaseUrl }, async () => {
  const store = await createPostgresMediaStore({ databaseUrl });
  try {
    const project = await store.createProject({ ownerId: "integration_creator", title: "PostgreSQL integration" });
    const source = await store.createAsset({
      projectId: project.id,
      ownerId: "integration_creator",
      role: "source",
      format: { container: "mp4", mimeType: "video/mp4", videoCodec: "h264", audioCodec: "aac" },
      durationSeconds: 60,
      fileName: "integration.mp4"
    });
    const persisted = await store.getProject({ projectId: project.id, ownerId: "integration_creator" });
    assert.equal(persisted.assets[0].id, source.id);
    assert.equal("storageRef" in persisted.assets[0], false);
    assert.equal((await store.getAuditEvents({ projectId: project.id, ownerId: "integration_creator" })).length, 2);
  } finally {
    await store.close();
  }
});
