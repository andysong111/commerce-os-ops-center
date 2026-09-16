# Monthly-spend scan completeness follow-up

PR1211 review discussion_r4024749420 correctly identified that the legacy recent-summary reader scans only 120 global operation rows. A null summary therefore did not prove no spending in a target month.

The preflight no longer uses that reader. It queries the exact target month across the three documented snapshot storage shapes, before a bounded 1000-row limit, requesting an exact count. Any missing count or count/data-length mismatch blocks the preflight, including nonzero partial scans. Only a successful complete empty result proves no recorded spending. Malformed draft identity/month/paid amount blocks; numeric recorded KRW amounts are not inferred from fallback costs or exchange rates. Latest-per-draft selection follows the existing summary's result/nested/input precedence and the query's deterministic started_at/id descending order.

24 new tests cover empty vs incomplete, 121 drafts, server truncation, historical shapes, duplicates, invalid values, overflow and production query wiring. Together with the prior 97 preflight cases and 11 existing closure tests, the dedicated CI now runs 132 tests. New head CI must pass before merge; no actual business write or approval is enabled.
