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
- 2026-10-04 owner decision, superseding the 2026-10-03 smaller-cap rule: leaving the purchase cash field blank keeps the prior-month cost-based automatic envelope. Entering cash makes that amount the current all-in cash available for this purchase run; it is not clamped back down to the automatic envelope. A larger amount may restore engine-recommended quantities but must never increase a SKU beyond the engine target.
- when the owner supplies that amount, allocate it deterministically by priority: protect the top 25% at the engine target, start the next 50% at 60%, start the final 25% at MOQ/carton minimum, then top up in priority order without exceeding the engine target
- a cash-adjusted quantity must still honor MOQ/carton units and remain visible as original recommendation -> adjusted quantity; leaving the amount blank preserves automatic-envelope behavior
- owner clarification on 2026-10-03: SKU-count and per-item quantity limits are engine safety ceilings, not operator planning inputs. Keep 100 SKU / 9,999 units as hidden fail-safe bounds and let demand, inventory, commitments, MOQ/carton, priority, and cash determine the visible Draft.

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

### 4.3.1 Cancelled quantity at cycle close (2026-10-02)

The monthly closure reader must distinguish received, explicitly cancelled/released, and still-open quantities. An explicitly cancelled quantity never becomes inbound stock, but it does close that part of the order commitment. Therefore a receipt stage may close only when open quantity is zero and `received + cancelled >= ordered`; requiring `received >= ordered` alone incorrectly reopens a safely cancelled commitment.

### 4.3.2 Draft reservations do not start inbound processing (2026-10-02)

A `RESERVED` or `EXPORTED` purchase-draft commitment may carry an open quantity before any real 1688 order exists. That quantity remains visible as a draft reservation, but it must not count as an actual ordered quantity, an inbound outstanding quantity, or a reason to activate monthly stage 4. The monthly flow advances to barcode and inbound stages only after durable order evidence exists (`orderCount > 0` or a ledger row with `orderedQuantity > 0`).

---

### 4.4 Stage 7~11 detailed handoff

The detailed purchase-cycle conversation decisions and Codex continuation rules are persisted in:

- `docs/handoffs/purchase-cycle-stage7-11-codex-handoff-20260929.md`

That handoff preserves several decisions that must not be lost when chat sessions expire:

- Stage 7 verified purchase-cost evidence exists in Product Master, but Ops Center open PR #1223 is old and must be compared/rebased rather than blindly merged.
- Stage 8 must not require a whole-warehouse stocktake. A real sold-out reset at 0 can create the trusted baseline; verified inbound and canonical sales then maintain the balance. STOCKTAKE is an exception/correction tool.
- Stage 9 purchase Shadow must subtract open/in-transit commitments to prevent duplicate ordering and must remain read-only.
- Stage 10 on/around 2026-10-01 must recalculate from the closed prior month plus fresh sales/inventory/open-commitment evidence and an owner cash cap; a prior preview is not an order.
- Stage 10 cash-cap allocation follows the 2026-10-03 hybrid priority rule above. Preview/Draft creation remains separate from actual 1688 order or payment.
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

For the 2026-09 cycle, GOODSKEY `114981`, `114983`, `115087`, and `115115` were confirmed as obsolete refrigerator-tray duplicates superseded by canonical GOODSKEY `122218`-`122223`. GOODSKEY `119120` was a misidentified legacy listing unrelated to the current `BBC5-3` product master. After sold-out transmission, deletion transmission, internal deletion, and a Shopling readback proving either zero rows or the explicit API deletion tombstone `sale_status=Z`, these five rows may be retired from the monthly ledger without re-registration. This resolution must not be applied to the protected review-hold GOODSKEY `100091`, `116282`, `116855`, `118734`, or `121055`.

### 6.5 Uncertain results

If a transmission response is lost, a popup disappears, or the write acknowledgment is ambiguous:

- freeze as uncertain
- recover the previous token/fingerprint/request identity
- search for the existing result
- do not mint a new write automatically
- do not interpret missing evidence as failure and resend blindly

This protects against double writes.

