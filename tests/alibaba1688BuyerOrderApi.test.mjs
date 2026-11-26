import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buyerOrderApiCredentials,
  read1688BuyerOrders,
  reconcile1688BuyerOrderStatuses,
} from "../local-agent/src/alibaba1688-buyer-order-api.mjs";

const credentials = { appKey: "fixture-app", appSecret: "fixture-secret", session: "fixture-session" };
const original = "900000000000000001";
const reordered = "900000000000000011";
const offer = "901234567890";

function officialResponse(rows) {
  return new Response(`{"alibaba_trade_buyerorderlist_get_response":{"result":`
    + `{"success":true,"data":{"count":${rows.length},"list":{"trade_info":[${rows.join(",")}]}}}}}`);
}

function order(id, status, quantity = 2) {
  return `{"base_info":{"id":${id},"status":"${status}","pay_time":"2026-11-16 15:00:00"},`
    + `"product_items":{"product_item_info":[{"product_i_d":${offer},"quantity":"${quantity}",`
    + `"sku_infos":{"sku_item_desc":[{"value":"黑色"}]}}]}}`;
}

test("5-5 queries at most 20 exact order numbers per signed batch and keeps long IDs intact", async () => {
  const ids = Array.from({ length: 21 }, (_, index) => String(BigInt(original) + BigInt(index)));
  const batches = [];
  const result = await read1688BuyerOrders(ids, credentials, {
    now: new Date("2026-11-26T02:20:30Z"),
    fetchImpl: async (url, request) => {
      assert.equal(url, "https://eco.taobao.com/router/rest");
      assert.equal(request.redirect, "error");
      assert.equal(request.body.get("method"), "alibaba.trade.buyerorderlist.get");
      assert.equal(request.body.get("timestamp"), "2026-11-26 10:20:30");
      const fields = Object.fromEntries(request.body);
      delete fields.sign;
      const signed = Object.entries(fields).sort(([left], [right]) => left < right ? -1 : 1)
        .map(([key, value]) => key + value).join("");
      assert.equal(request.body.get("sign"), createHmac("md5", credentials.appSecret).update(signed).digest("hex").toUpperCase());
      const query = request.body.get("param_trade_get_order_list_param");
      const batch = /"order_ids":\[([\d,]+)\]/.exec(query)[1].split(",");
      batches.push(batch);
      return officialResponse(batch.map((id) => order(id, "waitbuyerreceive")));
    },
  });
  assert.deepEqual(batches.map((batch) => batch.length), [20, 1]);
  assert.deepEqual(result.orders.map((entry) => entry.orderNo), ids);
  assert.equal(result.orders[0].lines[0].offerId, offer);
  assert.deepEqual(result.missingOrderNos, []);
});

test("5-5 flags a cancelled original and checks the replacement by offer, option and exact B-code quantity", async () => {
  const result = await read1688BuyerOrders([original, reordered], credentials, {
    fetchImpl: async () => officialResponse([order(original, "cancel"), order(reordered, "waitsellersend")]),
  });
  const rows = [original, reordered].map((orderNo) => ({ orderNo, barcode: "BBA1-1", quantity: 2 }));
  const draft = [{ barcode: "BBA1-1", chinaOption: "黑色", supplierLink: `https://detail.1688.com/offer/${offer}.html` }];
  assert.deepEqual(reconcile1688BuyerOrderStatuses(rows, draft, result), {
    orderCount: 2, matchedOrderCount: 1, matchedQuantity: 2,
    exceptions: [{ orderNo: original, code: "CANCELLED" }],
  });
  assert.deepEqual(reconcile1688BuyerOrderStatuses([{ ...rows[1], quantity: 3 }], draft, result).exceptions,
    [{ orderNo: reordered, code: "ITEM_OR_QUANTITY_CONFLICT" }]);
});

test("5-5 stops before network access without authorization and rejects unrelated orders", async () => {
  assert.equal(buyerOrderApiCredentials({}), null);
  await assert.rejects(read1688BuyerOrders([original], null, {
    fetchImpl: () => assert.fail("queried 1688 before authorization"),
  }), { code: "ALIBABA1688_BUYER_AUTH_REQUIRED" });
  await assert.rejects(read1688BuyerOrders([original], credentials, {
    fetchImpl: async () => officialResponse([order(reordered, "success")]),
  }), { code: "ALIBABA1688_BUYER_ORDER_SCOPE_CONFLICT" });
});
