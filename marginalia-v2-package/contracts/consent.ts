import type { ProviderKind } from './job-runner.ts';

export type ConsentScope = 'cloud-inference' | 'open-session';
export type ConsentChoice = 'this-time' | 'always-site' | 'never-site';
export type GrantDecision = 'allow-once' | 'allow-site' | 'deny-site';

export type OutgoingPart = {
  /** Plain reader-facing label such as “Selected passage” or “Your note”. */
  label: string;
  /** The exact bounded text that will leave the machine. */
  text: string;
  sha256: string;
};

/** Created by the trusted host from the same frozen request that will become a job. */
export type PrepareConsentInput = {
  requestId: string;
  /**
   * Digest of marginalia.outgoing.v1 after the adapter has prepared its exact prompt/schema
   * envelope. It excludes job, idempotency, grant, attempt, audit and timestamp identity.
   * T06 persists this unchanged as JobSnapshot.preparedPayloadDigest.
   */
  bindingDigest: string;
  sourceUrl: string;
  scope: ConsentScope;
  recipient: string;
  recipientLabel: string;
  provider: ProviderKind;
  policyKey: string;
  outgoing: OutgoingPart[];
};

export type ConsentPreview = {
  id: string;
  revision: number;
  requestId: string;
  site: string;
  scope: ConsentScope;
  scopeLabel: string;
  recipient: string;
  recipientLabel: string;
  provider: ProviderKind;
  policyKey: string;
  outgoing: OutgoingPart[];
  payloadDigest: string;
  bindingDigest: string;
  expiresAt: string;
  state: 'ready' | 'denied' | 'excluded';
};

/** The server constructs this after pairing/origin checks. It is never parsed from request JSON. */
export type ConsentPrincipal = {
  surface: 'browser-owned-margin' | 'localhost-settings';
  pairingId: string;
  origin: string;
};

export type ConsentGrant = {
  id: string;
  site: string;
  scope: ConsentScope;
  recipient: string;
  decision: GrantDecision;
  revision: number;
  requestId?: string;
  bindingDigest?: string;
  createdAt: string;
  revokedAt?: string;
};

export type ConsentAuthorization = {
  id: string;
  jobId: string;
  attemptId: string;
  grantId: string;
  grantRevision: number;
  /** Monotonic exclusion/allow epoch for the site when this attempt was authorized. */
  sitePermissionEpoch: number;
  site: string;
  scope: ConsentScope;
  recipient: string;
  provider: ProviderKind;
  policyKey: string;
  bindingDigest: string;
  permissionFingerprint: string;
  egressEventId: string;
  dispatchedAt?: string;
};

export type SiteExclusion = {
  site: string;
  revision: number;
  excluded: boolean;
  updatedAt: string;
};

export type FetchedResourceRecord = {
  requestedUrl: string;
  finalUrl: string;
  redirects: Array<{ url: string; status: number; location: string }>;
  status: number | null;
  contentType: string | null;
  sha256: string | null;
  bytes: number;
  fetchedAt: string;
  outcome: 'fetched' | 'rejected' | 'failed' | 'cancelled';
};

export type EgressRecord = {
  id: string;
  jobId: string;
  attemptId: string;
  grantId: string;
  grantRevision: number;
  recipient: string;
  scope: ConsentScope;
  provider: ProviderKind;
  policyKey: string;
  contextHashes: string[];
  permissionFingerprint: string;
  approvedAt: string;
  dispatchedAt?: string;
  outcome?: string;
  fetched: FetchedResourceRecord[];
  retrievalComplete: boolean;
};

export type ConsentDecisionRequest = {
  previewId: string;
  expectedRevision: number;
  choice: ConsentChoice;
};

export type ConsentSettingsChange =
  | { action: 'revoke-grant'; grantId: string; expectedRevision: number }
  | { action: 'set-exclusion'; site: string; excluded: boolean; expectedRevision?: number };