### 6.6 A21 search-result timing incident (2026-09-30)

- Production recovery for the 2026-09 monthly cycle read 12 review-held GOODSKEY and identified 7 proven price mismatches for a scoped resend.
- A21 then reported `A21_EMPTY_RESULT`, but a direct read-only search for GOODSKEY `100091` on the real A21 list returned 4 rows and `총 조회수 : 4 건`.
- The confirmed failure was a timing error: the list content script converted a missing `총 조회수` marker into zero after a fixed 500 ms delay.
- Extension v0.5.18 submits the legacy search form directly and waits up to 15 seconds for an authoritative `총 조회수` marker. A missing marker is now `A21_SEARCH_RESULT_TIMEOUT`; only an explicit `총 조회수 : 0 건` is empty.
- The v0.5.18 live retry then proved that the A21 POST completes inside Shopling's child frame while the top-level tab remains on `/`. The old 600 ms reassignment could target the pre-navigation document, and `tabs.onUpdated` did not observe the child-frame completion. Extension v0.5.19 removes that timer and resumes the worker from `webNavigation.onCompleted` for the actual Shopling frame document.
- The v0.5.19 live retry found seven true price mismatches but A21 searched only the recent registration-date window and returned no rows. Extension v0.5.20 now enables and verifies A21's all-date filter before every resend search, failing closed before row selection if that filter cannot be confirmed.
- After deployment and extension reload, recover status first. A fresh live resend still requires the normal action-time confirmation and must remain limited to the proven mismatched GOODSKEY.

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
- Warehouse-map direct status commands use the dedicated signed bridge documented in `docs/warehouse-map-stock-status-20261026.md`: live selected-slot ownership and canonical B-code are bound before Ops records or Shopling work, `ON_SALE` preserves quantity, and `SOLD_OUT` uses the existing zero baseline.

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

---

## 18. October Draft replacement recalculation incident (2026-10-03)

The first replacement calculation for Draft `fast-purchase-draft:53d26f59e549704c643b` incorrectly subtracted that Draft's own RESERVED commitments before the recommendation and portfolio-allocation stage. The old lines were removed only after allocation, so 20 valid recommended products were displaced by a different tranche. This was a calculation-order bug, not missing cost or inventory evidence.

The corrected production read-only result contained 37 selected products, 3,222 units, estimated product spend 1,437,258 KRW, missing cost 0, and usable inventory evidence 37/37. It overlapped the existing 47-line Draft by 17 products; 20 products were newly included and 30 old Draft products were no longer recommended by the corrected current engine. Do not add the 20 to the old 47 as a 67-line order. A replacement must use the complete newly calculated set.

Replacement preflight must preserve these invariants:

- read and fingerprint the exact active RESERVED Draft before and after calculation
- account for every old and new B-code as matched, added, or removed
- show every quantity change explicitly
- account for every current purchase candidate as either selected or excluded with a reason
- block Draft saving if either coverage equation is incomplete or the Draft changes during calculation
- include added, removed, and quantity-changed counts in the exact regeneration confirmation

