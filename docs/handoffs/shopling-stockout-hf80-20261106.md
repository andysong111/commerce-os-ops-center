# Shopling stock-state HF80 handoff — 2026-11-06

## User-visible contract

- Extension: `v0.6.43 / HF80`
- Commerce OS remains responsible through Shopling A21 transmission acceptance/processing start, not marketplace completion.
- HF69 visible A21 radio-click logic and HF79 current `kt.shopling.co.kr` popup ownership remain packaged.

## State rules

1. Exact B-code option status is changed through the Shopling API and read back with quantity unchanged.
2. For a multi-option goods key:
   - if at least one option remains sellable, ordinary changes use `OPTION_SEND`;
   - if the last sellable option becomes sold out, product status is made sold out and only `PRODUCT_SALE_STATUS_SEND` is used;
   - if a fully sold-out product regains a sellable option, product status is made on-sale and A21 runs `PRODUCT_SALE_STATUS_SEND` first, then `OPTION_SEND`.
3. A historical logical option listing with exactly one actual option continues to use the product sale-status lane.
4. Any option state outside supported `B/C` aggregation fails closed before A21 transmission.

## Price transmitter checkpoint

The master context already required `temporary selling -> PRICE -> OPTION -> restore sold-out`. Current price review/execution code excludes inactive/sold-out listings and therefore does not implement that contract. No price-transmitter mutation is included in HF80; it requires a separate end-to-end change and regression fixture.

## Verification boundary

- Deterministic tests cover full sold-out, partial recovery ordering, partial option changes, one-option split listings, unsupported aggregate states, and extension stage grouping.
- Live Shopling verification still requires installing v0.6.43 and running one canary B-code. Success for Commerce OS is the exact A21 processing/result screen start for every required stage.
