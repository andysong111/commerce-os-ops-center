export const AI_SAURUS_BULK_LIMIT = 20;
export const AI_SAURUS_ORIGIN = "https://ai-saurus.com";
export const AI_SAURUS_BATCH_API = "/api/ai-saurus-bulk-detail";
export const AI_SAURUS_BATCH_PAGE = "/ai-saurus-bulk-detail";
export const AI_SAURUS_CONNECTION = "preparation_only" as const;

export type AiSaurusProductStage =
  | "draft" | "waiting_connection" | "waiting_1688_login" | "running"
  | "awaiting_review" | "failed" | "approved";

export type AiSaurusRelease = {
  origin: string;
  deploymentId: string;
  engineVersion: string;
  importerVersion: string;
  contractVersion: string;
  hostingOrigins: string[];
};

export type AiSaurusRun = {
  attemptKey: string;
  inputHash: string;
  release: AiSaurusRelease;
  sessionEvidenceId: string;
  approvedBudgetMinor: number;
  currency: string;
};

export type AiSaurusHostedReceipt = {
  attemptKey: string;
  inputHash: string;
  itemId: string;
  deploymentId: string;
  sessionEvidenceId: string;
  providerJobId: string;
  hostedImageUrl: string;
  sha256: string;
  qa: "passed";
  transferReceiptId: string;
  costReceiptId: string;
  costMinor: number;
  currency: string;
};

export type AiSaurusBatchProduct = {
  id: string;
  model: string;
  name: string;
  sourceUrl: string;
  originalDetailImageUrl: string;
  catalogOptions: string[];
  options: string[];
  stage: AiSaurusProductStage;
  attempts: number;
  inputHash: string;
  dispatch?: {
    attempt: string;
    email: string;
    importer: string;
    deployment: string;
    maxCredits: number;
    startedAt: string;
    providerJobId?: string;
    progress?: number;
  };
  run?: AiSaurusRun;
  receipt?: AiSaurusHostedReceipt;
  error?: string;
};

export type AiSaurusDetailBatch = {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  selectionHash: string;
  queuedIds?: string[];
  products: AiSaurusBatchProduct[];
};
