# Engine Runner Bridge

OPS CENTER cannot and should not directly run local PowerShell commands for external engine work. The safe execution model is a bridge from an OPS CENTER button to a server-side API route, then to GitHub Actions `workflow_dispatch` in the external engine repository.

## Intended architecture

1. An OPS CENTER user opens a runner page and reviews the execution plan.
2. OPS CENTER sends a server-side dispatch request for the configured external engine repository and workflow file.
3. The external engine repository runs its own pipeline in GitHub Actions.
4. The engine repository uploads artifacts from that run.
5. OPS CENTER imports or reviews those artifacts in the existing review pages.

## Safety boundaries

- OPS CENTER does not run local PowerShell.
- OPS CENTER does not run local shell execution for engines.
- Keyword Engine execution belongs in `andysong111/andysong111-keyword-engine-soon`.
- Detail Page Engine execution belongs in `andysong111/product-detail-page-auto`.
- OPS CENTER does not call Shopling, 1688, OpenAI, or publishing systems as part of this bridge.
- Human review remains required before approved data is used downstream.
- Artifacts must be reviewed in OPS CENTER review pages before operational use.

## Current review destinations

- Keyword artifacts return to `/keyword-review-queue`.
- Detail page artifacts return to `/detail-page-draft-review`.

## Future work

1. Add `keyword-engine-runner.yml` to `keyword-engine-soon`.
2. Add `detail-page-engine-runner.yml` to `product-detail-page-auto`.
3. Add artifact fetch/import from GitHub Actions run.
4. Add run history.
5. Add approval and execution verification.
