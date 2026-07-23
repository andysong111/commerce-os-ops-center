# Engine artifact import

OPS CENTER imports external engine artifacts as a staged, local handoff for human review only.

## Safety model

- Downloads use `GITHUB_ENGINE_DISPATCH_TOKEN` on the server only.
- API requests select a known runner kind; clients cannot provide arbitrary repositories or workflow names.
- Zip extraction reads allowlisted text files only.
- Path traversal entries and unexpected files are not exposed to the review UI.
- Conservative per-file and zip size limits protect the preview path.
- Imported payloads are stored in browser `sessionStorage` with `requiresHumanReview: true`.
- No Shopling, 1688, OpenAI, image generation, local shell, PowerShell, publishing, or sales-channel upload execution is added.

## Handoff keys

- `opsCenter.keywordEngine.importedArtifact.v1`
- `opsCenter.detailPageEngine.importedArtifact.v1`

## Detail page production review import

For Detail Page Engine artifacts, OPS CENTER imports allowlisted text outputs from the external `andysong111/product-detail-page-auto` workflow and stores only a safe handoff payload in browser `sessionStorage`. The reviewer should prefer `detailpage_shopling_FINAL.html` for the Shopling HTML copy action. The production upload model is a single full-page JPG HTML artifact, with the image URL resolved from `shopling_full_image_manifest.json`, then `shopling_section_image_export_report.json`, then the `<img src>` inside `detailpage_shopling_FULL_IMAGE.html`.

`shopling_full_page_image/detailpage_full_1000.jpg` is treated as a binary reference only. OPS CENTER records safe metadata such as the artifact path and byte length if present; it does not load the JPG into `sessionStorage` as raw bytes or base64. If no uploaded image URL exists, `/detail-page-draft-review` shows a clear warning and falls back to a sandboxed HTML preview.
