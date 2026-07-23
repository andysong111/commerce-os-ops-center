# Engine Runner Bridge

OPS CENTER owns the review surface for external engine artifacts, but the engine execution code remains in the external engine repositories.

## External engines

- Keyword Engine execution belongs in `andysong111/andysong111-keyword-engine-soon`.
  - Workflow file: `keyword-engine-runner.yml`
  - Workflow name: `Keyword Engine Runner`
  - Expected artifact name: `keyword-engine-mvp-output`
  - Actions page: <https://github.com/andysong111/andysong111-keyword-engine-soon/actions/workflows/keyword-engine-runner.yml>
- Detail Page Engine execution belongs in `andysong111/product-detail-page-auto`.
  - Workflow file: `detail-page-engine-runner.yml`
  - Workflow name: `Detail Page Engine Runner`
  - Expected artifact name: `detail-page-engine-output`
  - Actions page: <https://github.com/andysong111/product-detail-page-auto/actions/workflows/detail-page-engine-runner.yml>

## OPS CENTER routes

- Keyword runner: `/keyword-engine-runner`
- Keyword artifact review: `/keyword-review-queue`
- Detail page runner: `/detail-page-engine-runner`
- Detail page artifact review: `/detail-page-draft-review`

## Dispatch configuration

Set `GITHUB_ENGINE_DISPATCH_TOKEN` in the OPS CENTER server environment only. Do not commit the token and do not expose it to client-side code.

The token must have Actions write access and repository access to:

- `andysong111/andysong111-keyword-engine-soon`
- `andysong111/product-detail-page-auto`

When this variable is missing, OPS CENTER keeps dispatch safely blocked and returns: `GitHub Actions dispatch is not configured yet.`

## Dispatch behavior

OPS CENTER runner buttons now call the server-side `/api/engine-runners/dispatch` route. The route validates the configured runner kind, validates the supported mode, validates required inputs, maps only approved fields, and sends a GitHub REST API `workflow_dispatch` request to the configured external repository workflow.

GitHub `workflow_dispatch` returns HTTP 204 on success and does not return a run id immediately. OPS CENTER keeps the existing success message and tells operators to wait a few seconds, then click **Refresh runs**. The runner pages link to the external Actions page for direct GitHub monitoring.

## Run monitoring and artifact discovery

OPS CENTER can now list recent GitHub Actions workflow runs for the configured external engine workflows through the server-side `/api/engine-runners/runs` route. The route only accepts OPS CENTER runner kinds (`keyword_engine` and `detail_page_engine`) and resolves repository/workflow details from the checked-in runner configs. It does not accept arbitrary client-provided repositories or workflow files.

For each runner, OPS CENTER can detect whether the expected GitHub Actions artifact exists:

- Keyword Engine: `keyword-engine-mvp-output`
- Detail Page Engine: `detail-page-engine-output`

The run-monitoring API uses `GITHUB_ENGINE_DISPATCH_TOKEN` server-side only, returns safe normalized run/artifact data, and never returns the token to the browser. Full artifact zip download, parsing, persistence, and import into review pages is intentionally left for a later PR.

## Human review remains required

Generated artifacts must return to OPS CENTER review routes for human approval before downstream use. Keyword artifacts return to `/keyword-review-queue`; detail page artifacts return to `/detail-page-draft-review`.

## Safety boundaries

OPS CENTER must not copy external engine implementation logic or run the engines locally. This bridge does not add local PowerShell execution, shell execution helpers, Shopling execution, 1688 calls, OpenAI calls, image generation calls, publishing, sales channel upload, auth, or database persistence.

## Artifact import into review pages

OPS CENTER can now import GitHub Actions artifact zip output from the configured external engine repositories into the existing human review pages:

- Keyword Engine artifacts are staged for `/keyword-review-queue`.
- Detail Page Engine artifacts are staged for `/detail-page-draft-review`.

The import flow is intentionally temporary and review-only: GitHub Actions artifact zip → server-side download → allowlisted text extraction → browser session handoff → human review in OPS CENTER. No database persistence, Shopling apply, publishing, sales-channel upload, 1688 call, OpenAI call, image generation, local shell execution, or PowerShell execution occurs during import.

`GITHUB_ENGINE_DISPATCH_TOKEN` remains server-side only. The token is used only by API routes when downloading artifacts from the configured external repositories and is never stored in client state or returned in JSON responses.

Artifact extraction uses allowlisted expected filenames only. Unexpected files are ignored, path traversal entries are skipped or rejected, conservative text-size limits are enforced, and generated source image binaries are not loaded into client state. Detail Page Engine `generated_source/` entries are represented only as safe file names for reviewer context.

Future work:

- Persistent run history.
- Artifact import history.
- Approval history.
- Final execution verification.

## Detail Page Engine production artifact contract

The Detail Page Engine still runs externally in `andysong111/product-detail-page-auto` through `detail-page-engine-runner.yml`; OPS CENTER only dispatches the workflow, imports the resulting `detail-page-engine-output` artifact, and stages it for human review at `/detail-page-draft-review`.

The current production-ready detail page bundle includes these preferred files:

- `detailpage_shopling_FINAL.html` — recommended operator file to copy for Shopling HTML upload.
- `detailpage_shopling_FULL_IMAGE.html` — single full-page JPG HTML wrapper used for final upload preview/copy fallback.
- `shopling_section_image_export_report.json` — production readiness, full-image dimensions, format, and upload recommendation report.
- `shopling_full_image_manifest.json` — uploaded full-image URL manifest when the external engine produced one.
- `copywriter_v2_report.json` — final copy quality score and defect counts.
- `narrative_blueprint_v2.polished.json` — polished narrative/source context for review.
- `shopling_full_page_image/detailpage_full_1000.jpg` — binary JPG artifact reference only; OPS CENTER does not store raw image bytes/base64 in session storage.

Legacy detail artifacts (`detailpage_final.html`, `detailpage_render_report.json`, and `multi_source_summary.json`) remain supported as a fallback. The final upload format for production-ready output is a single full-page JPG represented by Shopling-ready HTML.
