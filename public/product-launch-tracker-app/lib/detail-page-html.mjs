function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildDetailHtml(url, productName) {
  const safeUrl = escapeAttribute(url);
  const safeName = escapeAttribute(productName || "상품 상세페이지");
  return `<div style="margin:0 auto;max-width:1000px;text-align:center;"><img src="${safeUrl}" alt="${safeName}" style="display:block;width:100%;height:auto;margin:0 auto;" loading="lazy"></div>`;
}
