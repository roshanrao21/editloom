import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer } from "../apps/api/src/server.js";
import { createWebServer } from "../apps/web/src/server.js";
import { runWorker } from "../apps/worker/src/worker.js";

async function request(server, path, { method = "GET", body: requestBody } = {}) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const { statusCode, body: responseBody } = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method, agent: false, headers: requestBody ? { "content-type": "application/json" } : undefined }, (response) => {
      let rawBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { rawBody += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(rawBody) }));
    });
    request.on("error", reject);
    request.end(requestBody ? JSON.stringify(requestBody) : undefined);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return { statusCode, body: responseBody };
}

test("API exposes a health endpoint", async () => {
  const { statusCode, body } = await request(createApiServer(), "/health");
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { service: "api", status: "ok" });
});

test("web exposes a health endpoint", async () => {
  const { statusCode, body } = await request(createWebServer({}), "/health");
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { service: "web", status: "ok" });
});

test("worker can run one local smoke-test pass", () => {
  const events = [];
  const handle = runWorker({ config: { queuePollMs: 1 }, once: true, logger: { info: (event) => events.push(event) } });
  assert.equal(events.length, 1);
  handle.stop();
});

test("API creates a project and returns asset metadata without a storage path", async () => {
  const { createLocalMediaStore } = await import("../packages/media-store/src/index.js");
  const storageRoot = await mkdtemp(join(tmpdir(), "editloom-api-store-"));
  try {
    const server = createApiServer({ store: createLocalMediaStore({ storageRoot }) });
    const created = await request(server, "/v1/projects", { method: "POST", body: { ownerId: "creator_123", title: "API project" } });
    assert.equal(created.statusCode, 201);
    const projectId = created.body.project.id;
    const asset = await request(server, `/v1/projects/${projectId}/assets`, {
      method: "POST",
      body: { ownerId: "creator_123", role: "source", format: { container: "mp4", mimeType: "video/mp4" }, durationSeconds: 60, fileName: "source.mp4" }
    });
    assert.equal(asset.statusCode, 201);
    assert.equal("storageRef" in asset.body.asset, false);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
