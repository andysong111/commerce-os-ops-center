# Commerce OS OPS CENTER

Commerce OS OPS CENTER is the operational UI for product sourcing, review, approval, and fulfillment workflows. It coordinates product master work, freight barcode PDFs, keyword review/approval, detail page draft review, and future execution preparation without changing live external systems.

## Current modules

- Product Master: manages product and option records for operational workflows.
- Freight Barcode PDF: creates freight forwarding barcode/origin label work request PDFs.
- Keyword Review / Approval Queue: currently usable imported-artifact workflow for reviewing Keyword Engine dry-run outputs, editing rows, approving data, and preparing safe previews.
- Keyword Engine Runner: future direct execution module; the engine is currently run outside this app and imported into the review queue.
- Detail Page Draft Review / Preview: currently usable imported-artifact workflow for reviewing generated detail page HTML/JSON artifacts.
- Detail Page Engine Runner: future direct execution module; the engine is currently run outside this app and imported into the preview/review module.
- China Order Cost Calculator: allocates China domestic shipping and calculates option-level purchase costs.

## Repository role

### commerce-os-ops-center

- operational UI
- review/approval
- previews
- safe execution preparation
- business workflows

### dev-command-center

- development command UI
- PR/repo coordination
- developer workflow

### keyword-engine-soon

- keyword generation and SearchAd validation engine

### product-detail-page-auto

- detail page generation engine

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in a browser.

## Verification

```bash
npm test
npm run lint
npm run build
```
