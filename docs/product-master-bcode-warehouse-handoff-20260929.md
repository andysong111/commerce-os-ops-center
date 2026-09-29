# Product Master / B-code / Warehouse handoff — 2026-09-29

## Purpose

This document persists the operating context built in a long ChatGPT-assisted product-master / B-code / warehouse cleanup session.

Use it when work touches:
- 상품출시진행관리
- Product Master
- B-code / option barcode identity
- warehouse slot allocation
- physical stocking confirmation
- discontinued / sold-out cleanup
- legacy stock-sheet recovery

This is an operational handoff, not a substitute for current code or live data.

Source priority when evidence conflicts:
1. owner's latest explicit instruction
2. direct physical warehouse confirmation from the owner
3. current warehouse map + confirmed occupant evidence
4. current Product Master SKU state
5. current Commerce OS normalized launch state
6. 실재고 상품 관리표
7. 동네일등 중국 주문,출발
8. historical Shopling grouping / old tracker state

Never infer a physical B-code from option order, model sequence, or a legacy numeric location.

---

## 1. Operator interaction rules

The owner is a business operator, not a developer.

When owner intervention is actually needed:
- explain in high-school-level Korean
- keep it short
- say exactly what must be checked or clicked
- keep the owner oriented in the workflow
- ask only when ambiguity blocks a safe write or a real business decision is required

Do not repeatedly ask for permission for ordinary reversible engineering.

For this workflow the owner usually wants: "계속 진행하고 내 개입이 필요하면 이야기해."

Always show model number + product name together when asking the owner to find or verify an item in the warehouse.

---

## 2. Non-negotiable business rules

### Categories

The owner owns category decisions.

Never alter product categories in this workflow.

### Shopling / marketplace write boundary

Do not write to Shopling or marketplaces merely because internal product/B-code data was fixed.

- no Shopling write unless explicitly requested
- no marketplace write unless explicitly requested
- no inventory quantity write unless explicitly requested

### Physical truth beats assumed allocation

Earlier in this recovery workflow the owner explicitly allowed new locations to be allocated while "assuming stocked".

Therefore many recent slots are marked occupied/confirmed even though they were only operator-assumed.

When the owner later physically checks a slot:
- direct physical confirmation overrides the assumed allocation
- move/release conflicting speculative locations
- mark direct confirmation as operator_physical_confirmation
- preserve an audit trail

Do not treat operator_assumed_stocked as equal to a physical warehouse check.

### Discontinued does not automatically mean physically empty

If the owner says a product is discontinued:
- archive/discontinue the logical product
- deactivate synthetic SKUs where appropriate
- do not automatically clear an occupied warehouse slot unless physical emptiness is also confirmed

This rule was intentionally used for AAA222 and AAA288.

### Sold-out placeholder semantics

For a currently sold-out item with no verified physical stock:
- use held, confirmed=false, only when a placeholder location is intentionally allocated
- direct physical use of that slot by another product overrides the placeholder
- release the held assignment safely and restore the logical OPTION barcode identity if needed

### Warehouse areas

- small-slot operating area has been described by the owner as roughly BBA ~ BEH
- large items use L slots such as BGA positions
- construction zone BFA ~ BFF is unusable until the owner explicitly reopens it
- query live slot state before allocating; never rely on an old candidate list

---

## 3. Core data model used in this recovery

### Commerce OS / launch side

Important tables:
- product_launch_items
- product_launch_options
- option_barcode_registry
- product_launch_tracker_states
- product_launch_workspaces
- commerce_operation_runs
- legacy_seo_canonical_prices

Important product_launch_options behavior:
- option B-code lives in barcode
- 12-digit canonical option barcode lives in option_barcode_no
- identity lives in option_barcode_identity_key
- payload mirrors barcode / stock state / prices / extra warehouse locations

Two important triggers exist:
- sync_product_launch_option_barcode_columns()
- refresh_product_launch_item_option_barcodes()

Changing a B-code can change the 12-digit option barcode number because B-code identity is canonical.

When releasing a temporary B-code and returning an option to logical OPTION identity:
- clear barcode
- remove stale optionBarcodeIdentityKey
- remove stale optionBarcodeNo
- remove stale optionBarcodeIdentityKind
- let the trigger resolve the original OPTION identity/number
- verify the result before continuing

After option mutation, also keep these mirrors consistent:
- product_launch_items
- item_payload
- summary_payload
- tracker state items
- tracker list snapshot summaries
- workspace source_state_updated_at

### Product Master / warehouse side

Important tables:
- products
- skus
- sku_barcode_history
- sku_source_mappings
- storage_map_slots
- storage_map_slot_occupants
- storage_map_commands
- storage_map_events

