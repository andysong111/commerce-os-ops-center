# Shopling order automation training handoff

Date: 2026-09-28 to 2026-09-30
Status: Training in progress. The complete manual workflow has been demonstrated once; production automation is not enabled yet.

## Goal

Automate the daily Shopling workflow as far as the API permits, then use browser automation for the remaining UI-only steps:

1. Collect orders.
2. Map new orders to products.
3. Confirm new orders.
4. Move orders to ready-to-ship.
5. Send orders to the courier integration.
6. Print courier labels.

The Shopling API manual is available at:

`C:\Users\andy0\OneDrive\문서\샵플링 파이썬\데이터센터\샵플링 api 메뉴얼.zip`

## Observed workflow

### B1 Order auto collection

1. Open `[B1] 주문자동수집`.
2. Start the order, claim, and inquiry collection operations.
3. Three progress windows appear.
4. Wait until all three windows finish loading.
5. Close the three windows.
6. Move to `[B5] 신규주문매핑처리`.

### B5 New-order mapping

General processing:

1. Map each unmapped order using the product and option rules below.
2. Mapping quantity defaults to `1`.
3. After all rows are ready, select all rows and run mapping completion and new-order confirmation in bulk.

Mapping rules learned so far:

- Ignore the order quantity when deciding the mapping quantity. The order quantity is printed correctly on the label separately.
- Keep the mapping quantity at `1` unless the ordered product name explicitly describes a bundle, such as `1+1`, `2개입`, or `10개입`. In that case, set the mapping quantity to the bundle count.
- For option products, match the order's option name to the corresponding option in the searched Shopling product before adding it to the connected-product list.
- If a product is already present in the connected-product list, use that mapping directly.
- If selecting the ordered product produces no search results on the right, copy the shopping-mall product code, search with it, then map the returned product. Match the option when applicable.
- If multiple search results have the same B code, any one of those results may be used.
- A product may have originally had several options but be registered as separate single products. If one connected result appears, its product name identifies the ordered option, and it has a B code, map it directly.
- When several identical-looking products appear, prefer the product registered as one bundled option product instead of an option split into separate products. This is the current operating convention; the exact reason and deterministic selection rule still need investigation.

### B7 Order processing

1. Open `[B7] 주문처리`.
2. Set the date basis to `생성일` and the date range to today.
3. Check the `신규주문` status filter.
4. Set the display count to the maximum `1000`.
5. Click `검색`.
6. Select all returned orders.
7. In the order-status change control, select `발송준비`.
8. Click the red `주문상태변경` button and confirm the change.
9. Verify that today's `신규주문` count is `0` and that the orders appear under `발송준비`.

Do not search for individual order numbers during this daily transition. Always process the complete filtered set using `생성일 오늘 + 신규주문 + 1000건`.

### B12 Courier integration

1. Open `[B12] 택배사연동배송처리`.
2. Set order collection date to today.
3. Set the display count to `1000`.
4. Select `택배사 전송대기` and search.
5. In the automatic combined-shipment selector, choose the fourth item exactly: `우편번호 + 주소 + 수취인명 + 전화번호 + 쇼핑몰명`.
6. Apply the combined-shipment condition so combined deliveries are grouped.
7. Select all rows.
8. Choose courier `도소매사우루스`.
9. Send the selected orders to the courier.

### Courier label output

1. Select `택배사 전송완료`.
2. Set the display count to `1000` and search.
3. Sort `옵션자체관리코드(B코드)` ascending for picking convenience.
4. Add quantity as the secondary ascending sort.
5. Select all rows.
6. Click `택배사 송장출력`.
7. In the popup, keep `CJ 5인치 송장` and click `송장출력`.
8. Accept the confirmation dialog to open the label document.
9. Print using the saved Xprinter settings below.

Confirmed print settings:

- Printer: `Xprinter XP-DT108B` (the observed device name included a suffix such as `LAE`).
- Paper size: `대한통운 송장`.
- Layout: portrait.
- Sheets per page: `1`.
- Margins: custom/fitted settings already calibrated in Chrome.
- Scale: custom `100`.
- Background graphics: off.
- The print popup output fields remained at the existing defaults: model number, Shopling model name, Shopling option name, quantity, and option self-management code.

## Browser finding

The label-output button calls `window.open()` with a named popup (`dlvy_print_setting`) and posts the selected order data to that window. The in-app browser did not reliably create that popup. A dedicated regular Chrome window with ChatGPT debugging permission did open and control the Shopling popup and label document successfully.

The final native Chrome print button was clicked manually. For unattended output, use the dedicated Chrome profile only after its Xprinter settings have been calibrated, then launch it with `--kiosk-printing`. This avoids the native print dialog while retaining the Shopling web flow under CDP control.

## API boundary confirmed from the supplied manual

- API-capable: query orders with `order_gather_api.phtml?mode=2`.
- API-capable: change `신규주문` to `발송준비` with `order_status_mdy_api.phtml?mode=2`.
- API-capable but not a substitute for this workflow: register or edit an invoice number with `invoice_registration_api.phtml?mode=2`.
- No supplied API endpoint was found for marketplace order collection, new-order product mapping, automatic combined shipment, courier transmission, or label printing. Those steps currently require browser automation.

## Last observed state

- Page: `/order/dlvy_list.phtml`
- Filter: 2026-09-29 courier-transmission-complete orders
- Display count: `1000`
- Primary sort: B code ascending
- Secondary sort: quantity ascending
- Result rows selected: `33`
- Combined output: `31` labels because three orders were combined into one shipment group.
- Label print popup and label document: opened successfully in regular Chrome.
- Labels printed: `31`, physically verified by the user as correct.

This live page state may expire and should be re-queried rather than trusted in a later session.

## Next training session

1. Learn the remaining product-mapping edge cases.
2. Define retry and partial-failure rules for order collection, courier transmission, and printing.
3. Calibrate and test the dedicated Chrome profile with kiosk printing using a non-production or one-label test.
4. Implement each production phase behind dry-run, count verification, and explicit stop conditions.

## Customer service and return pickup predevelopment

Observed screens on 2026-10-01:

- Inquiry replies are managed at `[B13] 문의답변관리` (`/qna/qnaList.phtml`).
- Return and exchange candidates are found in `[B7] 주문처리` using a one-month range, `발송완료`, and claim filters.
- Simple-change returns with worthwhile recovery value should be reserved in CJ LOIS using the original outbound invoice number.
- CJ LOIS credentials remain in the dedicated normal Chrome profile. They must not be copied into chat, source files, command arguments, or logs.

Implemented boundary:

- A read-only Shopling API source collects only bounded order, claim, and QnA fields for at most 31 inclusive days.
- Recipient name, phone, address, claim free-text memo, and questioner identity fields are excluded.
- Review plans fail closed on duplicate claims, multiple returns for one order, an existing return invoice, a missing/conflicting outbound invoice, a non-delivered order, or any outbound courier code other than domestic CJ `018`.
- QnA plans store a freshness fingerprint instead of the raw question or title and reject stale reply drafts.
- One live CJ return reservation was submitted by the owner. Immediate success is evidenced by the save confirmation closing, the original-invoice field resetting, and a persisted reservation row appearing in the grid.
- CJ does not assign or expose the return tracking number immediately. It becomes available on the next business day, so the delayed lookup screen and exact matching rule still require training.
- No automated external write is enabled. CJ submission remains locked until delayed readback is trained; B13 reply registration and exchange replacement shipment also remain locked.