Actual 1688 ordering and payment remain outside this replacement calculation and still require the normal owner decision boundary.
- 2026-10-04 발주 예산 결정: 현금 입력을 비우면 전월 매출원가 자동 예산, 입력하면 해당 총현금을 우선 사용한다. 별도 0~100% 신규상품 소싱 비율을 총현금에서 먼저 예약하며, 남은 총현금만 기존상품 재발주 초안에 사용한다. 큰 금액을 입력해도 엔진 권장수량을 초과하지 않는다.
- 2026-10-12 신규소싱 예산 보완 결정: 기본 신규소싱 비율은 15%이며 이 비율은 의무 지출액이 아니라 최대 배정액이다. 이미 예약된 신규상품 금액과 이번에 안전하게 선택된 후보의 예상 상품대금을 뺀 미사용액은, 소싱 계획 검증이 완료된 경우에만 기존상품 재발주 예산으로 자동 복귀한다. 검증 전 잔액은 기존상품 예산으로 돌리지 않고 대기 상태로 남긴다. 운영자는 발주안 계산 결과 자리에서 비율을 바꿔 같은 후보·옵션 선택을 유지한 채 다시 계산할 수 있다. 비율 변경은 후보 품질, 창고, 월간 품목 상한을 우회하지 않으며 실제 주문·결제를 실행하지 않는다.
- 2026-10-13 월간 발주 준비 자동화 결정: 운영자가 매달 1~28일 중 실행일과 서울 시각을 한 번 저장하면 Commerce OS가 검증된 360일 후보의 안정 구간을 유지하고 최근 45일과 이동 경계만 Shopling에서 다시 읽어 새 후보를 만든다. 최초 기준자료가 없거나 planning fingerprint가 바뀌거나 기준 후보에 미연결·identity 충돌이 있으면 안전하게 360일 전체 읽기로 돌아간다. 진행 중 후보는 나이가 들었다는 이유로 덮어쓰지 않으며, 2시간 이내의 신선한 완료 후보도 중복 수집하지 않는다. 전체 360일 exact audit은 drift 탐지·복구용 별도 절차로 유지한다. 이 일정은 읽기·검증 준비까지만 자동화한다. Product Master CANARY/FULL 원장 반영, 내부 월간 Draft 저장, 1688 주문·결제는 기존의 별도 승인 경계를 유지한다.
- 2026-10-13 발주 사전계산 복구: Product Master FULL 전수 적재가 검증된 뒤에도 발주 화면이 52개 원본 구간과 11,262개 판매 이벤트를 여러 번 다시 조립하다 6초 미리보기 제한을 넘겨 `원본 검증 만료`와 0원 예산을 표시한 문제가 있었다. 발주 화면은 후보 request/report의 불변 지문만 가볍게 읽고, 전수 reconciliation은 요청당 한 번만 공유한다. 정확한 전수 검증은 그대로 유지한다. 12시간을 지난 후보라도 같은 서울 영업일에 FULL readback이 검증됐다면 그날까지 사용할 수 있으며, 다음 영업일에는 다시 만료된다. 이 복구는 읽기·계산만 바꾸며 Draft 저장, 1688 주문·결제 경계는 변경하지 않는다.
- 2026-10-14 내부 Draft 저장 만료 복구: 발주 계산 완료 후 검토하는 동안 Product Master 재고·원가 스냅샷의 15분 제한이 지나면, 내용은 하나도 바뀌지 않았는데 저장 직전 재검증에서 `PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED`가 발생했다. 내부 Draft 준비에서는 정확한 inventory content fingerprint가 유지되는 스냅샷을 다음 서울 날짜까지 재사용한다. 내용 지문 변경·미래시각·둘째 날 경과는 계속 차단하고, 실제 1688 주문·결제 경계는 변경하지 않는다.
- 2026-10-13 FULL 후 planning drift 판정 보완: 판매 후보 생성 뒤 Product Master planning 지문이 바뀌어도 현재 active B-code 전부의 12×30 판매 배열·이벤트 수가 persisted FULL 원장과 정확히 일치하고, 누락·불일치·판매값이 있는 추가 SKU가 0개라면 판매 원장 범위는 동일한 것으로 인정한다. 하나라도 다르면 기존처럼 차단한다. 상품·재고·원가·Draft 저장 조건은 별도 검증을 그대로 유지한다.
- 2026-10-13 발주 화면 연결 보완: FULL 대사가 현재 active 판매 범위를 전수 일치로 증명한 경우 발주 shadow의 최신 planning 지문과 후보 생성 당시 planning 지문이 달라도 동일 판매 범위로 연결한다. Shadow 자체 planning과 발주 우선순위 planning은 여전히 서로 같아야 하며, 전수 일치 증거가 없으면 차단한다. Production 원본 조회의 일시 지연이 20초를 넘겨 정상 결과를 실패로 바꾸지 않도록 읽기 제한을 50초로 늘리고, 결과는 60초간 재사용한다.

---

## 19. SEO 상품 자동등록·물갈이 결정 (2026-10-15)