Slot states used in this project include:
- empty
- occupied
- held
- reserved
- blocked
- conflict

For physical confirmation:
- slot = occupied
- occupant = confirmed=true
- source should distinguish direct operator confirmation from assumed stocking

---

## 4. Multi-slot storage rule

A single logical SKU can physically occupy multiple warehouse slots.

Current pattern:
- the SKU keeps one primary B-code in skus.barcode
- additional physical slots may point to the same SKU
- launch payload records warehouseLocations and additionalWarehouseLocations
- every physically occupied slot should have a confirmed occupant

Do not create duplicate logical options merely because one SKU uses multiple slots.

### AAA251 스틱형 눈마사지기

Direct owner physical confirmation on 2026-09-22:
- primary BDG1-3
- additional BDG2-1
- additional BDG2-2

Old assumed location BDG3-2 was released.

The three slots had previously been speculative held positions for AAA228 and were released/reassigned.

### AAA240 그레이닝툴 패드

Direct owner physical confirmation on 2026-09-22:
- primary BDG2-3
- additional BDG3-1

The BDG3-1 placeholder for sold-out AAA249 was released.

### AAA030 멀티탭 트레이

Latest direct owner correction on 2026-09-28:
- 블랙40cm -> BDE1-1
- 화이트 40cm -> BDE1-2 + BDE1-3
- white primary should be BDE1-2
- BDE1-3 is an additional white slot

This supersedes the previous assumed mapping:
- old white BDE1-1
- old black BDE1-2
- old AAA038 blue BDE1-3

Commerce OS launch state was successfully corrected to the new mapping.

Product Master / warehouse-map reconciliation completed on 2026-09-29 after a fresh read proved that the earlier timed-out write had not applied.

Verified final state:
- BDE1-1
- BDE1-2
- BDE1-3
- BDE2-1
- AAA030 SKUs
- AAA038 SKUs
- BDE1-1 -> AAA030 멀티탭 트레이 / 블랙40cm, direct physical confirmation
- BDE1-2 -> AAA030 멀티탭 트레이 / 화이트 40cm primary, direct physical confirmation
- BDE1-3 -> same AAA030 화이트 40cm SKU as additional slot, direct physical confirmation
- AAA038 실리콘 악력볼 / 블루 -> `미배정`, no warehouse occupant; logical option barcode identity `000000000763` preserved
- AAA038 실리콘 악력볼 / 레드 -> BDE2-1 remains operator-assumed, not upgraded to direct confirmation

Audit request:
- `6c6ce247-90a1-4620-a951-8aada24c60dc`
- action `reconcile_physical_location_confirmation`
- three `sku_barcode_history` rows record white, black, and blue changes
- no Shopling write, marketplace write, inventory-quantity write, or external-sync outbox row was created

---

## 5. Important shared / exceptional B-code decisions

### AAA213 엄지발가락 보호대 A형

Owner confirmed both logical options share the same physical SKU/location:
- 대형1쌍 -> BDB6-1
- 소형1쌍 -> BDB6-1

Do not split these into separate physical B-codes unless owner changes the rule.

### Other preserved special decisions

- AAA100: all existing options intentionally share BCA5-1
- AAA193: 1P and 4P are the same physical unit at BAE3-3; 4P means four base units. Runtime multiplier semantics are still unresolved.
- AAA142: only 나뭇잎 is current sale; do not auto-restore other designs
- AAA155: black 1P only at BAC6-1; red/navy/gray were to be sold out
- AAA098: owner intended sold-out; do not alter AAA164 merely because of historical BDB1-3
- AAA059: black discontinued; brown is the valid current variant at BDC3-3
- AAA129: conflict is explicitly deferred
- AAA189: explicitly deferred
- AAA206: explicitly deferred

Do not re-open deferred conflicts unless the owner raises them or new direct evidence requires it.

---

## 6. Direct physical confirmations already completed

These do not need to be re-asked unless new warehouse evidence conflicts:

| Model + product | Direct physical result |
|---|---|
| AAA251 스틱형 눈마사지기 | BDG1-3, BDG2-1, BDG2-2 |
| AAA240 그레이닝툴 패드 | BDG2-3, BDG3-1 |
| AAA030 멀티탭 트레이 | black BDE1-1; white BDE1-2 + BDE1-3 — launch and Product Master/map verified 2026-09-29 |

AAA213 엄지발가락 보호대 A형 at BDB6-1 had prior actual-stock evidence and shared-location owner confirmation.

---

## 7. Operator-assumed allocations that still need physical confirmation

The following were allocated during recovery under the owner's earlier instruction to assume stocked.

Do not call these direct physical confirmations until the owner verifies them in the warehouse.

