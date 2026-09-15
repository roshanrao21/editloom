# Editloom pilot fixtures

This directory deliberately contains no media files. The Phase 0 inventory and acceptance expectations are in [the technical-boundaries plan](../docs/phase-0-v1-boundaries.md).

`manifest.json` defines every required pilot profile, its expected outcomes, and its approval state. An approved entry must include provenance, documented license or testing permission, technical metadata, and an immutable SHA-256 checksum. Do not commit source media unless its license and repository size policy both permit it.

Until a fixture is approved, leave its approval status as `unavailable` and give a concrete reason. Use `runWithApprovedFixture` from `@editloom/fixtures` in media tests; it skips the test with that reason rather than silently running against untracked media.
