import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalMediaStore } from "../packages/media-store/src/index.js";

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), "editloom-media-store-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("persists a source, derived asset, render version, and audit metadata", async () => {
  await withStore(async (storageRoot) => {
    const store = createLocalMediaStore({ storageRoot });
    const project = await store.createProject({ ownerId: "creator_123", title: "Episode one" });
    const source = await store.createAsset({
      projectId: project.id,
      ownerId: "creator_123",
      role: "source",
      format: { container: "mp4", mimeType: "video/mp4", videoCodec: "h264", audioCodec: "aac" },
      durationSeconds: 120,
      fileName: "episode-one.mp4"
    });
    const proxy = await store.createAsset({
      projectId: project.id,
      ownerId: "creator_123",
      role: "derived",
      derivedFromAssetId: source.id,
      lifecycleStatus: "available",
      format: { container: "mp4", mimeType: "video/mp4", videoCodec: "h264", audioCodec: "aac" },
      durationSeconds: 120,
      fileName: "episode-one-proxy.mp4"
    });
    const render = await store.createRenderVersion({ projectId: project.id, ownerId: "creator_123", sourceAssetId: source.id, edlVersionId: "edl_version_1" });

    const reloaded = createLocalMediaStore({ storageRoot });
    const savedProject = await reloaded.getProject({ projectId: project.id, ownerId: "creator_123" });
    assert.equal(savedProject.assets.length, 2);
    assert.equal(savedProject.renderVersions[0].id, render.id);
    assert.equal(savedProject.assets.find((asset) => asset.id === proxy.id).durationSeconds, 120);
    assert.equal(JSON.stringify(savedProject).includes("storageRef"), false);
    assert.equal((await reloaded.getAuditEvents({ projectId: project.id, ownerId: "creator_123" })).length, 4);
  });
});

test("enforces project ownership and one active source asset", async () => {
  await withStore(async (storageRoot) => {
    const store = createLocalMediaStore({ storageRoot });
    const project = await store.createProject({ ownerId: "creator_123" });
    const asset = { projectId: project.id, ownerId: "creator_123", role: "source", format: { container: "mov", mimeType: "video/quicktime" }, fileName: "source.mov" };
    await store.createAsset(asset);
    await assert.rejects(store.createAsset(asset), /only one active source/);
    await assert.rejects(store.getProject({ projectId: project.id, ownerId: "creator_456" }), /not found/);
  });
});

test("keeps caller-controlled owner IDs and filenames out of private storage paths", async () => {
  await withStore(async (storageRoot) => {
    const store = createLocalMediaStore({ storageRoot });
    const project = await store.createProject({ ownerId: "../creator", title: "Safe path" });
    const asset = await store.createAsset({
      projectId: project.id,
      ownerId: "../creator",
      role: "source",
      format: { container: "mp4", mimeType: "video/mp4" },
      fileName: "../../source video.mp4"
    });
    assert.equal("storageRef" in asset, false);
    const persisted = JSON.parse(await readFile(join(storageRoot, "metadata.json"), "utf8"));
    const storedAsset = persisted.assets.find((candidate) => candidate.id === asset.id);
    assert.equal(storedAsset.storageRef.includes(".."), false);
    assert.equal(storedAsset.storageRef.includes("creator"), false);
  });
});
