/** Normalize before subtracting so finite endpoints need not have a finite span.
 * Undefined means the graphic must decline this range, not alter the data.
 */
export function plotCoordinate(value: number, bounds: readonly [number, number], start: number, size: number): number | undefined {
  if (![value, ...bounds, start, size].every(Number.isFinite) || bounds[0] >= bounds[1]) return undefined;
  const scale = Math.max(Math.abs(bounds[0]), Math.abs(bounds[1]));
  const width = bounds[1] / scale - bounds[0] / scale;
  if (!(width > 0)) return undefined;
  const coordinate = start + (value / scale - bounds[0] / scale) / width * size;
  return Number.isFinite(coordinate) ? coordinate : undefined;
}

/** Convex combination avoids overflowing max-min when generating axis ticks. */
export function plotTick(bounds: readonly [number, number], index: number): number {
  return bounds[0] * (1 - index / 4) + bounds[1] * (index / 4);
}
