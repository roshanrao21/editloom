import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEdl } from "@editloom/edl";

const fixturePath = new URL("../fixtures/edl/minimal-vertical-clip.json", import.meta.url);

async function minimalEdl() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("the minimal EDL fixture validates with its versioned schema", async () => {
  const result = validateEdl(await minimalEdl());

  assert.deepEqual(result, {
    valid: true,
    schemaId: "https://editloom.dev/schemas/edl/v1.0.0.schema.json",
    schemaVersion: "1.0.0",
    errors: []
  });
});

test("an unsupported frame rate produces an actionable validation error", async () => {
  const edl = await minimalEdl();
  edl.output.fps = 24;

  const result = validateEdl(edl);

  assert.equal(result.valid, false);
  assert.equal(result.schemaVersion, "1.0.0");
  assert.ok(result.errors.some((error) => error.instancePath === "/output/fps" && error.keyword === "const"));
});
