# Product Master persistent storage plan

## Status and scope

This package is a design artifact for a future Product Master persistence change. Product Master currently uses `InMemoryProductMasterStorage`, selected by `getProductMasterStorage()`, and starts with the sample records. The process-global `Map` is temporary: imported records can disappear when the browser/server runtime restarts and cannot be shared reliably between processes or deployments.

Persistent storage is needed to make approved imports durable, establish one authoritative catalog, support controlled updates and deletion, and let Product Master and Freight Barcode enrichment observe the same data. Supabase-hosted Postgres is the recommended first deployment option because it provides managed Postgres while retaining a conventional SQL schema and the option to use another Postgres host later.

This PR deliberately does **not** connect a database. It adds no Supabase, Prisma, Postgres client, external database dependency, connection secret, API integration, or authentication. Separating schema review from connectivity lets the team resolve data-shape, uniqueness, migration, security, and rollback questions before runtime behavior changes. The existing memory provider, adapter behavior, imports, exports, and Freight Barcode behavior remain unchanged.

## Existing contract and consumers

### Storage boundary

`ProductMasterStorageAdapter` is the replacement boundary. It currently exposes synchronous methods:

- `create(input)`
- `list()`
- `get(id)`
- `update(id, input)`
- `delete(id)`
- `findByModelNo(modelNo)`
- `findByText(text)`

The public Product Master helpers call `getProductMasterStorage()` rather than constructing the memory store directly. A future database implementation should therefore be introduced behind the provider. Because database I/O is asynchronous, that implementation will probably be server/API-backed or require a separately reviewed asynchronous contract evolution; it must not silently change the current synchronous client contract.

### Fields in use today

The flattened `ProductMasterItem` read/write shape contains:

| TypeScript field | Proposed SQL column | Required today | Notes |
| --- | --- | --- | --- |
| `id` | `id` | yes | Adapter identity and option identity. |
| `modelNo` | `model_no` | yes | Primary business lookup used by imports and Freight enrichment. |
| `modelName` | `model_name` | yes | Product grouping, display, and text lookup. |
| `optionName` | `option_name` | yes (may be empty) | Option display and text-match refinement. |
| `barcode` | `barcode` | no | Freight label enrichment; currently incomplete for some products. |
| `origin` | `origin` | no | Label enrichment; import defaults missing values. |
| `displayName` | `display_name` | yes | Product Master display and fallback text lookup. |
| `memo` | `memo` | no | Option/item note. |
| `productNameKo` | `product_name_ko` | no | Korean product metadata used by Freight matching/history. |
| `productNameCn` | `product_name_cn` | no | Chinese product metadata. |
| `labelText` | `label_text` | no | Freight label enrichment. |
| `imageUrl` | `image_url` | no | Freight Product Master image fallback. |
| `hsCode` | `hs_code` | no | Fills Freight HS code when parsed input omits it. |
| `category` | `category` | no | Grouped Product Master page field. |
| `status` | `status` | no | `active`, `inactive`, or `discontinued`. |
| `mainImageUrl` | `main_image_url` | no | Grouped product image. |
| `productMemo` | `product_memo` | no | Product-level note distinct from option memo. |
| `productReferenceUnitCostCny` | `product_reference_unit_cost_cny` | no | Product-level reference cost. |
| `optionImageUrl` | `option_image_url` | no | Option-level image. |
| `referenceUnitCostCny` | `reference_unit_cost_cny` | no | Option-level reference cost. |
| — | `created_at` | future managed | Audit timestamp. |
| — | `updated_at` | future managed | Audit timestamp. |
| — | `deleted_at` | future managed | Nullable soft-delete timestamp. |

CSV and JSON exchange intentionally use only `modelNo`, `modelName`, `optionName`, `barcode`, `origin`, `displayName`, and `memo`; they are not currently full-fidelity backups of every optional internal field.

## Proposed `product_master_items` table

The draft is in [`docs/sql/product_master_items.sql`](sql/product_master_items.sql). It uses snake_case database names and keeps all current `ProductMasterItem` fields so migration need not discard metadata.

### Keys and constraints