소유자는 `/seo-bulk-cloud`를 수동 상품 업로드 도구에서 월간 성과와 예외만 확인하는 포트폴리오 자동화로 발전시키기로 결정했다. 기존 샵플링 일괄 대량등록 및 마켓전송, 등록 실패 확인, 오류 체크포인트 재실행 컨트롤은 유지한다.

확정된 단순 정책은 `60일 검증 노출 → 무판매면 90일 휴지 → 새 SEO 버전 재등록`, 최대 3회다. 판매가 한 건이라도 확인되면 보호하며, 3회의 검증된 노출이 모두 무판매일 때만 단종 후보로 올린다. 기술 오류, 실제 미노출, 판매중 readback 부재는 시도 횟수를 소비하지 않는다. 상품별 계절성은 추정하지 않는다. 물갈이는 Shopling/마켓 listing을 대상으로 하며 Product Master 상품 원본을 삭제하지 않는다.

초기 구현은 Shadow 전용이다. 마켓별 최대 등록수와 현재 등록수는 24시간 이내의 검증된 readback이 있어야 하고, 필수 마켓 한 곳이라도 불명확하면 전체 자동 배치를 차단한다. 여러 마켓 동시등록의 안전 수량은 남은 슬롯 합계가 아니라 가장 작은 필수 마켓 슬롯이다. Production migration, 실제 Shopling 품절·삭제·재등록, 스케줄 활성화는 readback collector와 Canary 증거를 확보한 뒤 별도 운영 경계에서 진행한다.

마켓 한도 수집 계약은 상품그룹 레지스트리의 29개 계정을 allowlist로 사용한다. 일부 계정을 읽지 못하면 누락 행을 `unknown`으로 채워 전체 배치를 차단하며, owner+snapshot UUID로 29개 행을 원자 저장한 뒤 같은 식별자로 재조회해 전부 일치해야 성공이다. 저장 결과가 불명확하면 쓰기를 재시도하지 않고 `confirm_needed`로 남긴다. 이 경로는 내부 Shadow 증거만 저장하며 외부 마켓을 변경하지 않는다.

상세 계획과 인수 조건은 `docs/seo-listing-auto-lifecycle-plan.md`를 기준으로 한다.

---

## 20. 발주초안 수량 일괄맞춤 결정 (2026-10-15)

- 중국 발주초안에는 `선택 수량 5·10단위 맞춤`을 제공한다. 선택한 상품 중 제외 대기가 아닌 상품의 수량을 가장 가까운 5개 단위로 정리해 끝자리를 0 또는 5로 만들며, 정확한 중간값은 10개 단위 후보를 우선한다.
- 이 버튼은 화면의 재계산 대기값만 만든다. 운영자가 기존 발주안 재계산 버튼을 누르기 전에는 활성 Draft, 주문·입고 원장, 1688 장바구니와 결제 상태를 바꾸지 않는다.
- 이미 올바른 수동 수량은 유지하고, 명시적으로 제외 대기 처리한 상품은 일괄맞춤에서 제외한다.

---

## 21. 발주초안 상품 선택 범용화 결정 (2026-10-15)

