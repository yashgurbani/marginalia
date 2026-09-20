/** Read-only data shared by the concrete surface views. Authority stays at the caller. */
export type SurfaceSection = { title: string; start: number; end: number };
export type PageSurface = { sections: readonly SurfaceSection[] };
export type SurfaceAction = () => unknown;
