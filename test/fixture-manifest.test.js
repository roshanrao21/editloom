import assert from "node:assert/strict";
import test from "node:test";
import { getFixture, loadFixtureManifest, runWithApprovedFixture } from "@editloom/fixtures";

test("the fixture manifest defines every required pilot profile and outcome", async () => {
  const manifest = await loadFixtureManifest();

  assert.equal(manifest.manifest_version, "1.0.0");
  assert.deepEqual(manifest.fixtures.map((fixture) => fixture.id), [
    "talking-head-clean",
    "talking-head-pauses",
    "two-speaker-podcast",
    "camera-cut-webcam",
    "vertical-brand-stress"
  ]);
  for (const fixture of manifest.fixtures) {
    assert.equal(typeof fixture.expected_outcomes.candidate_count.minimum, "number");
    assert.equal(typeof fixture.expected_outcomes.candidate_count.maximum, "number");
  }
});

test("media tests skip with the manifest reason until a fixture is approved", async (t) => {
  await runWithApprovedFixture(t, "talking-head-pauses", () => {
    assert.fail("an unavailable fixture must not execute media assertions");
  });
});

test("approved fixture lookup fails clearly for an unknown fixture", async () => {
  await assert.rejects(() => getFixture("not-a-fixture"), /Unknown fixture/);
});
