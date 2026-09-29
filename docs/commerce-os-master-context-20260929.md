# Commerce OS master context — conversation decisions persisted 2026-09-29

## Why this document exists

This document persists the important architecture, operating rules, product intent, Shopling behavior, purchase-cycle decisions, Local Agent direction, and unresolved state that were established across many ChatGPT conversations but were not guaranteed to exist in GitHub.

It is a context document, not a replacement for code or tests. Current `main`, real production evidence, and the owner's latest explicit instruction override older text here.

---

## 1. North star

Commerce OS is intended to become an operating system for the owner's import/wholesale/retail business, not a collection of unrelated helper screens.

The long-term direction is:

`source / import -> purchase -> arrival -> confirmed cost -> inventory -> product master -> Shopling/channel state -> sales -> pricing -> replenishment -> exception handling`

The system should progressively remove manual labor from this loop.

The owner should eventually spend time on:

- policy/strategy
- unusual exceptions
- high-impact approval boundaries
- expansion decisions

and not on repetitive data collection, browser clicking, reconciliation, or re-running known procedures.

A recurring product principle is:

> build the system so the owner sees exceptions, not routine work.

The target is a one-button / near-zero-touch Commerce OS, but every step must be earned through evidence and staged gates rather than skipping directly to blind automation.

---

## 2. System architecture and source-of-truth direction

The system is converging on a shared Product Master and canonical operating ledger.

Important identity concepts used in the project include:

- Shopling GOODSKEY
- B-code / model number
- barcode / internal option/location code
- marketplace product code
- product option identity

The architecture should prefer explicit mappings and canonical IDs over fuzzy UI text matching.

Core engines should ultimately share the same trusted inputs:

- canonical sales
- verified inventory
- confirmed landed/import cost
- protected cost / margin floor
- in-transit purchase quantity
- MOQ/carton constraints
- lead time
- marketplace/channel registration state

Do not create a second competing truth store merely to make one screen easier to implement.

When data is uncertain, preserve uncertainty instead of filling gaps with convenient defaults.

---

## 3. Automation philosophy

### 3.1 Safety ladder

The recurring rollout model is:

`Shadow -> reconciliation -> Canary -> Auto`

A feature is not "automatic" merely because code can click a button.

Before full auto, prove:

- input scope
- exact identity mapping
- correct target row/control
- write acknowledgment
- post-write readback
- retry/idempotency behavior
- restart/reconnect behavior
- no duplicate execution

### 3.2 Fail closed

When exact state cannot be proven:

- do not guess
- do not overwrite with an inferred value
- do not blindly resend
- do not silently classify as success

Use explicit blocked/held/uncertain states and collect evidence.

### 3.3 User intervention should be rare

Ordinary development, test, PR, merge, and reversible implementation should continue without asking the owner to approve every mechanical step.

Ask only when a real policy or irreversible boundary exists.

### 3.4 Every real bug should become permanent regression coverage

A production failure or operator mistake should leave behind a deterministic test or CI invariant whenever testable.

This principle is also encoded in `AGENTS.md`.

---

## 4. Purchase-cycle intent

The purchase-cycle work is not just a reorder calculator. It is the operating loop that connects verified sales, verified inventory, confirmed import cost, current purchase/in-transit quantity, cash limits, and replenishment decisions.

### 4.1 Core operating inputs

Recurring rules discussed for the real import operation include:

- nominal import lead time: about 14 days
- order budget should be cash-aware, not based on unlimited theoretical demand
- historical shorthand used in operations: previous-month sales / 2 as a practical budget reference
- logistics/order coefficient has historically been around 1.4-1.5 where applicable
- small test orders are preferred before scaling uncertain SKUs
- cash-only purchasing is preferred when cashflow is constrained

These are operating heuristics, not permission to bypass the canonical purchase-cycle engine.

### 4.2 Purchase safety boundary

"발주 확인" / purchase preflight is initially evidence and decision support.

It may:

- read canonical sales
- read verified inventory
- read confirmed landed cost
- account for existing in-transit quantity
- apply MOQ/carton/lead-time constraints
- calculate a purchase draft
- record a sourcing/purchase-list acknowledgment

It must not silently perform:

- 1688 checkout
- payment
- binding purchase order execution

unless the owner has explicitly moved that boundary to automation.

The current purchase-cycle preflight documentation intentionally keeps the real order/payment boundary outside the read-only preparation screen.

