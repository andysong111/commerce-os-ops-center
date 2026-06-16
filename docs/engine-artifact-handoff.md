# Engine Artifact Handoff

Commerce OS OPS CENTER uses an artifact handoff model for external engines.
External engines generate artifacts; OPS CENTER imports those artifacts; OPS CENTER reviews, previews, approves, exports, and later prepares execution. Real execution requires a separate explicit PR and a safety gate.

## Handoff rule

1. External engine repositories own generation logic and produce files outside OPS CENTER.
2. OPS CENTER imports or pastes generated artifacts into review pages.
3. OPS CENTER parses and classifies artifacts for human review.
4. Human reviewers approve, hold, or reject the imported artifact state.
5. OPS CENTER can preview and export reviewed artifacts.
6. Any real execution must be added by a future explicit PR with a clear safety gate.

## Current artifact contracts

### Keyword Engine (`andysong111/andysong111-keyword-engine-soon`)

Current OPS CENTER route: `/keyword-review-queue`.

Expected artifacts:

- `keyword_mvp_approval_sheet.csv`
- `keyword_mvp_manual_candidates.csv`
- `keyword_mvp_summary.md`
- Reviewed queue JSON export
- Payload/XML preview
- Execution intent JSON

OPS CENTER may import keyword-engine dry-run CSV/Markdown outputs, classify rows, support human review and edits, generate preview/export artifacts, and prepare safe execution intent where already implemented. OPS CENTER must not run `keyword-engine-soon` directly, call the Shopling API, auto-apply keywords, or write to external systems.

### Detail Page Engine (`andysong111/product-detail-page-auto`)

Current OPS CENTER route: `/detail-page-draft-review`.

Expected artifacts:

- `detailpage_final.html`
- `detailpage_render_report.json`
- `multi_source_summary.json`
- `generated_source` references
- Reviewed draft JSON export

OPS CENTER may import generated detail-page artifacts, show a sandboxed preview, allow human review memo/status, and export a reviewed draft artifact. OPS CENTER must not run `product-detail-page-auto` directly, call 1688, call OpenAI, generate images, publish product pages, or upload to sales channels.

## Do not blur repository boundaries

- Do not copy keyword-engine logic into OPS CENTER.
- Do not copy detail-page engine logic into OPS CENTER.
- OPS CENTER owns review, approval, preview, history, and execution safety.
- Engine repos own generation logic.
