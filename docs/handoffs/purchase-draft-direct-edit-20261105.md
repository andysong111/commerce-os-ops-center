# Purchase Draft direct edit handoff — 2026-11-05

## Problem and confirmed cause

- The Step 3 product search described checked rows as pending additions.
- The client sent those rows only as purchase-recalculation quantity overrides.
- The recalculation engine intentionally allowed an override to preserve an existing Draft row, but did not let it introduce a non-recommended row that was absent from the Draft.
- The UI contract therefore promised a manual addition that the recalculation contract could discard.

## Implemented behavior

- Step 4 now separates exact operator edits from automatic recommendation recalculation.
- `재계산 없이 변경 저장` applies additions, removals and quantity changes to the current Draft without running the sales/inventory allocation engine.
- The server validates the whole request before writing, stores all operation rows in one PostgREST batch, and reads the Draft back to verify every requested B-code and quantity.
- Repeated requests are idempotent by request ID and absolute target quantity. They do not increase an addition twice.
- While unsaved direct edits exist, the automatic recalculation button is disabled. Stock-band, discontinuation and quantity-pin-release changes retain their existing recalculation path.
- No 1688 order, checkout, payment, supplier contact, inventory write or Shopling write is executed.

## Verification

- Focused regression tests: 29/29 passed.
- Purchase Cycle Preflight CI test set: 483/483 passed.
- Changed-file ESLint: passed.
- TypeScript `tsc --noEmit`: passed.
- Next.js production build: Webpack build passed and emitted `/api/china-order-manager/drafts/[draftId]/direct-edits`.
- Default Turbopack initially failed in the Windows sandbox while creating a CSS helper process; the code-equivalent Webpack build passed outside that sandbox restriction.

## Remaining live check

- After deployment, use a non-ordered Draft to add one B-code, remove one existing B-code and change one quantity in a single save.
- Refresh the page and verify the exact three results remain while the Draft ID is unchanged.
- Do not use live order completion or payment for this check.