- 표의 체크박스는 `작업할 상품 선택`이다. 체크만 해서는 상품이 삭제되거나 제외 대기가 되지 않는다.
- 선택한 상품에는 `선택 수량 5·10단위 맞춤` 또는 `선택 상품 초안에서 제외`를 각각 적용할 수 있다. 제외는 별도 버튼을 눌러야 대기 상태가 되고, 행에 `제외 대기`를 표시한다.
- 대략 재고·수량 변경·상품 제외·상품 추가를 모두 모은 뒤 `재고상태 저장 후 발주안 재계산`을 눌러야 같은 발주차시의 새 Draft로 교체된다. 그 전에는 주문·입고 원장, 1688 장바구니와 결제를 바꾸지 않는다.
- 2026-10-23 발주주기·예산 결정: 운영 발주는 달력월 1회가 아니라 필요할 때 시작하는 `발주차시`로 관리한다. 새 차시는 가장 최근 입고확정일 이상·이번 발주시작일 미만의 판매 근거를 사용하며, 입고확정일 기록이 없는 과거 자료만 직전 발주시작일을 보조 기준으로 쓴다. 같은 Draft의 재계산은 최초 차시 경계를 유지한다. 예산은 완료된 각 달 정상매출의 50%를 월별로 적립해 남은 금액을 계속 이월한다. 실제 `ORDERED`로 확정한 발주차시의 내부기준 지출만 누적 잔액에서 한 번 차감하고 Draft 생성·미리보기·재계산은 차감하지 않는다. 따라서 같은 달에도 누적 잔액 안에서 여러 번 발주할 수 있다. 메인 발주 화면은 진행 중 차시와 입고확정일별 완료 이력을 보여주며, 기존 월별 Draft·입고·원가·마감 자료는 삭제하지 않는다.
- 2026-10-25 발주차시 경계·자동준비 최종 결정(위 2026-10-23 경계 결정을 대체): 새 차시의 판매수집 시작은 `직전 발주차시 계산 시작일`이며 입고확정일을 사용하지 않는다. 발주 계산 뒤 입고까지 걸린 며칠의 판매가 누락되지 않게 하기 위해서다. `이번 발주차시 시작`을 누르면 총 사용 현금과 신규상품 소싱 비율을 먼저 입력하고, 시스템이 최신 판매·클레임·재고·진행 중 주문을 준비·대조한 뒤 바로 사용자용 발주초안을 연다. 운영자가 사전점검 내부 단계나 `1단계만 확인` 화면을 따로 처리하지 않는다. 정기 월간 준비 스케줄은 폐기하지만 완료월 정상매출 기반 예산 적립, 이월 잔액, 최근 12개월 월매출 판정은 유지한다. 신규상품은 소싱엔진 또는 직접 등록으로 추가하고, 기존상품은 대략 재고·수동 B코드 고정수량·5/10단위 맞춤·제외를 모아 한 번 재계산한다. 이후 `5-1 원가·운임 기록`으로 실제 위안단가와 중국내 운임을 반영해 최종 예산을 계산하고, 예산 안일 때만 `5-2 장바구니 담기`로 확정수량·옵션을 1688 장바구니에 맞춘다. 어느 자동 단계도 1688 주문 제출이나 결제를 실행하지 않는다.
- 2026-10-25 예산 원장 전환·발주 시작 복구: 새 발주차시 원장은 2026년 10월부터 시작한다. 따라서 10월 가용예산은 2026-09 정상매출 50%이고, 10월 이전 월간 시험 Draft·시험 주문은 적립 시작이나 지출 차감에 넣지 않는다. Product Master 기준정보는 과거 원장 전체 대신 발주 계산에 필요한 최근 재고·월별 판매집계·최신 3개 원가·최신 판정만 한 번에 읽고, 운영 연결 지연을 감안해 최대 70초 한 번만 시도한다. 일시 지연이면 최근 72시간 내 저장된 지문·상품수 일치 스냅샷만 사용한다. 같은 준비 단계의 시간초과가 2회 연속이면 브라우저 자동 반복을 멈추고 저장된 단계부터 재개한다. 판매·클레임은 차시마다 새로 읽는다. 입고·원장 전체 상태는 발주 메인 진입 때 자동 조회하지 않고 실제 주문·입고 뒤 명시적 확인 버튼으로 조회해 발주 준비와 원장 조회가 동시에 같은 Product Master 원장을 점유하지 않게 한다.
- 2026-10-26 입고확정 경계·새 추천 재구성 결정(위 2026-10-25 판매수집 시작 규칙을 대체): 새 발주차시의 판매수집 시작일은 `가장 최근 입고확정 차시의 계산 시작일 다음 날`이다. 주문만 했거나 입고가 끝나지 않은 차시와 폐기 Draft는 경계를 옮기지 않으며, 같은 Draft 재계산은 저장된 최초 경계를 유지한다. 새 차시는 이전 Draft의 자동추천을 복사하지 않고 최신 판매·클레임·재고 판정으로 추천을 다시 만든다. 같은 차시 재계산도 사용자가 고정한 상품·수량과 확정 신규소싱은 보존하면서, 최신 판정에서 새로 추천된 입력대기 상품을 우선순위대로 보충한다. 확정원가나 대략 재고 입력이 필요한 최신 추천은 Draft에 표시하고, 운영자가 대략 재고를 선택한 뒤 5-1 원가·운임 확인과 최종 예산 재계산을 거쳐야 5-2 단계로 진행한다.
- 2026-10-26 월간→발주차시 전환 경계 보완: 종전 월간 발주가 2026년 8월 판매분까지 반영했으므로 첫 발주차시의 판매수집 시작일은 `2026-09-01`로 고정한다. 전환 초기에 최근 30일로 임시 저장된 bootstrap Draft도 같은 차시 재계산 시 2026-09-01로 교정한다. 첫 발주차시가 2026-10-26에 계산을 시작하고 실제 발주·입고확정까지 완료되면 다음 차시는 `2026-10-27`부터 계산한다. 월간 구형 원장, 주문만 한 차시, 미입고 차시와 폐기 Draft는 이 경계를 앞으로 옮기지 않는다.
- 2026-10-27 옵션 판매근거 교체 규칙: Shopling 판매수집 요청은 상품 연결 규칙 버전을 저장하며 현재 버전은 `location-suffix-pack-evidence-v4`다. 옵션 자체관리코드를 공용 상품코드보다 우선하고, B코드 뒤 한 글자 위치표시를 제거해 현재 Product Master B코드와 대조한다. 과거 옵션 ID가 사라지고 동일 B코드에 단품·묶음 판매가 함께 있는 경우에는 주문 당시 상품명·옵션명의 `1+1`, `2개입` 같은 명시적 묶음 증거를 사용하며, 묶음 표시가 없는 비어 있지 않은 제목은 단품으로 처리한다. 제목이 없거나 증거가 충돌하거나 현재 Product Master 묶음수량과 맞지 않으면 자동 추정하지 않는다. 과거 연결 규칙으로 만든 구간·완료자료는 새 발주차시에 재사용하거나 Product Master에 반영하지 않고 현재 버전으로 360일 전체 판매자료를 다시 수집한다. 같은 날 만든 Draft가 있어도 최신 판매·클레임·재고·미입고 자료 준비와 대조가 끝난 뒤에만 다시 연다. 이 준비는 Draft 수량을 자동 변경하거나 1688 주문·결제를 실행하지 않으며, 운영자가 대략 재고와 고정수량을 입력한 뒤 재계산할 때 새 판매근거가 실제 발주안에 반영된다.
- 2026-10-27 발주후보 입력대기 전수 노출: 최신 판매판정에서 발주 추천인 상품은 우선순위가 낮더라도 `많음/보통/적음/품절`을 선택하기 전 화면에서 잘리지 않는다. 검토 Draft는 최대 500개 후보를 담을 수 있지만 이는 주문 실행 허용이 아니다. 대략 재고·예산 재계산 뒤 실제 5-1·5-2·주문완료 단계는 기존 100 SKU 안전상한을 계속 적용한다.
- 2026-10-27 대량 재고판정·복수 적재 위치 보완: 검토 Draft의 대략 재고 입력 한도도 화면과 같은 500개로 맞추고, Product Master 식별 조회는 100개씩, append-only 재고 원장 저장은 50개씩 나눠 처리한다. 검증된 물리 적재 위치 별칭은 자동후보뿐 아니라 기존 Draft 스냅샷·내부 수동 재계산 fallback·최종 Draft 저장에서도 같은 대표 B코드로 통합한다. `BBD4-3 → BBD4-2`처럼 같은 비관통형 옵션의 보조 위치는 별도 주문줄이나 추가 수요로 합산하지 않으며, 옵션이 다른 `BBD4-1` 관통형은 별도 상품으로 유지한다.

