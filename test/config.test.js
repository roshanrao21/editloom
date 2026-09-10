import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../packages/config/src/index.js";

test("loads safe local defaults", () => {
  const config = loadConfig({});
  assert.equal(config.apiPort, 3001);
  assert.equal(config.storageRoot, ".local-storage");
});

test("rejects an invalid port before a service starts", () => {
  assert.throws(() => loadConfig({ EDITLOOM_API_PORT: "not-a-port" }), /EDITLOOM_API_PORT/);
});
