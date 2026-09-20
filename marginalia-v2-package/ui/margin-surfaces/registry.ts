import { mountHomeSurface } from './home.ts';
import { mountReplySurface } from './reply.ts';
import { mountSettingsSurface } from './settings.ts';
import { mountLibrarySurface } from './library.ts';
import { mountMarksSurface } from './marks.ts';
import { mountSaveJourneySurface } from './save-journey.ts';
import { mountRecoverySurface } from './recovery.ts';

/** Concrete, stateless wiring. The coordinator invokes each mount at its existing
 * lifecycle phase; this registry never broadcasts updates or owns saved state. */
export const marginSurfaces = {
  home: mountHomeSurface,
  reply: mountReplySurface,
  settings: mountSettingsSurface,
  library: mountLibrarySurface,
  marks: mountMarksSurface,
  saveJourney: mountSaveJourneySurface,
  recovery: mountRecoverySurface,
} as const;
