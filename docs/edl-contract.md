# Edit Decision List contract

The Edit Decision List (EDL) is the only render input in Editloom. It captures editorial decisions, not intermediate FFmpeg arguments. A preview and a final render must be reproducible from the same validated EDL version, source checksum, renderer version, and template versions.

## Canonical schema

The normative machine-readable contract is [v1.0.0.schema.json](../schemas/edl/v1.0.0.schema.json), written for JSON Schema Draft 2020-12. The smallest valid vertical-clip fixture is [minimal-vertical-clip.json](../fixtures/edl/minimal-vertical-clip.json).

An EDL has the following stable sections:

- identity and lineage: `schema_version`, IDs, version, parent version, author, and creation time;
- source: a managed asset reference, SHA-256 checksum, timebase, and source duration;
- output: fixed V1 vertical MP4 settings and the safe-area preset;
- video: ordered source trims and optional normalized reframe keyframes;
- captions: word-timed display cues and a named style template;
- overlays: title and B-roll placements, each with an explicit time range;
- audio: source gain, loudness target, and optional ducked music; and
- attribution: provenance for every external asset referenced by an EDL.

## Renderer semantics

1. The renderer validates the complete EDL before resolving media URLs or starting a worker job.
2. `source_in_seconds` and `source_out_seconds` are offsets in the source asset. The renderer rejects a segment whose out point is not greater than its in point or lies outside `source.duration_seconds`.
3. Segment ordering, cue timing, overlay timing, and reframe-keyframe timing are semantic checks performed after JSON Schema validation.
4. An `asset_id` is a database identifier, never a mutable URL. Only the worker resolves it to a read-only signed URL.
5. Every B-roll or music asset must have exactly one matching attribution entry. Source-video attribution is not required.
6. A valid EDL can contain no captions, overlays, or music. This keeps the manually authored, deterministic render path minimal.

## Versioning and compatibility

- **Patch** releases clarify constraints without changing a valid document's meaning. Renderers may accept the same major/minor schema and record their patch version.
- **Minor** releases add optional fields or values with a documented migration. A renderer must either migrate a stored EDL to its supported minor version or reject it with `edl_schema_unsupported`.
- **Major** releases may change required semantics. They require a new schema ID, an explicit migration, and a renderer capability declaration.
- An EDL becomes immutable when a preview or final render job is queued. Revisions create a new document with the next `version` and the prior `edl_id` in `parent_version_id`.

## Validation order

1. Parse JSON and validate against the versioned JSON Schema.
2. Resolve source and referenced assets in the project tenant; compare the stored source checksum.
3. Apply timing, ordering, safe-area, attribution, and renderer-capability checks.
4. Persist the validation result with the schema ID and renderer capability version.

The application/workspace task will add an AJV-based validation command and execute this fixture in automated tests. This contract deliberately stays dependency-free until that workspace baseline exists.