### 4.3 Purchase-cycle completion standard

A purchase-cycle stage is not "done" because a simulated calculation passes.

Operational completion requires evidence across the real loop:

`purchase decision -> actual order -> partial/full arrival -> confirmed landed cost -> inventory update -> Shopling sales state -> cash/cost close`

Code-only or mocked success must not be reported as a real operating pass.

---

### 4.4 Stage 7~11 detailed handoff

The detailed purchase-cycle conversation decisions and Codex continuation rules are persisted in:

- `docs/handoffs/purchase-cycle-stage7-11-codex-handoff-20260929.md`

That handoff preserves several decisions that must not be lost when chat sessions expire:

- Stage 7 verified purchase-cost evidence exists in Product Master, but Ops Center open PR #1223 is old and must be compared/rebased rather than blindly merged.
- Stage 8 must not require a whole-warehouse stocktake. A real sold-out reset at 0 can create the trusted baseline; verified inbound and canonical sales then maintain the balance. STOCKTAKE is an exception/correction tool.
- Stage 9 purchase Shadow must subtract open/in-transit commitments to prevent duplicate ordering and must remain read-only.
- Stage 10 on/around 2026-10-01 must recalculate from the closed prior month plus fresh sales/inventory/open-commitment evidence and an owner cash cap; a prior preview is not an order.
- Stage 11 is complete only after a real owner-approved small order, real receiving, confirmed landed cost, inventory update, and close/readback evidence.
- CANARY/FULL Product Master writes and actual order/payment remain explicit owner-action boundaries.
- When owner intervention is required, explain the action simply at roughly Korean high-school freshman level and give exact 1~3 actions plus a completion signal.

## 5. Shopling automation model

Shopling is a legacy UI with frames, popup windows, old JavaScript handlers, and different screens that can contain similarly named controls.

The project learned repeatedly that screen guessing is unsafe.

Prefer evidence from:

- exact DOM controls
- exact forms
- exact frame
- opener/child relationship
- explicit completion text
- Accessibility/CDP evidence where needed

### 5.1 Important Shopling screens used in this project

Names used in the project include:

- A4: 상품조회수정
- A6: option/inventory related search/state flow used by stock automation
- A21: 쇼핑몰상품수정 / marketplace modification transmission

Do not assume an A21 screen is equivalent to A4 just because both display product information.

### 5.2 Popup/window completion behavior

For write workflows, the system has historically needed to track child windows and popup relationships explicitly.

A successful operation should not be acknowledged merely because a popup appeared.

Where applicable, confirm:

- the expected completion message
- no remaining "processing" state
- stable final DOM/readystate
- correct job/frame identity

Only then acknowledge success and close managed result windows.

---

## 6. Monthly price-adjustment system

### 6.1 Current contract

As of this context snapshot:

- A21 extension version in the current continuation branch: **0.5.16** (`main` remains at 0.5.15 until this change is merged)
- monthly price policy constant: `MONTHLY_CONFIRMED_COST_OPTION_AWARE_INCREASE_ONLY_V2`
- marketplace price verification uses dedicated registered-market evidence rather than price-setting evidence

### 6.2 Price and option are one business operation

The owner explicitly requires option prices to participate in price adjustment.

The system must not update only the base price while leaving option deltas inconsistent.

The intended transmission sequence is price-aware and option-aware.

Where sold-out state must temporarily change to allow transmission, the guarded sequence is conceptually:

`temporary selling status -> PRICE -> OPTION -> restore original sold-out state when required`

A prior-stage failure must block dependent later stages.

### 6.3 Protected pricing

Price plans use confirmed cost / protected-cost logic.

Do not lower a value merely to force a match when the current policy is increase-only/protection-oriented.

Ambiguous option mapping, cost mismatch, missing evidence, or uncertain transmission result must block the write or hold the item.

### 6.4 Batch and retry behavior

The A21 monthly path has evolved toward:

- large batch handling, historically up to 200 GOODSKEY per batch
- phase-aware limited parallelism rather than uncontrolled multi-window concurrency
- retries that narrow the failure scope
- failed goods isolated from already successful goods
- after repeated terminal failure, separate deletion/re-registration handling rather than endlessly resending

Never re-send already proven-successful goods just because some other goods in the original batch failed.

### 6.5 Uncertain results

If a transmission response is lost, a popup disappears, or the write acknowledgment is ambiguous:

- freeze as uncertain
- recover the previous token/fingerprint/request identity
- search for the existing result
- do not mint a new write automatically
- do not interpret missing evidence as failure and resend blindly

This protects against double writes.

---

## 7. Authoritative final marketplace-price verification

This is one of the most important persisted decisions.

### 7.1 What is NOT final evidence

The Shopling page/tab that contains "쇼핑몰별 상품가격 설정" is a target/configuration surface.

It can be used as preimage/setting evidence.

It is **not** by itself proof that the live marketplace currently has that price.

Likewise, a generic A21 transmission success/failure result is process evidence, not the final source of truth for current mall price.

### 7.2 What IS final evidence

The owner manually demonstrated the real Shopling path.

The intended final verification flow is:

1. enter **A4 상품조회수정**
2. use the row labeled **검색항목**
3. choose **샵플링상품코드**
4. enter the exact GOODSKEY in the adjacent search input
5. press that same row's **검색** button
6. confirm the actual result row for the GOODSKEY
7. check the checkbox labeled exactly **상품이 등록된 쇼핑몰 보기**
8. press **검색** again with the same GOODSKEY
9. read the inline **등록된 쇼핑몰** table
10. ignore deleted/inactive rows for the live match
11. use **판매중** rows' **몰판매가** as the final current marketplace-price evidence

Important columns observed in the live table include:

- 상태
- 사이트
- ID
- 몰상품코드
- 몰상품명
- 몰판매가

The final comparison is:

`Commerce OS expected target price <-> A4 registered-mall table selling-row 몰판매가`

Only mismatched GOODSKEYs should move to reprocessing.

### 7.3 Historical mistakes that must not regress

The automation previously made or risked these wrong assumptions:

- opening A21 and expecting the A4 registered-mall checkbox
- treating a separate detail/modify page as the required path
- looking for a non-existent "등록된 쇼핑몰 보기" button
- clicking **상품이미지보기** because checkbox text extraction accidentally included neighboring labels
- choosing a screen-output/sort **샵플링상품코드** selector instead of the **검색항목** selector
- treating an input value containing GOODSKEY as proof that a real result row existed

Regression protection should preserve these distinctions.

---

## 8. Current Shopling price incident

### 8.1 Live state

After extension v0.5.15, the owner observed:

`MONTHLY_PRICE_REGISTERED_MALL_VIEW_REQUIRED:SEARCH_RESULT_NOT_FOUND`

Live A4 inspection on 2026-09-29 found the concrete cause:

- A4 defaults to a seven-day registration-date range.
- `s_dt` and `e_dt` are read-only inputs.
- v0.5.15 tried to edit those inputs, but its editable-input filter rejected them.
- Therefore older GOODSKEY searches stayed limited to seven days and produced `SEARCH_RESULT_NOT_FOUND`.

The current branch contains v0.5.16, which checks A4's native `all_srch_no_term_btn` (`전체`) before searching. A live read-only audit of the five remaining September review items found:

- `100091`: three visible `판매중` rows, all `400원`; these rows belong to malls outside this item's inferred retail target set, so the missing expected retail rows remain unresolved.
- `116282`: one visible `판매중` 도매꾹 row at `16,770원`, matching the applicable target.
- `116855`: one visible `판매중` 도매꾹 row at `710원`, matching the applicable target.
- `118734`: visible `판매중` rows for 옥션, 지마켓, 11번가, 쿠팡, and 카카오톡 스토어, all `8,450원`, matching their targets; the 스마트스토어 row was `품절`.
- `121055`: the base price was already the target `13,420원`, but A4 rendered no registered-mall detail table.

The visible active prices do not prove every planned mall because A4 omits unregistered or otherwise absent mall rows. Those missing rows must remain `UNCERTAIN` and must not receive an automatic resend capability. v0.5.16 now converts a stable `REGISTERED_VIEW_RESULT_NOT_FOUND` into an empty registered-market observation, allowing the batch to continue while the server safely keeps that item unresolved.

PR #1291 deployed v0.5.16, the owner installed it, and the saved five-item production readback completed on 2026-09-29 without halting. All five items remained `RESENDING` with `MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED`; no item received a fresh resend capability because the available A4 rows did not prove every planned mall. This is the intended fail-closed result, not a transmission failure.

