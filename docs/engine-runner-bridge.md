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

## Korean-friendly operation notes

- 키워드 엔진은 `goods_key`만으로 실행할 수 있습니다.
- `seed_keyword`는 선택 입력이며, 비워두면 외부 키워드 엔진이 `goods_key` 기준으로 상품 정보를 읽어 검토용 결과물을 생성합니다.
- 상세페이지 엔진은 운영자가 1688 상품 링크만 입력해도 OPS CENTER가 `DP-YYYYMMDD-HHMMSS` 형식의 임시 `product_code`를 자동 생성해 기존 외부 workflow에 전달합니다.
- 결과물은 OPS CENTER의 검토 화면으로 가져오지만, 키워드는 자동 반영하지 않고 상세페이지도 자동 게시하지 않습니다. 항상 사람이 검토한 뒤 사용해야 합니다.
