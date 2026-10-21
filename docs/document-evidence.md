# Explicit-file document evidence (phase 1)

This additive feature supports LIGHT's Knowledge & Documentation Lead role.
It does not create another knowledge store, scan accounts, change documents,
watch files, or perform semantic duplicate/conflict detection. Those are later
phases, gated on reader verification and a separately selected scope.

## Read

Use existing `light_github_file`, `light_gitlab_file`, or `light_drive_file`
with an explicit selected resource. Existing authentication, repository allowlists,
Drive grant, accepted file types, and download limits remain unchanged. No new
credential names, OAuth scopes, permissions, or aliases are introduced.

Successful text reads add an `evidence` object:

- `schema`: `light.document-observation.v1`.
- `provider`, `resource`: provider plus repository/path, or Drive file ID/ZIP entry.
- `requested_ref`: the caller's ref (GitLab defaults to main); **not** a resolved commit.
- `observed_at`: the Worker clock at content observation, not upstream modification time.
- `revision`: GitHub content blob SHA when supplied, **not commit SHA**. GitLab raw
  reads have no resolved revision and return null. Drive version is metadata-only:
  metadata and download are separate requests and can race. It does **not** prove
  the downloaded body belongs to that version. No atomic snapshot is claimed.
- `content_sha256`: SHA-256 of the UTF-8 encoding of the exact returned text.
- `coverage`: complete flag, returned and full decoded UTF-16 unit counts.

The existing text caps remain 30,000 UTF-16 units (GitHub/GitLab) and 60,000
(Drive). They were not byte caps; descriptions now state the exact unit. Slices
avoid splitting surrogate pairs. Drive's download limit remains 4 MiB, including
ZIP container bytes. A ZIP listing is not a document read and has no evidence.
Only explicitly selected supported text entries produce content evidence.
Native Google Docs/Sheets, PDFs and model binaries remain unsupported.

Failures do not manufacture evidence. Provider errors remain sanitized; no retry
was added. A 429 must be handled by the caller without repeated polling, honoring
provider retry guidance where available. Existing Drive transport has no explicit
timeout and does not forward Retry-After; this feature does not claim otherwise.

## Compare

Pass two `evidence` objects as `before` and `after` to `light_document_compare`.
It performs **no network calls and no storage**, and retains existing MCP auth.
The existing MCP D1 binding-presence gate is unchanged; this tool never queries it.

Results are `changed`, `unchanged`, `incomplete`, or `incomparable`, with independent
`content_status` and `revision_status`. Same content with different revision is
reported as changed overall with unchanged content. Unknown revision stays unknown.
Different resource/ref, malformed/missing evidence, or contradictory fingerprint
length/blob evidence is incomparable; any partial input is incomplete.

Inputs are caller-supplied observations, not signed receipts. The tool validates
shape and internal consistency but **cannot authenticate retrieval history or
verify supplied hashes against original content**. `authenticity_verified:false`
is always returned. Unchanged means equal supplied complete-text fingerprints,
not proof that the remote source remains unchanged. Drive revision differences
remain metadata-only even when content comparisons are possible.

Retain prior observations in the existing owner-selected workflow, not a new
LIGHT database. Do not submit secrets in observations. Tool outputs omit input
text and unrecognized fields and do not expose Worker credentials.

## Verification and delivery boundary

Tests use local synthetic responses, including native workerd fetch interception.
They do not establish credential validity, live provider access, staging readiness,
or successful production deployment. This branch depends on PR #8's reader
runtime repairs. Production merge/deploy and credential repair need owner approval.
