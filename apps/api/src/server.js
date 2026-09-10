import { createServer } from "node:http";
import { loadConfig } from "@editloom/config";
import { createLocalMediaStore, createPostgresMediaStore } from "@editloom/media-store";

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("Request body is too large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function requestPath(request) {
  return new URL(request.url, "http://editloom.local");
}

export function createApiServer({ store } = {}) {
  return createServer(async (request, response) => {
    const url = requestPath(request);
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { service: "api", status: "ok" });
      return;
    }

    if (!store) {
      sendJson(response, 503, { error: "storage_not_configured" });
      return;
    }

    try {
      if (request.method === "POST" && url.pathname === "/v1/projects") {
        const body = await readJson(request);
        const project = await store.createProject({ ownerId: body.ownerId, title: body.title });
        sendJson(response, 201, { project });
        return;
      }

      const assetMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/assets$/);
      if (request.method === "POST" && assetMatch) {
        const body = await readJson(request);
        const asset = await store.createAsset({ projectId: assetMatch[1], ...body });
        sendJson(response, 201, { asset });
        return;
      }

      const renderMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/render-versions$/);
      if (request.method === "POST" && renderMatch) {
        const body = await readJson(request);
        const renderVersion = await store.createRenderVersion({ projectId: renderMatch[1], ...body });
        sendJson(response, 201, { renderVersion });
        return;
      }

      const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
      if (request.method === "GET" && projectMatch) {
        const project = await store.getProject({ projectId: projectMatch[1], ownerId: url.searchParams.get("ownerId") });
        sendJson(response, 200, { project });
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 400, { error: "invalid_request", message: error.message });
    }
  });
}

export async function startApi(config = loadConfig()) {
  const store = config.databaseUrl
    ? await createPostgresMediaStore({ databaseUrl: config.databaseUrl })
    : createLocalMediaStore({ storageRoot: config.storageRoot });
  const server = createApiServer({ store });
  server.listen(config.apiPort, config.apiHost, () => {
    console.info(JSON.stringify({ event: "api_ready", host: config.apiHost, port: config.apiPort }));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startApi().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
