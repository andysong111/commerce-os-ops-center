# Commerce OS · 발주사이클 7~11구간 · Codex handoff

Updated: 2026-09-30

## 0. Purpose

This is the persistent handoff for the Commerce OS purchase-cycle work that was previously spread across multiple ChatGPT conversations.

Project scope:

**Stage 7~11 purchase-cycle development and operational verification**

The goal is not to build another isolated reorder calculator. The goal is to complete a closed, evidence-based loop:

`verified sales -> verified cost -> verified inventory -> open/in-transit commitments -> purchase shadow -> budgeted preview -> owner-approved real small order -> receiving -> confirmed landed cost -> inventory/sale-state/cash close`

A fresh Codex chat should be able to read this file and continue without asking the owner to reconstruct the prior ChatGPT history.

This document is a handoff, not an authority above live evidence. Current `main`, current production behavior, direct database/Shopling evidence, and the owner's latest instruction override an older checkpoint here.

---

## 1. Mandatory first read

Before changing this project, read in this order:

1. `AGENTS.md`
2. `docs/CODEX_START_HERE.md`
3. `docs/commerce-os-master-context-20260929.md`
4. this file
5. `docs/purchase-cycle-2026-10-01-predevelopment.md`
6. `docs/purchase-cycle-2026-10-01-review-hardening.md`
7. `docs/purchase-cycle-preflight-complete-month-read.md`
8. current purchase-cycle code/tests on `main`
9. current open PRs touching purchase-cycle
10. current production/read-only evidence

Do not start by recreating architecture from chat memory.

---

## 2. Owner intent and working style

The owner wants the system to remove routine manual work.

Default behavior for Codex:

- continue reversible engineering, tests, PR creation, ordinary merge/deploy verification, and read-only diagnostics without repeatedly asking for permission
- do not stop merely because a mechanical development step finished
- stop only at a real owner/business boundary
- when owner intervention is required, explain it at roughly Korean high-school freshman level
- keep the intervention message short and operational

Use this format when owner action is needed:

1. **지금 어디:** current stage in one sentence
2. **왜 멈춤:** why automation must stop
3. **내가 할 일:** exact 1~3 actions
4. **완료 신호:** what the owner should report/what observable result means Codex can continue

Do not make the owner interpret request IDs, fingerprints, DOM internals, CI details, or database terminology unless those details are genuinely needed. Put technical detail underneath the simple instruction.

Once the owner completes the required action, resume automatically through the next reversible steps.

---

## 3. Repository roles

Primary orchestration/UI repository:

- `andysong111/commerce-os-ops-center`

Canonical Product Master repository:

- `andysong111/commerce-os-product-master`

Do not create a second truth store in Ops Center to bypass Product Master.

Identity must remain explicit:

- B-code / barcode
- model number
- Shopling GOODSKEY
- SKU ID
- option identity

Fuzzy name matching must not be promoted into a business write authority.

---

## 4. Stage map

The purchase preflight code numbers the upstream sales gates as Stage 5~6 and the focused purchase work as Stage 7~11.

### Stage 5 — official canonical sales candidate gate

Purpose:

- latest Shopling order-row sales candidate exists
- candidate is pinned by request/event/plan fingerprints
- direct Shopling parity and mismatch evidence explain any differences
- promotion gate is safe

No purchase is executed here.

### Stage 6 — Product Master apply + readback

Sequence:

`candidate -> parity/evidence -> promotion gate -> 1-row CANARY -> same-plan FULL -> persisted readback/reconciliation`

CANARY and FULL are business writes to the canonical sales ledger and remain explicit owner-action boundaries.

A successful code path is not enough. The persisted Product Master result must be read back and reconciled to the exact candidate.

### Stage 7 — verified purchase-cost evidence

Purpose:

- purchase candidates use only verified purchase cost evidence
- estimated/planning/cache cost must not become VERIFIED merely because a value exists
- preserve a conservative protected cost floor
- cost evidence is for purchase decision use unless a separate contract explicitly authorizes another use

Authoritative Product Master implementation checkpoint:

- `commerce-os-product-master` main commit `8ff97def1ffad61863a42f6d91e1f5c30898bbeb`
- immutable purchase-cost evidence ledger and protected import/read contract are merged there
- six legacy verified evidence rows were canonicalized during that Stage 7 work

Important current repository nuance:

- Ops Center PR **#1223** (`Stage 7: use canonical verified purchase cost in purchase preflight`) is still open and was created from an older main.
- Do **not** merge #1223 blindly.
- First compare it against current `main`, current Product Master contract, and newer purchase-cycle code. Rebase/port only still-missing behavior and preserve newer changes/tests.

Historical chat shorthand called Stage 7 "complete" because the canonical evidence layer was completed in Product Master. That must not be confused with saying every Ops Center consumer is currently integrated on latest main.

### Stage 8 — inventory evidence / exact stock basis

The owner explicitly rejected a mandatory whole-warehouse stocktake.

Authoritative inventory policy:

- a real sold-out confirmation creates a trusted `SOLD_OUT_RESET = 0` baseline
- after that baseline, verified inbound/receiving adds stock and canonical sales subtract stock
- normal operation should accumulate exact evidence from those events
- STOCKTAKE is an exception/correction tool for inconsistency, not a required periodic full-warehouse ritual
- `INITIAL_ZERO` or otherwise unverified inventory may be advisory/provisional but must not silently become execution authority
- negative ledger state or identity conflict is REVIEW/BLOCKED, not a value to "fix" by assumption

Stage 8 work also depended on rebuilding the upstream sales evidence safely. Historical production problems and fixes from this ChatGPT project included:

- oversized Shopling 30-day reads failed
- new candidate source reads were changed to 7-day ranges
- legacy failed 30-day requests downgrade to 7-day and can fall back to 2-day ranges
- successful ranges are preserved/reused instead of restarting from zero
- maintenance scheduler starvation was removed so evidence workers can progress
- bounded sales-event drain was accelerated while preserving safety limits

Historical Ops Center commits from that work include:

- `0221a3e268be7325e9f1cbad2ffd02c9ca2c9f75` — reliable 7-day Shopling sales ranges
- `a1e85ccc12b3194018a80ac90d5ebed84dd8b554` — prevent maintenance dispatcher starvation
- `fd2dad54cfdb1a471e5a14fc3e47846af5bcbc6f` — bounded sales-range drain cadence
- `bedfaec0a7e35af06bc5ffd9aaadd8175fb4392d` — current-candidate prewrite evidence worker
- `a2f79f7f7e26a2b804d71eaa224cbfe9a3d30c69` — post-apply purchase-readiness worker

Treat these as historical implementation checkpoints. Always inspect current `main` before changing them.

### Stage 9 — canonical purchase Shadow

Purpose:

- calculate what would be purchased without executing a purchase
- use the same pinned sales/inventory/cost context
- subtract open/in-transit purchase commitments so an already-ordered quantity is not recommended twice
- keep MOQ/carton/lead-time rules
- expose blockers rather than filling missing inventory/cost with convenient values
- same-context legacy/current-method comparison is useful evidence but must not override canonical safety gates

Conceptual inputs:

`canonical demand + verified inventory + open commitment + verified/protected cost + MOQ/carton + lead time + monthly budget context`

Output remains read-only until later approval.

### Stage 10 — budgeted small-order preview

Target operating date discussed with the owner: **2026-10-01**.

Rules:

- calculate from the target cycle month, not from a stale prior-month plan
- use the completed previous calendar month as the funding basis
- re-read fresh sales/inventory/open-commitment evidence on the target date
- subtract already-recorded purchase spend
- apply the owner cash cap
- keep shipping/logistics reserve logic distinct from product cost
- when an owner cash cap is entered, treat it as all-in cash including product payment and the freight/fee reserve, and use the smaller of it and the automatic prior-month envelope
- allocate explicit cash caps by the 2026-10-03 owner rule: top 25% at the engine target, next 50% at 60%, final 25% at MOQ/carton minimum, then top up by priority
- every reduced quantity must retain MOQ/carton alignment, never exceed the engine target, and be shown as original recommendation -> cash-adjusted quantity; rows that cannot afford their minimum are excluded explicitly
- preview is not an order, reservation, approval token, or scheduled purchase

Historical operating shorthand was previous-month sales / 2 as the purchase budget reference. Current code/policy is authoritative where it has refined that rule.

The owner must enter/confirm the actual cash limit and review the final small-order amount/items/quantities before real execution.

### Stage 11 — real order -> receiving -> close

This stage is complete only when the real operating loop has evidence, not when a simulation passes.

Required real-loop evidence:

