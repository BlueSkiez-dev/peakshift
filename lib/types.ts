// PeakShift domain types. Energy is always integer Wh; money is always integer minor units (cents).

export type Role = "operator" | "business" | "admin";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  orgId: string;
}

export interface Organisation {
  id: string;
  name: string;
  type: "operator" | "participant";
  category?: string;
  siteLabel?: string;
  timezone: string;
  payoutEmail?: string; // sandbox recipient — never shown unmasked outside operator detail
  status: "active" | "suspended";
}

export interface TimeWindow {
  start: string; // "HH:MM" local site time
  end: string;
}

export interface FlexActivity {
  id: string;
  name: string;
  equipmentCategory: string;
  isCritical: boolean;
  maxShiftWh: number | null;
  rateMinorPerKwh: number | null;
  currency: "USD";
  window: TimeWindow | null;
  mustCompleteBy?: string | null;
  constraints: string[];
}

export type FieldProvenance = "confirmed" | "ai" | "missing" | "safety";

export interface ProfileDraft {
  summary: string;
  activities: (FlexActivity & {
    provenance: Record<string, FieldProvenance>;
    sourceEvidence: string[];
  })[];
  minimumNoticeHours: number | null;
  missingFields: string[];
  questions: string[];
  assumptions: string[];
  confidence: "high" | "medium" | "low";
  engine: AiEngineInfo;
}

export interface AiEngineInfo {
  mode: "claude" | "offline";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  latencyMs: number;
}

export interface BusinessProfile {
  id: string;
  orgId: string;
  version: number;
  status: "draft" | "confirmed" | "superseded";
  freeText: string;
  draft: ProfileDraft | null;
  activities: FlexActivity[];
  minimumNoticeHours: number | null;
  dataQuality: number; // 0..100, meter dataset completeness
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
}

export type EventStatus =
  | "DRAFT"
  | "AWAITING_FUNDING"
  | "FUNDED"
  | "PLAN_READY"
  | "OFFERS_SENT"
  | "READY_TO_EXECUTE"
  | "IN_PROGRESS"
  | "VERIFIED"
  | "VERIFY_BLOCKED"
  | "SETTLEMENT_REVIEW"
  | "PAYOUT_PROCESSING"
  | "PAID"
  | "NEEDS_ATTENTION"
  | "CANCELLED";

export type FundingStatus =
  | "NOT_FUNDED"
  | "ORDER_CREATED"
  | "PAYER_APPROVED"
  | "CAPTURE_PENDING"
  | "FUNDED"
  | "FUNDING_CANCELLED"
  | "FUNDING_FAILED";

export interface EventFunding {
  provider: "paypal" | "paypal-simulator" | "demo-fixture";
  orderId: string | null;
  captureId: string | null;
  amountMinor: number;
  currency: "USD";
  status: FundingStatus;
  capturedAt: string | null;
  history: { status: FundingStatus; at: string; note?: string }[];
}

