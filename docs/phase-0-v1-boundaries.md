# Editloom V1: Technical Boundaries and Test Plan

Status: approved baseline — product sign-off received 2026-09-09.

## Product boundary

Editloom turns one uploaded, long-form talking-head recording into 3–5 approval-gated vertical social clips. The system produces an editable preview and, after explicit approval, a final MP4 together with caption and attribution artifacts.

The web application creates projects, accepts uploads, displays progress, supports review, and grants downloads. It must not run transcription, AI generation, or FFmpeg work in a request lifecycle. Durable workers own those operations, and a validated, versioned Edit Decision List (EDL) is the only render input.

## Supported V1 input baseline

These limits are intentionally conservative for the first production-engine implementation. They are product decisions, not implementation limitations.

| Area | Proposed V1 baseline | Behaviour outside the boundary |
| --- | --- | --- |
| Source per project | One video upload | Reject with an actionable validation error |
| Containers | MP4, MOV, M4V, WebM | Reject before storage finalization |
| Video codecs | H.264/AVC, H.265/HEVC, VP9 | Reject after media probe |
| Audio codecs | AAC, PCM, Opus | Reject after media probe |
| Duration | 30 seconds to 60 minutes | Reject before analysis is queued |
| Upload size | Up to 10 GiB | Reject before issuing an upload session |
| Frame size | 480p through 4K UHD | Reject after media probe |
| Audio | At least one usable audio stream; mono or stereo | Mark `failed_action_required` |
| Language | English only for the initial transcription path | Mark as unsupported; do not silently transcribe |

Revisit the duration, file-size, and concurrency limits after measuring representative fixture throughput and storage cost.

## Output and target-platform baseline

| Artifact | V1 contract |
| --- | --- |
| Video | 1080 x 1920 (9:16), H.264 MP4, AAC audio, 30 fps output preset |
| Preview | Same aspect ratio and edit semantics as the final; lower-cost encode is permitted |
| Captions | Word-timed captions burned into the video plus WebVTT and SRT sidecars |
| Thumbnail | JPG representative frame selected by the render job |
| Attribution | JSON record for every external asset used by the EDL |
| Platforms | Instagram Reels, YouTube Shorts, and TikTok; no direct publishing |

The initial safe-area preset must keep titles and captions inside the shared 9:16 social-safe region. Platform-specific safe-area refinements are a template concern, not an alternate rendering pipeline.

## Explicit non-goals

- A frame-accurate, Premiere-style timeline editor.
- Direct posting to social networks.
- Fully autonomous publication without creator approval.
- Long-form video editing, localization, voice cloning, or custom motion-graphics authoring.
- HeyGen or Hyperframes as a dependency of the core render path.
- Multiple source-video editing, live-stream ingest, or collaborative real-time editing.

## EDL and reliability rules

1. Every preview and final render consumes a validated EDL version; a renderer never consumes free-form model output.
2. A revision creates a new EDL version with parent, author, reason, and validation result. An EDL used by a render is immutable.
3. Commands and provider callbacks carry project, job, attempt, correlation, and idempotency identifiers.
4. Project state and job state are separate. Project failures are either retryable or require user action.
5. Source binaries and generated artifacts live in object storage; Postgres retains business state and metadata.
6. The first worker implementation must record source checksum, renderer version, output checksum, latency, and cost fields even when their values are initially zero or unavailable.

## Pilot-fixture inventory

No copyrighted or personal video is checked into the repository. Obtain each asset with documented testing permission and register its immutable checksum in `fixtures/manifest.json` when Task 4 creates the fixture harness.

| ID | Fixture profile | Minimum characteristics | Validates |
| --- | --- | --- | --- |
| `talking-head-clean` | Single speaker, clean studio recording | 6–12 min, 1080p H.264, clear English audio, at least three self-contained ideas | Upload, probe, transcription, candidate discovery, manual EDL render |
| `talking-head-pauses` | Single speaker with pauses and filler words | 8–15 min, normal room audio, deliberate pauses and verbal fillers | Timestamp normalization and source-signal persistence |
| `two-speaker-podcast` | Two distinct speakers | 20–45 min, English dialogue, speaker turns and overlaps | Diarization adapter normalization and clip boundaries |
| `camera-cut-webcam` | Talking head with scene/camera changes | 5–10 min, 1080p or 4K, several hard cuts | Media probing, proxy generation, visual-signal contract |
| `vertical-brand-stress` | Vertical or near-vertical source with branded lower thirds | 3–8 min, readable on-screen text, speech throughout | Reframe/safe-area rules and caption-overlay collision checks |

## Acceptance checks for Phase 0

- [x] The boundaries above are approved by the product owner.
- [ ] One legal, reproducible asset is registered for every fixture ID, including source URL/provenance, license/permission, duration, codec, dimensions, language, and SHA-256 checksum. This is required before production-engine media tests run.
- [ ] Each fixture has an expected result for probe, transcription, source signals, candidate count, EDL validation, preview render, and final render.
- [ ] The project starts with only the listed V1 inputs and outputs; unsupported cases return a documented error rather than an implicit fallback.
- [ ] The first implementation contains tests that reject invalid upload requests before worker work begins.
- [ ] The first deterministic render test uses `talking-head-clean` and a manually authored EDL.

## Deferred decisions before public launch

- Hosting providers for database, object storage, queue, workers, and status delivery.
- Transcription provider, retention terms, diarization threshold, and fallback policy.
- Tenant quotas, concurrent-project limits, malware scanning, and deletion/export policy.
- Exact preview latency/quality target and platform-specific duration caps.
- Brand-template controls and Pexels cache/attribution retention.