---

## 22. 수동 추가 상품이 포함된 Draft 재계산 규칙 (2026-10-16)

- 기존 Draft를 새 Draft로 교체할 때 검증하는 스냅샷 수량은 주문·입고 원장의 `openQuantity`를 사용한다. 수동 추가 상품은 다음 자동추천에서 중복 차감하지 않기 위해 `recommendationOpenQuantity`가 0일 수 있지만, 실제 Draft 수량이 0인 것은 아니다.
- 다음 우선순위 계산에서 기존 Draft의 자동추천분을 제외하는 계산은 기존대로 `recommendationOpenQuantity`를 사용한다. 실제 Draft 보존 수량과 자동추천 차감 수량의 용도를 섞지 않는다.
- 재계산이 실패하면 현재 Draft와 화면의 수량 변경·제외·추가 대기를 유지한다. 실제 새 Draft가 생성되고 URL이 교체된 경우에만 완료로 표시한다.
- 2026-10-26부터 실제 B코드 수동 추가는 출처 버전 `2`를 기록한다. 과거 수량 증가 이벤트가 잘못 남긴 `manualAddition=true`만으로는 상품이나 수량을 고정하지 않는다. 출처 버전이 확인되는 수동 추가와 `sourcingConfirmed` 상품만 자동추천 재계산 뒤에도 보존한다.

