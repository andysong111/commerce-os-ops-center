# Shopling stock-state HF98 failure detail — 2026-11-19

## Incident

- The mixed four-code run completed three Shopling submissions and blocked `BAF3-3` before submission.
- Commerce OS showed only that the product was outside the B/C transition range. It did not say which raw Shopling state was observed, whether the blue submit button ran, or what had to be corrected before a retry.
- The server already received the raw transition error, for example `SHOPLING_PRODUCT_STATUS_TRANSITION_BLOCKED:<status>`, but converted it to a coarse sentence and discarded `<status>`.

## HF98 change

- Preserve the exact safe Shopling status code in the API response and message. Known states are labelled only when proven: `B=판매중`, `C=품절`, `Z=삭제`; every other code is shown as `B/C 외 상태` without guessing its business meaning.
- State explicitly that this failure happens during the pre-submit API check, before an A21 popup or original blue submit click, so there is no Shopling submit receipt.
- Show `중단 위치 / 확인된 상태 / 실패 원인 / 전송 여부 / 다음 조치` under each failed or uncertain run detail.
- Explain that repeated retries cannot fix an unchanged non-B/C state. Deleted, missing-status, and unknown-state cases receive distinct next-action guidance.
- Old persisted failures that already lost the raw status remain honest: the UI says the original status was not stored instead of inventing one.

## Compatibility

- This is a Commerce OS server/UI fix. Extension v0.6.58 remains valid because the installed bridge already forwards the server's safe error message.
- No external Shopling write is added, retried, or widened by this change.

## Verification gate

- The sanitized `BAF3-3` pre-submit fixture must retain `Z(삭제)`, say that the blue submit button was not clicked, and recommend lifecycle/re-registration review.
- An undocumented state such as `H` must remain `H(B/C 외 상태)` without an invented label.
- A historical coarse failure must show `당시 응답에 상태 원문 미저장` and must never be presented as a confirmed status.
- HF97 accepted-submit and market-warning behavior must remain unchanged.