- `id` is the primary key. The future adapter may retain imported IDs or generate UUID-like IDs before insertion; the database draft does not require an extension-specific default.
- `model_no` is `NOT NULL` and unique. Model number is the stable business identifier used for duplicate prevention, exact lookup, and import skip behavior. Database uniqueness closes race conditions that an adapter-only pre-check cannot prevent.
- The draft uniqueness is case-insensitive through a unique index on `lower(model_no)`, matching the current normalized lookup/import intent. A future migration must trim and deduplicate source values before creating the index.
- `barcode` remains nullable. Existing catalog rows and imports may not have an assigned barcode, and Freight parsing already handles an absent match/barcode safely. Barcode uniqueness is not asserted until business rules for shared or option-level barcodes are confirmed.
- `origin` defaults to `MADE IN CHINA`, matching the current import workflow and reducing accidental null/empty origins. Explicit non-default origins remain allowed.
- `created_at` and `updated_at` default to `now()`; an update trigger maintains `updated_at`.
- `deleted_at` is nullable for soft deletion. This supports recovery, audit, and safer rollback than immediate destructive deletion. Normal adapter reads and lookups must exclude rows where `deleted_at IS NOT NULL`.
- A status check constrains supplied status values to the existing TypeScript union.
- Reference costs are `numeric(14, 4)` to avoid binary floating-point storage for currency-like values.

### Model-number uniqueness and current option shape

The current in-memory type is a flattened option record and sample data can contain more than one row for a model number. The requested unique `model_no` constraint represents a future v1 business rule of one persisted Product Master record per model number. **The migration must not apply that constraint until a data audit resolves repeated model numbers.** Before rollout, choose and document one of these paths:

1. consolidate each model number into one canonical row (including an agreed option representation), or
2. revise the reviewed schema to separate products and options, with uniqueness on the product table and an option-level key on rows.

Do not silently drop duplicate options or select the first row during migration. The draft remains unapplied until this decision is complete.

### Indexes

The draft includes:

- case-insensitive unique lookup on `lower(model_no)` for active and soft-deleted rows alike, preventing accidental reuse of a deleted business identifier;
- an active-row barcode index for optional barcode lookup;
- an active-row `updated_at` index for incremental administration/export work;
- a GIN full-text expression index over model number, model name, option name, and display name as a candidate for `findByText`.

The future adapter must preserve current text-match ordering and semantics even if Postgres indexes are used. Database full-text ranking alone is not a behavioral substitute.

## Future adapter implementation plan

A future implementation may be named `SupabaseProductMasterStorage` or `PostgresProductMasterStorage`. Naming should reflect the actual dependency boundary: prefer the Postgres name if it uses generic SQL, and the Supabase name only if it relies on Supabase-specific APIs.

It must implement the existing logical operations:

| Method | Persistent behavior |
| --- | --- |
| `create` | Insert one active row; translate primary-key or model-number conflicts to a stable domain error. |
| `list` | Return active rows only, mapped from snake_case to `ProductMasterItem`. |
| `get` | Return one active row by `id`; soft-deleted rows behave as missing. |
| `update` | Update an active row, preserve `id`/`created_at`, and refresh `updated_at`. |
| `delete` | Set `deleted_at` rather than physically deleting; report whether an active row changed. |
| `findByModelNo` | Trim/normalize input and perform case-insensitive exact lookup first. |
| `findByText` | Preserve current priority: exact model token, option refinement, option inclusion, then model/display inclusion. |

The provider can later select a reviewed implementation with:

```text
PRODUCT_MASTER_STORAGE=memory
PRODUCT_MASTER_STORAGE=supabase
```

`memory` should remain the safe local-development and rollback mode. This PR does not add the `supabase` branch. A future PR must define server-only configuration, secret handling, error mapping, observability, connection pooling, and how asynchronous database calls cross the current synchronous/UI boundary.

## Migration plan for a future PR

