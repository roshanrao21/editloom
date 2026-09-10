import { createServer } from "node:http";
import { loadConfig } from "@editloom/config";

export function createWebServer(config) {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ service: "web", status: "ok" }));
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Editloom</title><main><h1>Editloom</h1><p>Media production workspace is ready.</p></main>");
  });
}

export function startWeb(config = loadConfig()) {
  const server = createWebServer(config);
  server.listen(config.webPort, config.webHost, () => {
    console.info(JSON.stringify({ event: "web_ready", host: config.webHost, port: config.webPort }));
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startWeb();
