const UTC8_OFFSET_MINUTES = 8 * 60;

function localMinutes(now: Date): number {
  const total = Math.floor(now.getTime() / 60_000) + UTC8_OFFSET_MINUTES;
  return ((total % 1440) + 1440) % 1440;
}

export function isQuietHours(now: Date, start: number, end: number): boolean {
  const minute = localMinutes(now);
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function nextQuietEnd(now: Date, start: number, end: number): string | null {
  if (!isQuietHours(now, start, end)) return null;
  const local = new Date(now.getTime() + UTC8_OFFSET_MINUTES * 60_000);
  let localEnd = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, end);
  if (localMinutes(now) >= end) localEnd += 24 * 60 * 60_000;
  return new Date(localEnd - UTC8_OFFSET_MINUTES * 60_000).toISOString();
}

export function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