The continuation after that run also found a report-consistency edge case: a batch can be terminal while one of its item rows still says `RUNNING` or `STARTING`. Such a row must never be recorded as transmitted. The current continuation normalizes it to `PARTIAL_FAILURE`, keeps it review-required, and shows an explicit operator message. The permanent browser regression scenario is `terminal-batch-running-row-held-for-review` in `scripts/monthly-price-browser-check.mjs`.

The current UI error is too coarse to support efficient debugging by itself.

Do **not** continue the old pattern of:

`one coarse error -> guess a selector -> publish another extension -> ask owner to retry`

without collecting richer evidence first.

### 8.2 Captured evidence and next gate

Captured from the live A4 page:

- URL: `https://a.shopling.co.kr/prod/prodLst.phtml`
- form: `form[name="frm"]`, POST to the same A4 URL
- search selector: `select[name="srch_tp"]`; `샵플링상품코드` has value `B`
- search input: `input[name="srch_txt"]`
- exact search control: `input[type="button"][value="검색"]` with `onclick="frm_submit();"`
- registered-mall checkbox: `input#shop_YN[name="shop_YN"]`
- all-period checkbox: `input#all_srch_no_term_btn[name="all_srch_no_term_btn"]`
- date inputs: `#s_dt` and `#e_dt`, both read-only
- live proof: all five remaining review GOODSKEYs appeared after `전체` was enabled; four exposed registered-mall tables, while `121055` exposed only its exact product row and base price

The registered-mall table exposed the expected columns (`상태`, `사이트`, `ID`, `몰상품코드`, `몰상품명`, `몰판매가`). v0.5.16 has now processed the saved five-item review scope in production. The next safe engineering step is to merge the terminal-row consistency hardening; the owner does not need to rerun the five-item scope merely to prove the same missing-mall state again.

This evidence should be generated by Local Agent where possible.

---

## 9. Local Agent direction

### 9.1 Phase 1

Windows Commerce OS Local Agent phase 1 was implemented and merged via PR **#1285**.

The fixed repository path is:

`C:\Users\andy0\OneDrive\문서\Commerce OS\commerce-os-ops-center`

The Local Agent is designed to run independently of ChatGPT Work/Codex.

Phase 1 responsibilities include:

- heartbeat / `latest-status.json`
- PC/agent state
- Chrome presence
- Chrome DevTools availability
- Shopling tab/URL
- A21-detectable state where available
- current automation stage / last error
- diagnostic bundles
- DOM summary
- checkbox/search state
- screenshot where possible

Windows automatic startup uses Scheduled Task.

### 9.2 Local Agent security boundary

The Local Agent must not become an unrestricted remote shell.

Permanent rules:

- no generic remote shell execution
- no logging passwords/cookies/session tokens/secrets
- no silent price/inventory/sales-status mutation from diagnostic mode
- no externally exposed Chrome debug port
- CDP should remain localhost-only
- production DB schema changes require explicit approval
- remote commands, when added, must be a strict whitelist of Commerce OS operations

### 9.3 Phase 2 target

The intended next architecture is:

`Windows Local Agent -> Supabase status/diagnostics -> Commerce OS / assistant visibility -> whitelist command queue -> Local Agent executes approved operation -> evidence uploaded`

Examples of future whitelist operations may include:

- capture status
- capture Shopling diagnostic
- restart a known Commerce OS worker
- reload a known extension path
- retry a known safe verification step

They must be typed commands with validated arguments, not arbitrary command strings.

Use bounded retry/backoff and idempotency.

---

## 10. Desired debugging workflow going forward

The system should make the owner stop acting as a manual screenshot courier.

Preferred incident loop:

1. automation fails
2. Local Agent records the exact stage and evidence
3. diagnostic bundle uploads or becomes queryable
4. developer/assistant reads the evidence
5. fix is made on a feature branch
6. deterministic regression test reproduces the old failure
7. CI passes
8. normal PR/merge/deploy completes
9. Local Agent re-runs the safe verification
10. owner is involved only if login/CAPTCHA/business judgment is required

This is a major project direction, not an optional convenience feature.

---

## 11. Stock / sale-state automation principles

Separate but related Shopling stock-state automation has established reusable principles:

- resolve B-code/model identity to exact Shopling GOODSKEY before mutation
- use the exact A4/A6/A21 role required by the operation
- never mutate before the required screen/frame is actually ready
- multi-GOODSKEY work should be serial or otherwise explicitly bounded
- partial success must be persisted so a retry continues from the remaining scope
- completion requires the expected final Shopling evidence, not merely a click
- failed/uncertain scope should stop safely rather than cascade into later writes

