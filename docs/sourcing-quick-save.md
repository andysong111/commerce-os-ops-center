# Sourcing Quick Save

`/sourcing-engine/quick-save` is a temporary save-first workflow.

It exists because the main importer page is large, and smaller incremental changes are safer.

Flow:

1. Paste 1688 candidate text.
2. Parse candidates.
3. Generate a recommendation card.
4. Save the card to browser-local card history.
5. Review saved cards at `/sourcing-engine/cards`.

This is still browser-local storage. Server-backed storage remains a later step.
