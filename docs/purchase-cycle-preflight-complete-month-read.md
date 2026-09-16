# Monthly-spend scan completeness follow-up

PR1211 review discussion_r4024749420 correctly identified that the legacy recent-summary reader scans only 120 global operation rows. A null summary therefore did not prove no spending in a target month.

The preflight no longer uses that reader. It queries the exact target month across the three documented snapshot storage shapes, before a bounded 1000-row limit per shape, requesting an exact count for each. Any missing count or count/data-length mismatch blocks the preflight, including nonzero partial scans. Only successful complete empty results prove no recorded spending. Malformed draft identity/month/paid amount blocks; numeric recorded KRW amounts are not inferred from fallback costs or exchange rates.

The first adapter revision correctly failed TypeScript CI: the repository uses a custom REST query implementation without SDK or(), and repeated order() overwrites earlier order. No failed build was merged. The corrected implementation uses three supported eq() queries, proves completeness for each, deduplicates by operation ID, blocks conflicting versions of an operation observed across queries, and sorts by started_at/id before existing latest-per-draft/snapshot precedence.

30 new tests cover empty vs incomplete, 121 drafts, server truncation, historical shapes, duplicates, invalid values, overflow, missing/conflicting multi-query rows and production adapter wiring. With the prior 97 preflight cases and 11 existing closure tests, dedicated CI now runs 138 tests. New exact-head CI must pass before merge; no actual business write or approval is enabled.
