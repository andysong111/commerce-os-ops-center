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
