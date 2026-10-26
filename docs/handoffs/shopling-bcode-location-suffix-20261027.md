# Shopling B-code location suffix recovery — 2026-10-27

## Incident

- Shopling order rows can contain an option self-management code such as `BAF1-1e`.
- Product Master owns the canonical B-code `BAF1-1`.
- The previous exact-format parser rejected the suffixed value, so the order could be omitted from live purchase-demand aggregation and canonical historical sales.

## Implemented rule

1. Normalize width, dash variants, case, and whitespace.
2. Accept the existing exact structured code unchanged.
3. Accept exactly one trailing alphabetic warehouse-location marker and derive the canonical code (`BAF1-1e` → `BAF1-1`).
4. In live purchase aggregation, assign the row only when that canonical code exists in the current Product Master snapshot.
5. Keep malformed or unregistered candidates unresolved; never guess from a partial prefix.

The shared rule is used by live purchase drafts, monthly historical backfill, canonical sales-event collection, and historical-option shadow verification. The canonical sales identity version is now `location-suffix-pack-evidence-v4`, which prevents reuse of sales chunks calculated with an older resolver.

The first production-wide `location-suffix-v3` scan recovered 75 valid rows and
569 units but correctly stopped on three old `BBF6-1V` / `BBF6-1O` rows because
the current B-code has both single and 1+1 listings. Read-only Shopling evidence
confirmed that all three order-time product and option names were single-unit
listings. v4 therefore uses the persisted order-time names to resolve the pack:
explicit `1+1` / `2개입`-style markers select the matching bundle, otherwise a
non-empty title selects the base single unit. Missing, conflicting, or
Product-Master-incompatible evidence remains unresolved.

## Verification

- Added the real failure shape: stale option/product keys, `mall_ptn_opt_cd=BAF1-1e`, quantity 100, canonical Product Master B-code `BAF1-1`.
- Verified the row maps to `BAF1-1` with 100 units in all four aggregation paths.
- Verified multi-letter or unknown suffix values do not resolve through the shared known-code resolver.
- Targeted v4 regression tests: 52 passed, 0 failed.
- TypeScript typecheck: passed.
- Changed-file ESLint: passed.
- Repository-wide lint and test remain red because of pre-existing unrelated failures on `main`; no failures came from the changed files or targeted regression set.

## Operational follow-up

After deployment, start or regenerate the purchase run so Shopling order rows are collected again under `location-suffix-pack-evidence-v4`. Existing summarized chunks do not retain enough raw identity data to repair themselves in place.
