# Toss-compatible option normalization

Goal: Normalize OPS Center option names/values before Shopling upload so the same Shopling product data is more likely to pass Toss option validation without introducing Toss-only adapter fields that Shopling cannot route per-market.

Principles:
- Prefer semantic option names (색상, 사이즈, 수량, 재질, 규격) over generic labels such as 옵션/구성.
- Do not blindly rename values. Infer from value semantics and product context.
- Preserve single-item products as Shopling-compatible single-item options when required.
- Add a preflight layer that flags ambiguous mappings instead of forcing unsafe normalization.
- Record Toss/Shopling failure reasons for future rule refinement.