| Model + product | Assumed locations |
|---|---|
| AAA006 안전 야광 밴드 | yellow BDE3-3; orange BDE4-1 |
| AAA007 안전 조끼 | BDE4-2 |
| AAA014 실리콘 골무 | purple M BDE4-3; sky S BDE5-1 |
| AAA022 고리형 실리콘 공병 90ml | gray BDE5-2; sky BDE5-3; dark blue BDE6-1; light green BDE6-2; ochre BDE6-3 |
| AAA038 실리콘 악력볼 | red BDE2-1 assumed; blue location now unresolved |
| AAA039 구리링 보풀제거기 | BGA1-2 large |
| AAA065 뚜껑밀봉클립 | BGA1-3 large |
| AAA068 린넨 선글라스케이스 | purple BDE2-2; gray BDE2-3; khaki BDE3-1 |
| AAA069 고리형 선글라스케이스 | random BDE3-2 |
| AAA086 동물 필통 | otter BDF1-1; platypus BDF1-2; hummingbird BDF1-3; shark BDF2-1 |
| AAA103 차량용 무지 트레블백 | black BDF2-2; brown BDF2-3; beige BDF3-1 |
| AAA115 플라워 고무줄벨트 | black BDE7-1; white BDE7-2; blue BDE7-3; gray BDE8-1 |
| AAA116 옷수선 엔틱 금단추 | black17 BDE8-2; black20 BDE8-3; black23 BDF3-2; gold17 BDF3-3; gold20 BDF4-1; gold23 BDF4-2 |
| AAA145 자동차 유리닦이 | random BDF4-3; refill cloth 2P BDF5-1 |
| AAA152 풀페이스 김서림방지 보안경 | BGA2-1 large |
| AAA160 박스테이프 디스펜서 | BDF5-2 |
| AAA163 극세사 변기커버 | random BDF6-1 |
| AAA182 닭물통A형 520ml | BDF6-2 |
| AAA209 머플러 D형 | black BDF6-3; brown BDF7-1; gray BDF7-2 |
| AAA275 리본 선물박스 A사이즈 | 12.5x12.5x5 BDG4-3; 17x12x6.5 BDG5-1; 15x15x7 BDG5-2 |
| AAA278 아연합금 게고리 | black BDG5-3; red BDG6-1 |
| AAA281 카피바라인형 | 20cm BGA2-2; 35cm BGA2-3 — large |
| AAA296 헤드레스트 폰거치대 | BGA3-1 large |
| AAA336 높이조절 노트북 받침대 | BDG6-3 |
| AAA348 로고 버킷햇 | gray BDG7-1; beige BDG7-2; pink BDG7-3; brown BDG8-1 |
| AAA358 여성 체크아이스팬츠 프리사이즈 | red BDG8-2; black BDG8-3; brown BDH1-1 |

When the owner confirms a location physically, upgrade it to direct confirmation and remove it from this queue.

---

## 8. Warehouse search / unresolved-location queue

These products still need physical warehouse investigation unless newer evidence exists.

### No reliable current B-code

| Model + product | Need |
|---|---|
| AAA038 실리콘 악력볼 | find blue location; red currently assumed at BDE2-1 |
| AAA372 미스트공병 | locate 30ml / 60ml / 80ml / 100ml / 120ml |
| AAA386 곰돌이 바라클라바 | locate brown / beige / white |
| AAA410 곰돌이 털모자 A형 | locate brown / white / pink / gray |
| AAA412 여우귀 넥워머 | locate beige / white |
| AAA413 곰돌이 목도리 넥워머 | locate brown / beige / white |
| AAA418 무타공 흡착식 후크 | locate yellow / pink / red / blue |
| AAA429 해골 병따개 | locate unit |

Legacy spreadsheet values such as 968, 986, default3, default145, a1, a7 are not current B-code evidence.

### Historical B-code exists but current physical state conflicts

| Model + product | Historical evidence | Why unresolved |
|---|---|---|
| AAA426 해골 레진 양초받침대 | BBA6-1 | launch history says BBA6-1, but warehouse map had the slot as empty |
| AAA431 해골 레진 캔들홀더 | white BBA8-1; black BBA8-2 | launch/stock-sheet history exists, but warehouse map had both slots empty |
| AAA480 재사용 EVA 우비 140g | blue BEF1-1; white BEF1-2; purple BEF1-3; yellow BEF2-1 | Product Master had only generic active SKUs at BEF1-1/BEF1-2 while other historical color slots were empty; never auto-merge |

For these three, ask the owner for direct warehouse confirmation instead of guessing.

---

## 9. Sold-out / held items relevant to location cleanup

Recent sold-out decisions include:

- AAA228 선인장 벽걸이수납함 — all treated as sold out in this recovery
  - speculative held locations for pink/light-green/green were released when AAA251 physically occupied those slots
  - random and white still had internal location history around BDG1-1 / BDG1-2; inspect live data before reuse
- AAA249 해바라기 커튼집게 — sold out; old BDG3-1 held placeholder was released when AAA240 physically occupied it
- AAA252 실리콘공병 파우치세트 — sold out; earlier placeholder BDG3-3
- AAA271 차량 열쇠고리 키링 — sold out; earlier placeholders BDG4-1 / BDG4-2
- AAA162 — stockout; earlier held slot BDF5-3

Before reusing any held slot, inspect live slot state and Product Master references.

---

## 10. Recent discontinued / archived decisions

These should not be accidentally resurrected from old spreadsheets or Shopling history.

Recent owner-confirmed discontinued products include:

- AAA002
- AAA011
- AAA036
- AAA040
- AAA041
- AAA077
- AAA102
- AAA171
- AAA183
- AAA194
- AAA204
- AAA205
- AAA222 돼지코스토퍼A형
- AAA288 줄자 키링 A형
- AAA289
- AAA325
- AAA329
- AAA330
- AAA331
- AAA341
- AAA342
- AAA361
- AAA364
- AAA371 높이조절 사이드테이블
- AAA379 쇼파 원목트레이
- AAA385 아크릴 투명보관함
- AAA392 콧볼축소기 A형
- AAA394 콧볼축소기 C형
- AAA398 소품바구니A
- AAA399 소품바구니B
- AAA404 열리는 수납 모형책 F
- AAA406 열리는 수납 모형책 D
- AAA407 열리는 수납 모형책 E
- AAA408 진자크래들모빌 대형

For AAA222 / AAA288 specifically, logical discontinuation was completed while physical slot records were intentionally preserved until actual emptiness is confirmed.

---

## 11. Option / price recovery principles

This chat recovered many previously missing normalized option rows using:
- exact stock-sheet option structure
- canonical price evidence
- user confirmations

Do not recreate option rows from scratch without first checking current normalized tables.

Important principles:
- use exact option labels from owned/sellable physical variants
- do not create an option solely because historical order data contains it
- do not merge spelling variants without semantic evidence
- generic 단품 Product Master rows may be stale or legacy and are not enough to prove option identity
- Shopling grouping proves listing structure, not physical stock identity
- canonical price evidence may be used when exact and confidence is strong
- do not invent real prices just to make completeness counters reach zero

---

## 12. Source files used during recovery

Primary business files:
- 실재고 상품 관리표
  - important sheet: 실재고 사전
  - used for model number, model name, sale option, China option, old location, status, managed code, image/detail and price evidence
- 동네일등 중국 주문,출발
  - multiple dated sheets
  - corroborating purchase/import evidence

These files are evidence, not absolute truth.

The owner's direct warehouse confirmation overrides stale spreadsheet location data.

---

## 13. Current continuation order

When a fresh Codex session continues this subsystem:

1. read AGENTS.md
2. read docs/CODEX_START_HERE.md
3. read docs/commerce-os-master-context-20260929.md
4. read this document
5. inspect current main
6. inspect current live Supabase state before any mutation
7. treat the AAA030 / AAA038 Product Master warehouse-map sync as completed under audit request `6c6ce247-90a1-4620-a951-8aada24c60dc`
8. process new owner physical confirmations one by one
9. for direct physical confirmations:
   - update launch option B-code/payload
   - preserve canonical option-barcode behavior
   - update item/tracker/workspace mirrors
   - update Product Master SKU / barcode history
   - update warehouse slot + occupant
   - write audit operation/event
10. after a meaningful batch, update this handoff

Never replay a prior write only because the previous client call timed out. Query current state first.

---

## 14. Definition of done for a physical location correction

A B-code / warehouse correction is complete only when all applicable layers agree:
- normalized launch option
- launch item representative / option mirrors
- tracker state and list snapshot
- Product Master SKU
- 12-digit option barcode identity
- warehouse slot
- warehouse occupant confirmation
- audit record

For multi-slot stock:
- one primary SKU barcode
- every real physical slot points to the same SKU
- extra slots are represented in payload
- every direct physical slot is confirmed

Report separately if one layer could not be verified because of infrastructure timeout.

---

## 15. Suggested Codex session behavior

If the owner says "이어서 진행해" or "창고에서 확인했다", Codex should not reconstruct the whole plan.

Instead:
- inspect the relevant model and slot live
- compare against this handoff
- apply the smallest safe reconciliation
- explain only the owner decision if one exists
- continue until another true ambiguity appears

Suggested Codex chat title:

상품마스터 · B코드 · 창고위치 정합성

Short alternative:

B코드 · 창고 적재 정합성
