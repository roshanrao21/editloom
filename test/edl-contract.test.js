import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = new URL("../schemas/edl/v1.0.0.schema.json", import.meta.url);
const fixturePath = new URL("../fixtures/edl/minimal-vertical-clip.json", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("the V1 EDL contract permits only 30 fps output", async () => {
  const schema = await readJson(schemaPath);
  const fps = schema.$defs.output.properties.fps;

  assert.deepEqual(fps, { const: 30 });
  assert.notEqual(24, fps.const);
  assert.notEqual(25, fps.const);
});

test("the minimal V1 EDL fixture uses the required 30 fps output", async () => {
  const fixture = await readJson(fixturePath);

  assert.equal(fixture.output.fps, 30);
});
