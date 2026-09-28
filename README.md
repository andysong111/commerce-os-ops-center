# Commerce OS OPS CENTER

Commerce OS OPS CENTER is the operational UI for product sourcing, review, approval, and fulfillment workflows. It coordinates product master work, freight barcode PDFs, keyword review/approval, detail page draft review, and future execution preparation without changing live external systems.

## Current modules

- Product Master: manages product and option records for operational workflows.
- Freight Barcode PDF: creates freight forwarding barcode/origin label work request PDFs.
- Keyword Review / Approval Queue: currently usable imported-artifact workflow for reviewing Keyword Engine dry-run outputs, editing rows, approving data, and preparing safe previews.
- Keyword Engine Runner: future direct execution module; the engine is currently run outside this app and imported into the review queue.
- Detail Page Studio: opens the current production image-upload engine for eight-section generation, AI quality review, automatic panel correction, multilingual output, and final JPG download.
- China Purchase & Receiving Manager: imports the existing China order workbook, allocates landed costs, saves purchase batches, and records normal, defective, and missing receipt quantities without changing Ops Center, Shopling, or sales-channel inventory.
- Product Decision Agent: combines Shopling products by barcode and opens the monthly purchase, hold, and discontinuation recommendation workspace.
- Local Agent: Windows-resident heartbeat and read-only Shopling/A21 diagnostic collector. See `local-agent/README.md`.

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

### commerce-os-detail-page-studio

- current production detail page generation studio

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
npm run typecheck
npm run build
```

## Windows Local Agent

```powershell
npm run local-agent:status
powershell -ExecutionPolicy Bypass -File .\local-agent\scripts\install-startup-task.ps1 -StartNow
```

The agent writes local status to `local-agent/data/latest-status.json` and diagnostics to `local-agent/data/diagnostics/`. Supabase upload is opt-in and documented in `local-agent/README.md`.
