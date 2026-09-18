import { defaultAutoAssistSettings, type AutoAssistPosture } from '../../contracts/auto-assist.ts';
import { FakeAutoAssistTransport, type AutoAssistTransport } from '../auto-assist/transport.ts';

export type PostureTransport = AutoAssistTransport;

/** A deterministic in-memory boundary for posture UI tests and offline demos. */
export class FakePostureTransport extends FakeAutoAssistTransport {
  constructor(posture: AutoAssistPosture = 'balanced') { super({ ...defaultAutoAssistSettings(), posture }); }
}
