export type JourneyMember = { threadId: string; sourceVersionId: string };
export type JourneyReason = {
  left: JourneyMember; right: JourneyMember; sharedTerms: string[];
  sameAddress: boolean; nearbySavedActivity: boolean; score: number;
};
export type SuggestedJourney = {
  id: string; name: string; members: JourneyMember[]; reasons: JourneyReason[];
  origin: 'local'; algorithm: 'saved-activity-complete-link.v1';
};
export type ReaderJourney = { id: string; name: string; members: JourneyMember[] };
export type JourneyEdits = { revision: number; journeys: ReaderJourney[] };
export type JourneyEditChange = {
  operationId: string; date: string; timeZone: string; expectedRevision: number; journeys: ReaderJourney[];
};
