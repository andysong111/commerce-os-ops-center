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

GitHub `workflow_dispatch` returns HTTP 204 on success and does not return a run id immediately. Open the linked external Actions page to monitor the run. Artifact download and import will be handled in a later PR.

## Human review remains required

Generated artifacts must return to OPS CENTER review routes for human approval before downstream use. Keyword artifacts return to `/keyword-review-queue`; detail page artifacts return to `/detail-page-draft-review`.

## Safety boundaries

OPS CENTER must not copy external engine implementation logic or run the engines locally. This bridge does not add local PowerShell execution, shell execution helpers, Shopling execution, 1688 calls, OpenAI calls, image generation calls, publishing, sales channel upload, auth, or database persistence.
