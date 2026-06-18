import type { EngineRunnerKind } from "./engineRunnerTypes";

type ProductCodeInput = {
  value: string;
};

type ProductCodeForm = {
  querySelector(selector: string): ProductCodeInput | null;
};

type DispatchPreviewPayload = {
  inputs?: {
    product_code?: unknown;
  };
};

export function persistGeneratedDetailPageProductCode(
  kind: EngineRunnerKind,
  form: ProductCodeForm,
  previewPayload: DispatchPreviewPayload,
) {
  if (kind !== "detail_page_engine") return;

  const generatedProductCode = previewPayload.inputs?.product_code;
  if (typeof generatedProductCode !== "string" || !generatedProductCode.trim()) return;

  const productCodeField = form.querySelector('[name="product_code"]');
  if (!productCodeField || productCodeField.value.trim()) return;

  productCodeField.value = generatedProductCode;
}
