import { readFile } from "node:fs/promises";

const manifestPath = new URL("../../../fixtures/manifest.json", import.meta.url);
const requiredFixtureIds = new Set([
  "talking-head-clean",
  "talking-head-pauses",
  "two-speaker-podcast",
  "camera-cut-webcam",
  "vertical-brand-stress"
]);
const requiredExpectedOutcomes = new Set([
  "probe",
  "transcription",
  "source_signals",
  "candidate_count",
  "edl_validation",
  "preview_render",
  "final_render"
]);

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value;
}

function validateApprovedFixture(fixture) {
  if (!fixture.provenance || typeof fixture.provenance !== "object") throw new Error(`${fixture.id}.provenance is required for approved fixtures`);
  if (!fixture.rights || typeof fixture.rights !== "object") throw new Error(`${fixture.id}.rights is required for approved fixtures`);
  if (!fixture.technical_metadata || typeof fixture.technical_metadata !== "object") throw new Error(`${fixture.id}.technical_metadata is required for approved fixtures`);
  requiredString(fixture.checksum_sha256, `${fixture.id}.checksum_sha256`);
  if (!/^[a-f0-9]{64}$/.test(fixture.checksum_sha256)) throw new Error(`${fixture.id}.checksum_sha256 must be a lowercase SHA-256 digest`);
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("fixture entries must be objects");
  requiredString(fixture.id, "fixture.id");
  requiredString(fixture.profile, `${fixture.id}.profile`);
  if (!fixture.minimum_characteristics || typeof fixture.minimum_characteristics !== "object") throw new Error(`${fixture.id}.minimum_characteristics is required`);
  if (!fixture.approval || typeof fixture.approval !== "object") throw new Error(`${fixture.id}.approval is required`);
  if (!new Set(["approved", "unavailable"]).has(fixture.approval.status)) throw new Error(`${fixture.id}.approval.status must be approved or unavailable`);
  if (fixture.approval.status === "approved") validateApprovedFixture(fixture);
  else requiredString(fixture.approval.reason, `${fixture.id}.approval.reason`);
  if (!fixture.expected_outcomes || typeof fixture.expected_outcomes !== "object") throw new Error(`${fixture.id}.expected_outcomes is required`);
  for (const outcome of requiredExpectedOutcomes) {
    if (!(outcome in fixture.expected_outcomes)) throw new Error(`${fixture.id}.expected_outcomes.${outcome} is required`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("fixture manifest must be an object");
  if (manifest.manifest_version !== "1.0.0") throw new Error("fixture manifest version must be 1.0.0");
  if (!Array.isArray(manifest.fixtures)) throw new Error("fixture manifest fixtures must be an array");

  const ids = new Set();
  for (const fixture of manifest.fixtures) {
    validateFixture(fixture);
    if (ids.has(fixture.id)) throw new Error(`duplicate fixture ID: ${fixture.id}`);
    ids.add(fixture.id);
  }
  for (const id of requiredFixtureIds) {
    if (!ids.has(id)) throw new Error(`missing required fixture profile: ${id}`);
  }
  return manifest;
}

export async function loadFixtureManifest() {
  return validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

export async function getFixture(id) {
  const fixture = (await loadFixtureManifest()).fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown fixture: ${id}`);
  return fixture;
}

/**
 * Makes future media tests self-documenting when their approved source has
 * not yet been registered in the manifest.
 */
export async function runWithApprovedFixture(testContext, id, run) {
  const fixture = await getFixture(id);
  if (fixture.approval.status !== "approved") {
    testContext.skip(`Fixture ${id} is unavailable: ${fixture.approval.reason}`);
    return;
  }
  return run(fixture);
}