`owner-approved small order -> actual order/payment -> partial/full receiving -> confirmed landed cost -> inventory update -> Shopling sale-state consequence if applicable -> purchase/cash/cost close`

Initial actual execution should be deliberately small.

The owner has not authorized blind automatic 1688 checkout/payment as the default boundary.

---

## 5. Purchase cost and landed-cost rules worth preserving

Do not treat one generic "원가" number as authoritative without provenance.

Known landed-cost allocation rule from the import operation:

`actual logistics multiplier = (total product purchase amount + actual forwarding/logistics cost) / total product purchase amount`

and then, where that historical contract applies:

`final SKU cost = product purchase cost * actual logistics multiplier + China domestic freight allocation`

Use current canonical code/contracts where they supersede the historical formula.

For purchase safety:

- verified purchase cost and protected cost are distinct concepts
- the conservative effective cost should not be lowered just to make a candidate pass
- missing verified cost blocks execution authority
- cost provenance should remain queryable

---

## 6. Open commitment / duplicate-order invariant

An item already ordered but not yet fully received is not "free demand".

Purchase calculations must account for:

- ordered quantity
- partial receiving
- remaining open commitment / in-transit quantity
- cancelled/reduced commitment where explicitly recorded

Do not recommend the same missing quantity twice because receiving has not happened yet.

Partial success/history must be preserved; never delete and recreate an in-flight business event merely to make the current UI easier.

---

## 7. October 1 operating boundary

The date was chosen as a real small-order verification point, not as an auto-execution trigger.

On/around 2026-10-01:

1. close/verify September funding basis
2. refresh the current canonical sales candidate
3. verify Product Master persisted readback
4. verify purchase-cost evidence
5. verify current inventory baselines and open commitments
6. compute Stage 9 Shadow with the same pinned context
7. enter owner cash cap
8. create Stage 10 read-only preview
9. compare to the prior/legacy method only if the analysis context is comparable
10. owner approves exact money/items/quantity
11. only then use the established purchase execution path
12. verify receiving/cost/inventory/cash close before declaring Stage 11 complete

Never reuse a September recommendation as October's final order simply because it previously passed.

---

## 8. Existing automation built in this ChatGPT project

The following were intentionally developed so the owner does not need to repeatedly ask "잘 되고 있나?":

### Current-candidate prewrite evidence worker

The worker waits until the latest canonical sales candidate is complete, then automatically chains read-only:

`candidate parity -> mismatch evidence -> promotion gate`

It is pinned to the exact candidate/parity context and stops before CANARY/FULL writes.

### Post-apply purchase-readiness worker

After an explicitly approved FULL apply, it can automatically perform read-only:

`persisted canonical reconciliation -> inventory/cost/purchase-shadow readiness`

It does not create a purchase draft or execute an order.

### Purchase-cycle progress dashboard

Route:

- `/purchase-cycle-progress`

This page was created specifically to make chat/session expiry less harmful.

It should show the high-level state across:

- latest 360-day sales candidate
- parity/evidence
- CANARY/FULL owner boundary
- persisted reconciliation
- verified cost/inventory/purchase Shadow
- final preview/real-order locks

Historical commit:

- `b3141fc6e2d517dafd6a5e74cf5f3c7a84aa6d3b`

Use this page and its underlying readers as the first operator-facing checkpoint rather than reconstructing the stage from memory.

---

## 9. Historical production checkpoint from this ChatGPT room

This section is intentionally dated and must not be treated as today's live state.

On **2026-09-18**, the repaired 360-day candidate request:

- request id: `fe2cbaaf-5408-438c-a36c-2fd755a02681`
- reached `READY_CANARY`
- source event count at that checkpoint: **10,126**
- valid event count: **9,879**
- tombstone count: **247**
- unmapped rows: **0**
- identity conflicts: **0**
- plan fingerprint: `sha256:8cfd9e91ebafe39df9a75128e607aef7ddd666902dfac455d7068febcf7437e9`

That snapshot proves the recovery chain reached a clean candidate at that time.

It does **not** prove the same request is the current candidate on 2026-09-29.

Codex must inspect current `main`, current production, and current persisted state before acting.

---

## 10. Product Launch Tracker/manual data work running in parallel

The owner has been manually filling missing fields in the Product Launch / 상품출시진행관리 flow, including:

- 원가
- B-code
- 상세페이지
- 대표이미지
- 부가이미지
- 카테고리

This is parallel data-quality work.

Rules for Codex:

- do not overwrite owner-entered values with guesses
- do not invent a B-code to fill a blank
- if a B-code already exists in Product Master/Shopling mapping, preserve the canonical identity
- cost must retain provenance; a manually visible value is not automatically verified purchase-cost evidence
- detail-page/image/category completion is not itself a purchase-execution authorization
- missing launch metadata should not silently corrupt purchase identity or cost logic

---

## 11. Approval boundaries

Continue automatically through reversible work.

Stop and ask the owner before:

- Product Master sales-event CANARY if the next step is the actual business write
- Product Master same-plan FULL apply
- actual 1688 order / binding order placement
- payment
- destructive production-data mutation not already explicitly authorized
- a new business/purchase/pricing policy
- security/auth weakening or external exposure
- a materially different risk choice

GitHub branch/PR/test/ordinary merge work is not, by itself, a reason to stop for approval when no business judgment is required.

---

## 12. Duplicate-development prevention

Before adding anything new:

1. inspect current `main`
2. inspect open PRs
3. inspect the existing purchase-cycle pages/workers/tests
4. inspect current Product Master contract
5. inspect live/read-only state
6. determine whether the behavior already exists but is blocked, stale, or unverified

Especially note:

- old open PR #1223 exists for Stage 7 Ops Center integration
- current main has moved substantially since that PR
- do not rebuild Stage 7 from scratch and do not merge the stale branch blindly
- first produce a diff of "still needed / superseded / conflicting"

Do not create a second dashboard, second purchase shadow, second cost truth store, or second scheduler merely because an older chat did not know the current code existed.

---

## 13. Tests and proof standard

Follow `AGENTS.md`.

For this project, a meaningful proof chain may include:

- deterministic unit/regression tests
- relevant GitHub Actions job on the exact PR head SHA
- typecheck/lint/build
- Vercel Production READY
- production read-only endpoint/page
- Supabase persisted evidence
- Product Master readback
- Shopling direct evidence where required

Never collapse these into one statement like "tests passed, therefore production is correct."

Known CI caveat from later project work:

- some purchase-related workflows have historically failed for unrelated/stale expectations while the specific change's core CI passed
- do not ignore failures; determine whether each failure is caused by the branch, already exists on main, or reveals a real regression
- repair relevant regression coverage rather than weakening it

---

## 14. Definition of "done" for Stage 7~11

### Stage 7 done

- verified purchase-cost contract exists
- required consumers use it
- no estimate/cache is promoted to VERIFIED
- relevant current-main CI/live readback proves the integration

### Stage 8 done

- inventory evidence policy is implemented
- trusted baselines/inbound/sales/open commitment are explainable
- provisional/unknown inventory remains fail-closed for execution
- no mandatory full-warehouse stocktake is introduced

### Stage 9 done

- same-context canonical purchase Shadow is reproducible
- open commitments prevent duplicate ordering
- cost/inventory/identity blockers are explicit
- no real order is executed

### Stage 10 done

- target-month preview uses closed funding basis and fresh source data
- the automatic funding cap is calculated from the prior month's normal-sales cost basis; the owner may optionally enter a smaller all-in cash cap for the current Draft
- existing cycle spend and the established freight/fee multiplier are applied
- item/quantity/money preview is stable and auditable, including original and cash-adjusted quantities
- preview remains non-binding

Owner clarification on 2026-09-30: an explicitly authorized pre-close run may be shown as an early read-only preview, but it must remain non-binding and be recalculated from closed data before a real order.

### Stage 11 done

- owner-approved real small order was actually placed
- real receiving occurred
- landed cost and inventory were actually updated
- close/readback checks passed
- evidence exists for the end-to-end real loop

---

## 15. First action for a fresh Codex chat

When the owner creates a new Codex chat and says "이어가자":

1. read the mandatory files in section 1
2. inspect current `main`
3. inspect open purchase-cycle PRs, especially #1223
4. inspect `commerce-os-product-master` current main for the verified-cost contract
5. inspect `/purchase-cycle-progress` or its underlying readers
6. state the **current actual stage**, not the historical stage in this document
7. continue the next reversible development/verification work
8. stop only at the next real owner-action boundary

The first owner-facing response should be short:

- current stage
- what Codex verified
- what Codex will do next
- whether the owner needs to do anything now

If owner action is not needed, say so and continue.

---

## 16. Suggested Codex chat identity

Project/workspace:

**Commerce OS — Purchase Cycle 7~11**

