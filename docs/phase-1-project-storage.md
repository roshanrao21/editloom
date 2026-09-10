# Phase 1 project and media persistence

Task 5 introduces a durable local development implementation of the project,
asset, render-version, and audit models. It deliberately preserves the service
boundaries in the production architecture: metadata is separate from media
bodies, and no storage reference is returned by the API.

## Data model

- A project has an owner, title, state, and creation/update timestamps.
- An asset belongs to one project and owner. It is either one `source` asset or
  a `derived` asset linked to an existing asset in that project.
- Assets record container, MIME type, optional codecs, duration, lifecycle
  state, checksum placeholder, and audit timestamps.
- A render version links its project, source asset, and future EDL version. It
  can later collect derived output assets without altering the source record.
- Every create operation adds an owner-scoped audit event.

## Storage boundary

The local adapter persists metadata atomically to
`$EDITLOOM_STORAGE_ROOT/metadata.json` (default `.local-storage`) with private
permissions. Its per-tenant/project/asset storage references remain internal
to the store and are removed from every API response. Task 6 will add upload
finalization and object-body writes; this task only reserves and persists the
private media record.

Production adapters must retain this API while using Postgres for metadata and
the chosen object store for binaries, as specified in the production
architecture.
