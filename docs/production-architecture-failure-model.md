# Production architecture and failure model

Status: implemented Phase 0 baseline — ready for review.

Editloom is an asynchronous media-production system. Web requests create commands and query persisted state; they never transcribe, generate recommendations, or render video. A durable job owns each long-running action, and the versioned EDL remains immutable once a render is queued.

## Service boundaries

| Component | Owns | Must not do |
| --- | --- | --- |
| Web application | Project creation, direct-upload initiation, status display, clip review, approvals, and download requests | Wait for a worker or transform media |
| Application API | Authentication, tenancy checks, command validation, signed URL issuance, read models, and transactional writes | Run FFmpeg or call long-running providers inline |
| Postgres | Projects, assets, EDL versions, job state, events, usage, and audit records | Store source media or generated binaries |
| Object storage | Tenant-scoped source files, proxies, outputs, captions, thumbnails, and attribution JSON | Authorize users or infer project status |
| Transactional outbox + queue | At-least-once delivery of durable commands | Act as the source of truth for job state |
| Analysis workers | Media probe, normalization, transcription, source signals, and recommendation requests | Create an EDL from unvalidated free-form model text |
| Render workers | Validated EDL materialization and render manifests | Mutate EDLs or choose editorial policy |
| Provider adapters | Normalized provider requests, callback verification, raw-response pointers, latency, and cost | Persist canonical project state directly |

## Durable job model

Every long-running action creates one job row before the command is written to the outbox. A worker claims a job atomically, records an attempt, and emits an event in the same database transaction as its state change.

| Job kind | Trigger | Success output |
| --- | --- | --- |
| `probe_source` | Upload finalization | MIME, streams, dimensions, duration, checksum |
| `normalize_source` | Successful probe | Proxy/mezzanine asset reference |
| `transcribe_source` | Normalized source | Normalized word timestamps and speaker turns |
| `analyze_source` | Transcript available | Pauses, fillers, scene changes, source signals |
| `recommend_clips` | Source signals available | 3–5 candidates and draft EDL references |
| `render_preview` | Creator selects a validated EDL | Preview MP4, thumbnail, caption sidecars |
| `render_final` | Creator approves a validated EDL | Final MP4 and immutable render manifest |
| `cleanup_project` | Retention policy or explicit deletion | Deleted-object audit event |

Job states are independent from project states:

`queued → claimed → running → waiting_callback → succeeded`

`running` or `waiting_callback` may move to `retry_scheduled`, `failed_retryable`, `failed_action_required`, or `cancelled`. A retry returns to `queued` with an incremented attempt number. `succeeded`, `failed_action_required`, and `cancelled` are terminal for one job ID; a user-initiated retry creates a new job linked to the original job.

## Project state model

| State | Meaning | User-visible message |
| --- | --- | --- |
| `draft` | Project exists; no upload finalized | Ready for upload |
| `uploading` | Signed upload is active | Uploading source video |
| `ingesting` | Probe and normalization jobs are active | Preparing video |
| `analyzing` | Transcription and source analysis are active | Analyzing video |
| `recommendations_ready` | 3–5 candidates are persisted | Clips are ready to review |
| `preview_rendering` | A selected EDL is rendering | Creating preview |
| `review_ready` | Preview is available; revision is permitted | Ready for approval or revision |
| `approved` | A validated EDL version is pinned | Final render ready to start |
| `final_rendering` | Pinned EDL is rendering | Creating final download |
| `delivered` | Final manifest and downloadable artifacts exist | Download is ready |
| `failed_retryable` | Retry policy has not exhausted recovery | Recovering automatically |
| `failed_action_required` | User input or support action is needed | Action required: see project details |
| `cancelled` | Creator cancelled remaining work | Processing cancelled |

The API may only advance a project when the job event expected by its current state succeeds. Late, duplicate, or out-of-order events are persisted for audit but cannot regress project state.

## Command and callback idempotency

Each command, worker attempt, and external callback must include this envelope:

