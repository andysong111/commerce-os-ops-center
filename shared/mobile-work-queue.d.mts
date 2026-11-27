import type { InvoiceGroups, MobileAgentStatus, MobileWorkRequest } from "./mobile-work-center.mjs";
type Job = {
  id: string; actionId: string; execute: boolean; status: string; updatedAt: number; code: string | null;
};
type Queue = {
  agent: MobileAgentStatus | null;
  pending: MobileWorkRequest | null;
  jobs: Array<Job & { fingerprint: string; pickingSnapshotId?: string }>;
  pickingInbox?: Array<InvoiceGroups & { id: string; snapshotId: string; expiresAt: number }>;
};
export type PublicWorkQueue = {
  agent: { connected: boolean; busy: boolean; actions: string[]; lastSeenAt: number | null };
  jobs: Array<Job & { connectionLost: boolean }>;
};
export function emptyQueue(): Queue;
export function publicQueue(state: Queue, now: number): PublicWorkQueue;
export function applyWorkQueue(state: Queue, event: Record<string, unknown>, now: number): {
  status: number;
  code?: string;
  state?: Queue;
  command?: MobileWorkRequest;
};