1. **Freeze and inventory:** export/snapshot current authoritative data and count records, normalized model numbers, repeated model numbers, blank required values, invalid statuses, and malformed costs.
2. **Resolve the option/uniqueness decision:** consolidate duplicates or revise to a product/options schema. Obtain explicit sign-off before applying the unique index.
3. **Normalize safely:** trim identifiers, preserve original source files, fill origin only where policy permits, and produce a rejection report rather than silently coercing invalid rows.
4. **Review and apply SQL:** execute a reviewed version of the draft in a non-production Postgres/Supabase project. Use a real migration tool only in that future PR.
5. **Backfill transactionally:** insert cleaned rows into a staging table, verify counts/checksums and required fields, then merge into `product_master_items`. Do not overwrite existing model numbers by default.
6. **Implement the persistent adapter:** add server-only database access, row mapping, soft-delete filtering, and equivalent lookup ordering. Keep memory behavior unchanged.
7. **Add contract/integration tests:** run the same adapter behavior suite against memory and a disposable database, plus import and Freight enrichment integration tests.
8. **Shadow verification:** compare memory and database `list`, exact model lookup, and text lookup results against representative Freight inputs without serving database results to users.
9. **Controlled cutover:** deploy connection/configuration first, then opt in with `PRODUCT_MASTER_STORAGE=supabase` for a limited environment. Monitor errors, latency, row counts, import conflicts, and Freight match rates.
10. **Post-cutover export:** immediately create and retain a verified CSV/JSON or database-native backup according to the final backup policy.

## Import and export after persistence

The existing safety sequence remains the contract:

1. A user pastes or uploads CSV text.
2. Preview parsing and validation identify valid rows, invalid rows, warnings, and duplicate model numbers.
3. Nothing is written until the user presses an explicit import button.
4. The persistent adapter inserts only valid records whose normalized `modelNo` does not already exist.
5. Existing model numbers are skipped and reported. The database unique constraint is the final concurrency guard.
6. Invalid rows are never persisted.
7. Export calls `list()` through the selected adapter and emits the existing stable CSV/JSON exchange fields.

Overwrite/update mode is a separate, explicit future feature. It should require a dedicated preview of field-level changes, authorization policy, audit trail, and confirmation; it must not be smuggled into the initial persistent import.

For large imports, the future server boundary should use a transaction or staged batch, return per-row outcomes, and avoid partial success without a clear report. Exports should consistently exclude soft-deleted rows unless a separate administrative recovery export is requested.

## Freight Barcode PDF compatibility

Persistence must not alter barcode label output behavior. Freight parsing and the page should continue to call the public Product Master lookup functions; those functions should continue to obtain storage through `getProductMasterStorage()`.

Lookup compatibility requirements are:

1. exact, normalized `modelNo` lookup remains first priority;
2. text inclusion remains the fallback, including option refinement and model/display matching;
3. matching returns the same enrichment fields (`modelNo`, names, option, barcode, origin, display/label text, image, and HS code fallback);
4. unmatched rows remain valid and pass through safely without Product Master fields; and
5. PDF layout, print/download behavior, pagination, barcode quantity calculation, label count, history, and PR #33-related barcode output logic remain untouched.

A future adapter cutover should compare Freight match/no-match outcomes and selected option rows against the memory implementation before enabling persistence.

## Data safety, operations, and rollback

- Treat the pre-migration source export as immutable and retain a checksum plus row-count report.
- Apply schema and backfill in transactions where practical; never run an unreviewed draft directly in production.
- Keep database credentials server-only and out of browser bundles, logs, source control, and exported files.
- Define least-privilege database roles and authentication/authorization in a separate security-focused change before write access. This plan does not add authentication.
- Escape spreadsheet-formula prefixes if downloadable CSV later becomes user-controlled; preserve current export behavior until that is separately reviewed.
- Record import actor/source and row-level audit information in a future design if multi-user writes are introduced.
- Back up before migration and before any destructive cleanup. Test restore, not only backup creation.
- Soft deletion enables recovery, but retention and hard-delete policy must be explicit.
- Rollback the provider to `PRODUCT_MASTER_STORAGE=memory` if database availability, latency, mapping, or matching regressions occur. Keep the database rows intact for diagnosis; do not reverse-migrate automatically.
- If persistent writes occurred before rollback, export them first and define a reconciliation procedure so returning to memory does not silently hide accepted records.

## Acceptance checklist for the implementation PR

- Adapter contract behavior is equivalent for active records.
- Repeated current model numbers have an approved migration outcome.
- Imports remain preview-first, explicit, insert-only, and skip existing model numbers.
- CSV/JSON exchange fields and ordering remain compatible.
- Exact and fallback Freight lookups produce equivalent results; unmatched rows remain safe.
- Soft-deleted rows are excluded from normal list/get/lookups and exports.
- Product Master page and Freight Barcode PDF behavior are manually verified.
- No PDF layout, print, download, pagination, quantity, label count, history, or barcode output logic changes are bundled with persistence.
- Backup, restore, observability, secret handling, and rollback are documented and tested.