```json
{
  "event_id": "uuid",
  "event_type": "transcription.completed",
  "occurred_at": "RFC 3339 timestamp",
  "project_id": "uuid",
  "job_id": "uuid",
  "attempt": 2,
  "idempotency_key": "stable opaque key",
  "correlation_id": "uuid",
  "provider_request_id": "provider value when applicable"
}
```

Rules:

1. A command's idempotency key is unique within its project and operation. Repeating the same API request returns the original accepted command rather than enqueueing work again.
2. The outbox consumer deduplicates by event ID; the worker records a claim token and attempt number before side effects.
3. Provider callbacks are accepted only when their verified signature, provider request ID, project, job, and expected attempt all match a pending job. The callback event ID is stored with a unique constraint.
4. Workers write artifacts under immutable, attempt-scoped object keys. A successful completion promotes an artifact reference transactionally; a retry cannot overwrite the promoted artifact.
5. The render worker rechecks the EDL schema, asset checksum, and pinned template/renderer versions immediately before rendering.

## Failure taxonomy and recovery

| Category | Examples | Retry policy | Project result |
| --- | --- | --- | --- |
| `input` | Unsupported codec, corrupt upload, missing audio | Never retry automatically | `failed_action_required` |
| `storage` | Transient object-store read/write failure | 3 attempts; exponential backoff with jitter | `failed_retryable`, then `failed_action_required` |
| `provider` | Timeout, 429, 5xx, callback delay | 5 attempts; honor `Retry-After`; callback timeout creates a safe retry | `failed_retryable`, then `failed_action_required` |
| `model_schema` | Invalid structured recommendation or unsupported EDL schema | One corrective re-prompt for model output; no renderer retry | `failed_action_required` |
| `asset_rights` | Missing Pexels attribution or revoked source | Never retry automatically | `failed_action_required` |
| `renderer` | FFmpeg non-zero exit, unavailable codec, failed quality check | 2 attempts only for infrastructure exits; never retry deterministic EDL errors | `failed_retryable`, then `failed_action_required` |
| `internal` | Unexpected exception, invariant violation | 2 attempts with alerting | `failed_retryable`, then `failed_action_required` |

Backoff starts at 30 seconds and doubles, capped at 15 minutes. Retryability is decided from a structured error code, not from exception text. The worker stores sanitized diagnostics, command input reference, stderr pointer when applicable, and the exact attempt timeline.

## Recovery procedures

- **Upload never finalizes:** expire the upload session; retain the draft project; permit a new upload session without duplicate assets.
- **Provider callback is missing:** mark the job `waiting_callback`; at the provider-specific timeout, query the provider once using the stored request ID, then retry or surface action required.
- **Worker crashes after output creation:** the promotion transaction has not happened, so an orphaned attempt artifact is safe to collect; a retry starts from the prior durable job state.
- **Preview fails:** preserve the selected EDL and allow retry after the fault is resolved. Do not require the creator to select the clip again.
- **Final render fails:** preserve the approved, pinned EDL. Retrying creates a new render job and render manifest attempt, never a new EDL version.
- **Deletion requested:** cancel queued jobs, prevent new signed URLs, record the deletion request, then delete storage artifacts asynchronously. Retain only the minimum audit record required by the retention policy.

## Required observability

Each job attempt records: job and project IDs, idempotency/correlation keys, job kind, queue and run latency, retry count, failure category/code, worker and renderer versions, provider/model version, input/output asset IDs and checksums, token/provider cost, and quality-validation result.

Minimum alerts before pilot release:

- queue age above the configured service target;
- exhausted retries or `internal` failures;
- callback timeout rate above baseline;
- final-render failure rate or output quality-check failures above baseline; and
- missing attribution or unexpected cost per project.

## Task 3 acceptance mapping

- [x] Every long-running action has a durable job kind and independent job state.
- [x] Commands, callbacks, output promotion, and retries have explicit idempotency rules.
- [x] Failure categories, recovery paths, and user-visible project statuses are defined.
