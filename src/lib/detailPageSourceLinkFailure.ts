type UnknownRecord = Record<string, unknown>;

type DetailPageSourceJob = {
  status?: unknown;
  qaStatus?: unknown;
  stage?: unknown;
  error?: unknown;
  message?: unknown;
  sourceUrl?: unknown;
  payload?: unknown;
  result?: unknown;
};

const EXPLICIT_LINK_FAILURE = /SOURCE_LINK_UNAVAILABLE|商品已下架|已下架|商品不存在|页面不存在|页面为空|空白页面|链接失效|无法访问|访问失败|not\s+found|\b404\b|\bgone\b|unavailable|blank\s+page|empty\s+page|page\s+is\s+empty|link.{0,20}unavailable|접근\s*불가|링크\s*불량|페이지.{0,20}(비어|없음|없습니다|찾을\s*수\s*없)|상품.{0,20}(내려|삭제|존재하지)|링크.{0,20}(만료|실패|접근)/i;
const INFRASTRUCTURE_FAILURE = /studio|preview|보호\s*인증|로컬\s*수집기|local\s*bridge|local\s*network|권한|worker|서버\s*작업|인증\s*실패/i;
const SOURCE_IDENTITY_UNAVAILABLE = /정상\s*상품\s*원본\s*식별\s*불가|동일성\s*검증.{0,20}불가능|실제\s*(?:판매\s*)?(?:상품|제품)\s*형상.{0,24}(?:보이지|식별|확인).{0,16}(?:않|불가|없)|소스\s*기준\s*이미지.{0,24}(?:형상|제품).{0,24}(?:보이지|불가능)|source.{0,30}(?:identity|product|geometry).{0,30}(?:unverifiable|cannot\s+be\s+(?:verified|confirmed)|not\s+discernible)|no\s+discernible\s+(?:product\s+)?geometry|cannot\s+be\s+confirmed\s+from\s+(?:the\s+)?(?:source|identity)/i;
const SOURCE_IMAGE_RISK = /SOURCE_QUALITY_RISK|GEOMETRY_RISK|placeholder|플레이스홀더|상품\s*(?:본체|형상|실루엣).{0,24}(?:식별할\s*수\s*없|식별\s*불가)|제품\s*(?:본체|형상|실루엣).{0,24}(?:식별할\s*수\s*없|식별\s*불가)|no\s+discernible\s+(?:product\s+)?geometry/i;
const SOURCE_IMAGE_SAFE = /GEOMETRY_SAFE|ROLE:WHOLE/i;

export function hasDetailPageSourceIdentityFailure(jobValue: unknown) {
  const job = record(jobValue) as DetailPageSourceJob;
  const payload = record(job.payload);
  const result = record(job.result);
  const sourceGate = record(result.sourceGate ?? result.source_gate);
  const identityGate = record(
    result.v3RepresentativeIdentityGate ?? result.v3_representative_identity_gate,
  );
  const reason = [
    job.error,
    job.message,
    payload.source_error,
    payload.sourceError,
    payload.collection_error,
    payload.collectionError,
    sourceGate.code,
    sourceGate.reason,
    sourceGate.status,
    identityGate.status,
    identityGate.summary,
    identityGate.reason,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

  if (EXPLICIT_LINK_FAILURE.test(reason)) return true;
  if (SOURCE_IDENTITY_UNAVAILABLE.test(reason)) return true;

  const analysis = record(result.analysis);
  const imageAnalysis = array(analysis.image_analysis)
    .map(record)
    .filter((item) => Number(item.image_index) > 0 && item.contains_package !== true);
  if (imageAnalysis.length) {
    const hasUsableIdentity = imageAnalysis.some((item) => {
      const notes = text(item.notes);
      if (!notes || SOURCE_IMAGE_RISK.test(notes)) return false;
      return item.primary_candidate === true || SOURCE_IMAGE_SAFE.test(notes);
    });
    if (!hasUsableIdentity) return true;
  }

  return false;
}

export function isDetailPageSourceLinkUnavailable(jobValue: unknown) {
  const job = record(jobValue) as DetailPageSourceJob;
  if (hasDetailPageSourceIdentityFailure(jobValue)) return true;

  const failed = text(job.status) === "failed" || text(job.qaStatus) === "failed";
  if (!failed || text(job.stage) !== "source_collection") return false;

  const payload = record(job.payload);
  const reason = [
    job.error,
    job.message,
    payload.source_error,
    payload.sourceError,
    payload.collection_error,
    payload.collectionError,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

  const evidence = array(payload.evidence_urls).map(text).filter(Boolean);
  if (evidence.length) return false;
  if (INFRASTRUCTURE_FAILURE.test(reason)) return false;

  // Studio 자체 연결 오류가 아니라 source_collection에서 원본 근거를 한 장도
  // 만들지 못한 종료 작업은 운영자가 다음 링크로 교체할 수 있도록 링크불량으로 묶는다.
  return Boolean(text(job.sourceUrl) || text(payload.source_url));
}

export function detailPageSourceLinkFailureLabel(jobValue: unknown) {
  return isDetailPageSourceLinkUnavailable(jobValue) ? "링크불량" : "";
}

export function detailPageSourceLinkFailureDetail(jobValue: unknown) {
  if (!isDetailPageSourceLinkUnavailable(jobValue)) return "";
  const job = record(jobValue) as DetailPageSourceJob;
  const payload = record(job.payload);
  const result = record(job.result);
  const sourceGate = record(result.sourceGate ?? result.source_gate);
  const raw =
    text(sourceGate.reason) ||
    text(job.error) ||
    text(job.message) ||
    text(payload.source_error) ||
    text(payload.collection_error);
  if (raw && raw !== "1688 상품정보·이미지 수집에 실패했습니다.") {
    return raw;
  }
  return "상세페이지 제작용 1688 링크에서 상품 형태를 확인할 원본을 확보하지 못했습니다. 상품 상세에서 제작용 링크를 바꾼 뒤 다시 생성하세요.";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}