The validated price-extension execution structure can be reused, but never assume stock and price screens have identical DOM.

---

## 12. Business/operator UX principles

The owner is not trying to become the manual operator of a complex admin console.

Default UI should:

- show a simple business action
- hide low-level technical detail
- preview expected impact before a write
- show concise rationale by B-code/product
- surface only actionable exceptions

Advanced diagnostics can remain available under a deeper panel.

Technical terms such as request IDs, batch internals, DOM evidence, and retry tokens belong primarily in diagnostics/audit views.

---

## 13. Development/merge workflow

The preferred implementation loop is:

1. inspect current `main`
2. inspect direct production/live evidence
3. create isolated feature branch/worktree
4. make the smallest correct change
5. add/maintain regression coverage
6. run focused tests
7. run relevant CI/typecheck/build/lint where applicable
8. fix failures, do not weaken tests
9. create PR
10. if no owner judgment is needed and required checks/evidence are satisfied, merge rather than stopping only to ask for permission
11. verify production deployment/live behavior where possible
12. update persistent handoff/current-state documentation

Do not report "done" when only code editing is complete.

---

## 14. Owner decision boundaries

Codex/automation should stop and ask for owner judgment when the next step involves:

- actual 1688 ordering/payment
- destructive deletion or irreversible production-data mutation not already explicitly authorized
- production DB schema change without prior approval
- a new pricing/business policy
- accepting a risk tradeoff that changes customer/channel behavior
- firewall/security exposure
- credential/authorization weakening
- a choice between materially different business outcomes

Routine reversible engineering and verification should continue autonomously.

---

## 15. Practical continuation instructions for a fresh Codex session

When the owner says "이어서 진행해" or "계속해":

1. read `AGENTS.md`
2. read `docs/CODEX_START_HERE.md`
3. read this document
4. inspect current `main`, open PRs, CI, and the subsystem's current tests
5. inspect current Local Agent status/diagnostics if the issue is browser/Shopling related
6. continue from the latest unresolved evidence rather than recreating the project plan

For the current Shopling monthly-price blocker, the next correct move is **diagnosis first**, not another selector guess.

---

## 16. Context maintenance rule

This file should be updated when a project-level decision changes.

Do not use it as a running log of every commit.

Persist only decisions that a future session would otherwise have to rediscover:

- authoritative source of truth
- safety invariant
- user interaction boundary
- system architecture
- final UI path learned from real operation
- current unresolved blocker and the next evidence required


---

## 17. Product Master / B-code / warehouse reconciliation

A separate persistent operational handoff now exists at:

- docs/product-master-bcode-warehouse-handoff-20260929.md

Read that document before changing Product Master option identity, B-codes, warehouse slots, or physical-stock confirmation.

Project-level rules learned from the recovery work:

- direct owner warehouse confirmation outranks assumed allocation and stale spreadsheets
- operator_assumed_stocked must not be treated as physical proof
- discontinued product state does not automatically prove that its warehouse slot is physically empty
- held locations are placeholders, not physical truth
- one logical SKU may occupy multiple physical slots while keeping one primary B-code
- B-code mutation can change the canonical 12-digit option barcode identity; preserve trigger semantics and verify the resolved identity
- product_launch_options changes must be reflected through item/tracker/workspace mirrors and Product Master/warehouse state as applicable
- categories are owner-controlled and must not be altered in B-code recovery
- no Shopling or marketplace write is implied by internal warehouse reconciliation

Direct physical confirmations already established include:

- AAA251 스틱형 눈마사지기: BDG1-3 / BDG2-1 / BDG2-2
- AAA240 그레이닝툴 패드: BDG2-3 / BDG3-1
- AAA030 멀티탭 트레이: black BDE1-1; white BDE1-2 + BDE1-3

The AAA030 correction is an important current checkpoint: Commerce OS launch state was corrected, but the Product Master / warehouse-map write could not be verified because the Product Master Supabase connection repeatedly timed out. A fresh session must inspect live state first and must not blindly replay the write.

The dedicated handoff also contains:

- operator-assumed location assignments still awaiting physical confirmation
- unresolved warehouse-search models
- historical B-code conflicts
- sold-out / held cleanup state
- recently discontinued products that must not be resurrected
- shared-B-code exceptions and deferred conflicts