---

## 23. 발주초안 단종예정 운영 규칙 (2026-10-27)

- 발주초안의 각 상품은 대략 재고 `많음·보통·적음·품절`과 별도로 `단종예정`을 선택할 수 있다. 단종예정은 재고량 판정이 아니라 운영자가 내리는 영구 발주 제외 결정이다.
- `단종예정`을 누른 뒤 재계산하기 전에는 브라우저 임시저장만 하며 현재 Draft, 주문·입고 원장, Shopling 판매상태·재고, 1688 주문·결제를 바꾸지 않는다.
- 재계산하면 기존 append-only 발주전략 원장에 `DISCONTINUE` 이벤트를 기록하고 현재 Draft에서 제거하며 이후 자동 발주후보에서도 제외한다. 남아 있는 재고 판매는 계속한다.
- 같은 요청을 다시 보내도 이미 단종 상태인 B코드는 중복 기록하지 않는다. 잘못 지정한 상품은 기존 영구 발주 제외 복구 절차에서 사유를 남기고 `RESTORE`한다.
- 단종예정 대기값은 대략 재고·수량·임시 제외·추가와 함께 브라우저에 자동 임시저장되어 새로고침 후 복구한다. 단종예정과 대략 재고는 한 상품에 동시에 대기시키지 않는다.

---

## 24. SEO 원클릭 521 이후 마켓전송만 재개 규칙 (2026-10-28)

- 원클릭 작업에서 SEO FINAL과 Shopling 상품등록·실상품 재조회까지 성공했지만 마켓전송 orchestration 저장이 521로 끊긴 경우, 성공한 상품을 SEO 생성이나 Shopling 상품등록부터 다시 실행하지 않는다.
- `/seo-bulk-cloud`의 `기존 등록상품 마켓전송만 재개`는 최신 작업묶음에서 `ready + registration success`인 RUN만 선택한다. 각 업로드 작업은 6개 채널 성공, 6개 고유 goods_key, readback verification 6/6을 모두 증명해야 한다.
- 이미 `claimed`/`submit_armed`인 goods_key, `confirm_needed`/`failed`/`legacy_ignored`인 goods_key, 같은 RUN을 포함한 활성 orchestration이 있으면 중복 전송을 막고 운영 확인으로 돌린다.
- 브라우저가 생성한 고엔트로피 handoff token의 해시를 서버 원장의 고유키로 사용한다. 521처럼 응답만 유실돼도 같은 토큰으로 기존 orchestration을 회수하며 새 작업을 중복 생성하지 않는다.
- 2026-10-28 사고 범위의 검증 fixture는 Shopling 등록 성공 38상품, 기존 goods_key 228개다. Toss 옵션명 오류 2상품과 SEO 생성 실패 1상품은 이 재개 범위에 넣지 않는다.
