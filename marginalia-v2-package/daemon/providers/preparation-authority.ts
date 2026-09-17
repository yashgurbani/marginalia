import type { ConsentAuthorization } from '../../contracts/consent.ts';

/** No dispatch timestamp or egress identity exists until the final shared-DB transaction. */
export type PreparationAuthorization = Omit<ConsentAuthorization, 'id' | 'egressEventId' | 'dispatchedAt'> & {
  readonly preparationOnly: true;
  readonly eligibilityFingerprint: string;
  readonly dispatchedAt?: never;
};
const issued = new WeakSet<object>();
/** Host-owned in-process capability. JSON from a page, reply or persisted file cannot forge it. */
export function preparationAuthorization(value: Omit<PreparationAuthorization, 'preparationOnly'>): PreparationAuthorization {
  const projection = Object.freeze({ ...value, preparationOnly: true as const }); issued.add(projection); return projection;
}
export function isPreparationAuthorization(value: object): value is PreparationAuthorization { return issued.has(value); }