export interface DemandEvent {
  id: string;
  name: string;
  eventDate: string; // YYYY-MM-DD
  timezone: string;
  peak: TimeWindow;
  shift: TimeWindow;
  targetKw: number; // display value (kW average)
  targetWh: number;
  budgetMinor: number;
  currency: "USD";
  minDataQuality: number;
  notes: string;
  status: EventStatus;
  aiProposedFields: string[];
  funding: EventFunding;
  activePlanId: string | null;
  verificationRunId: string | null;
  settlementId: string | null;
  executedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export type ReasonCode =
  | "SELECTED_LOWEST_RATE"
  | "SELECTED_TO_COMPLETE_TARGET"
  | "NOT_NEEDED_TARGET_MET"
  | "HARD_SAFETY_CRITICAL_LOAD"
  | "WINDOW_MISMATCH"
  | "PROFILE_UNCONFIRMED"
  | "CAPACITY_UNCONFIRMED"
  | "RATE_MISSING"
  | "INSUFFICIENT_DATA"
  | "SUSPENDED";

export interface CandidateDecision {
  orgId: string;
  businessName: string;
  activityId: string | null;
  activityName: string;
  eligible: boolean;
  selected: boolean;
  hard: boolean; // hard safety exclusion
  reasonCode: ReasonCode;
  reason: string;
  capacityWh: number;
  rateMinorPerKwh: number | null;
  allocatedWh: number;
  estRewardMinor: number;
  window: TimeWindow | null;
  dataQuality: number;
  profileVersion: number;
}

export interface DispatchPlan {
  id: string;
  eventId: string;
  version: number;
  status: "ready" | "published" | "superseded" | "infeasible";
  feasible: boolean;
  targetWh: number;
  plannedWh: number;
  estCostMinor: number;
  budgetMinor: number;
  shortfallWh: number;
  minBudgetRequiredMinor: number | null;
  eligibleCapacityWh: number;
  candidates: CandidateDecision[];
  inputsHash: string;
  optimiserVersion: string;
  infeasibleReason: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export type OfferStatus = "ACTION_REQUIRED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "SUPERSEDED";

export interface Offer {
  id: string;
  eventId: string;
  planId: string;
  planVersion: number;
  orgId: string;
  activityId: string;
  activityName: string;
  profileVersion: number;
  allocatedWh: number;
  rateMinorPerKwh: number;
  maxRewardMinor: number;
  shiftWindow: TimeWindow;
  status: OfferStatus;
  expiresAt: string;
  publishedAt: string;
  respondedAt: string | null;
  declineReason: string | null;
}

export interface MeterDataset {
  id: string;
  orgId: string;
  eventId: string;
  type: "baseline" | "event";
  source: "SIMULATED";
  intervalMinutes: 15;
  label: string;
  readings: { i: number; wh: number | null }[]; // 96 intervals, i=0 → 00:00 local
}

export interface ParticipantVerification {
  orgId: string;
  businessName: string;
  committedWh: number;
  baselinePeakWh: number;
  actualPeakWh: number;
  peakReductionWh: number;
  baselineShiftWh: number;
  actualShiftWh: number;
  reboundWh: number;
  verifiedWh: number;
  limitedBy: "commitment" | "peak_reduction" | "rebound";
  coveragePct: number;
  expectedIntervals: number;
  receivedIntervals: number;
  status: "VERIFIED" | "INSUFFICIENT_DATA";
  rateMinorPerKwh: number;
  rewardMinor: number;
}

export interface VerificationRun {
  id: string;
  eventId: string;
  version: number;
  formulaVersion: string;
  baselineMethod: string;
  minCoveragePct: number;
  status: "VERIFIED" | "INSUFFICIENT_DATA";
  participants: ParticipantVerification[];
  totals: {
    committedWh: number;
    peakReductionWh: number;
    reboundWh: number;
    verifiedWh: number;
    deliveryPct: number;
    coveragePct: number;
    rewardMinor: number;
  };
  createdAt: string;
}

export interface SettlementItem {
  id: string;
  orgId: string;
  businessName: string;
  recipientMasked: string;
  committedWh: number;
  verifiedWh: number;
  rateMinorPerKwh: number;
  amountMinor: number;
  evidence: "VERIFIED" | "INSUFFICIENT_DATA";
  payable: boolean;
}

export interface Settlement {
  id: string;
  eventId: string;
  verificationRunId: string;
  status: "DRAFT" | "APPROVED" | "SUBMITTED";
  items: SettlementItem[];
  totalMinor: number;
  currency: "USD";
  reviewHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export type BatchStatus =
  | "DRAFT"
  | "SUBMITTING"
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "DENIED"
  | "FAILED"
  | "UNKNOWN";

export type ItemStatus =
  | "READY"
  | "SUBMITTED"
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "HELD"
  | "BLOCKED"
  | "UNCLAIMED"
  | "RETURNED"
  | "REFUNDED"
  | "CANCELLED"
  | "UNKNOWN";

export interface PayoutItem {
  id: string;
  senderItemId: string;
  paypalItemId: string | null;
  transactionId: string | null;
  orgId: string;
  businessName: string;
  recipientMasked: string;
  amountMinor: number;
  currency: "USD";
  status: ItemStatus;
  errorCode: string | null;
  history: { status: ItemStatus; at: string; source: string }[];
  updatedAt: string;
}

export interface PayoutBatch {
  id: string;
  settlementId: string;
  eventId: string;
  provider: "paypal" | "paypal-simulator";
  senderBatchId: string;
  paypalBatchId: string | null;
  amountMinor: number;
  currency: "USD";
  status: BatchStatus;
  items: PayoutItem[];
  submittedAt: string | null;
  /** Wall-clock time of the real PayPal API submission (submittedAt follows the scenario clock). */
  wallClockSubmittedAt?: string | null;
  lastWebhookAt: string | null;
  lastCheckedAt: string | null;
  responseRedacted: unknown;
  history: { status: BatchStatus; at: string; source: string }[];
  updatedAt: string;
}

export interface WebhookEvent {
  id: string;
  providerEventId: string;
  eventType: string;
  verified: boolean;
  simulated: boolean;
  receivedAt: string;
  processingStatus: "PROCESSED" | "DUPLICATE" | "REJECTED" | "UNSUPPORTED";
  resource: string;
  /** Why the receipt was rejected or not acted on (kept for the audit log). */
  reason?: string;
  /** Wall-clock receipt time (the scenario clock is used for receivedAt). */
  wallClockAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  role: Role | "system" | "paypal";
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  correlationId: string;
}

export interface AiRun {
  id: string;
  feature: "profile_extract" | "event_brief" | "analyst";
  mode: "claude" | "offline";
  model: string;
  promptVersion: string;
  status: "ok" | "error" | "rejected";
  latencyMs: number;
  at: string;
}

export interface StudioReport {
  id: string;
  organisationId: string;
  ownerUserId: string;
  eventId: string;
  name: string;
  description: string;
  reportState: unknown; // complete AG Studio report state (opaque)
  agStudioVersion: string;
  reportSchemaVersion: string;
  templateVersion: string;
  isDefault: boolean;
  visibility: "PRIVATE" | "ORGANISATION";
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface AppState {
  seedVersion: string;
  users: User[];
  orgs: Organisation[];
  profiles: BusinessProfile[];
  events: DemandEvent[];
  plans: DispatchPlan[];
  offers: Offer[];
  datasets: MeterDataset[];
  verifications: VerificationRun[];
  settlements: Settlement[];
  batches: PayoutBatch[];
  webhooks: WebhookEvent[];
  audit: AuditEvent[];
  /** Scenario clock (ISO). Every workflow record is stamped from it so the demo replays a coherent timeline. */
  clock?: string;
  aiRuns: AiRun[];
  studioReports?: StudioReport[];
}
