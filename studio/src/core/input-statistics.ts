export interface FlickMetrics { count: number; peak_mps: number; distance_cm: number }
export interface InputStatistics {
  profileId: string;
  counters: ReadonlyMap<string, number>;
  flicks: ReadonlyMap<string, FlickMetrics>;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80;
}
function nonnegative(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}
function readRows<T>(raw: unknown, decode: (value: unknown) => T | undefined): Map<string, T> | undefined {
  if (!Array.isArray(raw) || raw.length > 32) return;
  const rows = new Map<string, T>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 2 || !identifier(row[0]) || rows.has(row[0])) return;
    const value = decode(row[1]);
    if (value === undefined) return;
    rows.set(row[0], value);
  }
  return rows;
}
export function decodeStatistics(packet: Record<string, unknown>): InputStatistics | undefined {
  if (!identifier(packet.profile_id)) return;
  const counters = readRows(packet.counters, value => nonnegative(value, 0xffff_ffff) ? value : undefined);
  const flicks = readRows(packet.flicks, value => {
    if (!value || typeof value !== 'object') return;
    const flick = value as Record<string, unknown>;
    if (!nonnegative(flick.count, 2048) || !Number.isInteger(flick.count)
        || !nonnegative(flick.peak_mps, 100) || !nonnegative(flick.distance_cm, 1e9)) return;
    return { count: flick.count, peak_mps: flick.peak_mps, distance_cm: flick.distance_cm };
  });
  if (!counters || !flicks || counters.size + flicks.size > 32) return;
  return { profileId: packet.profile_id, counters, flicks };
}