Chat title:

**Commerce OS · 발주사이클 7~11 · 개발·검증**

This scope is deliberately narrower than all of Commerce OS, so monthly-price, sourcing-engine, detail-page generation, and unrelated Shopling work should stay in their own project/chat unless they directly block this purchase cycle.

---

## 17. Live October Draft checkpoint (2026-09-30)

This checkpoint supersedes the older Stage 7 integration warning in section 4.

### Current authoritative Draft

- Draft ID: `fast-purchase-draft:68b2aa56a8a0ac018141`
- cycle month: `2026-10`
- state: `RESERVED` / actual order and payment not executed
- 25 SKU / 2,998 units
- `BGB1-1` is excluded because 1,800 units were already ordered in early September
- approved current Draft product amount: 1,096,655 KRW
- September normal-sales funding basis: 7,833,827 KRW
- gross cost budget: 3,916,914 KRW
- product payment cap after the 1.45 internal order multiplier: 2,701,320 KRW
- remaining product budget: 1,604,665 KRW

Production verification showed the Draft at 40.6% of the product-payment cap and all 25 SKUs covered by a budget verification cost. The 1,096,655 KRW value currently comes from canonical verified/reference purchase costs. It is not a claim that current 1688 prices were read.

### Merged fixes that support this state

- PR #1313 / `b359174f`: use the explicit Draft `cycleMonth` for the budget audit
- PR #1314 / `115d66bd`: use the explicit Draft `cycleMonth` for save, quantity, manual-line, and Product Launch sync paths
- PR #1315 / `fb3a591e`: load Product Master inventory-cost readiness and prefer canonical `effectivePurchaseUnitCostKrw` in the Draft budget audit

The stale Stage 7 PR #1223 was closed on 2026-09-30 after confirming that current `main` already contains its behavior through later integration commit `315b823d` and subsequent production verification. Do not reopen or merge #1223.

### Current Stage 11 boundary

The production Draft has 29 required checks left:

- current 1688 unit price: 25 SKU
- exact Chinese option label: `BAC1-1`, `BAC1-3`, `BAC2-1`
- current 1688 product link: `BAB5-1`

The exact row-by-row work list is in `docs/handoffs/purchase-cycle-stage11-october-draft-input-checklist-20260930.md`.

Historical or reference prices must not be copied into the current-price fields merely to unlock the button. China domestic freight may be entered only from the actual cart/checkout grouping. Actual 1688 order placement and payment still require a fresh action-time owner confirmation.

### Non-blocking warning

The Product Launch reverse sync succeeded. Product Master sync reported a duplicate tracker barcode conflict for `BAB5-1` between Shopling variant IDs `26207749` and `26207750`. Do not delete or reassign either variant by assumption. This warning does not change the approved Draft quantity or amount, but the duplicate identity should be reconciled separately before treating Product Master reverse sync as clean.

---

## 18. Stage 11 development-complete checkpoint (2026-10-02)

Stage 11 implementation and the real operational proof are deliberately tracked separately.

### Development complete

- server and both Draft workspaces now use one shared ORDERED-evidence validator
- ORDERED requires a positive current CNY unit price, an HTTP(S) 1688 link, an exact nonblank China option, and a nonblank 1688 order number
- the simplified funding close still requires no WorldFirst wallet entry, but it automatically carries the already-closed actual total outflow
- a funding close completes the prior-cycle handoff only when its cycle month and Draft ID match the single ordered Draft
- ordered quantity must reconcile with received, explicitly cancelled, and still-open quantities; cancelled units never become inbound stock
- missing physical baselines still follow the owner policy: no compulsory full count, estimated/review inventory until a real sold-out event establishes `SOLD_OUT_RESET=0`
- actual 1688 ordering, payment, or production data mutation was not performed by this development checkpoint

Local proof on the exact branch included 320 purchase-cycle regression tests, focused ESLint, TypeScript typecheck, and a successful Next.js production build. GitHub CI, merge, deployment, and production read-only verification remain the final delivery proof for the associated PR.

### Operational proof still pending by design

The October Draft remains a Draft until the owner later chooses to place a real order. Stage 11 is operationally proven only after that real order proceeds through receipt, Product Master cost write/readback, inventory and sale-state handling, landed-cost close, funding close, and next-cycle handoff. Do not manufacture this evidence and do not copy reference prices into current 1688 fields to unlock the workflow.
