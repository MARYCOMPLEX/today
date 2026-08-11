const MAX_WEIXIN_TEXT = 4000;
export const MAX_QUEUE_ATTEMPTS = 12;
const MAX_QUEUE_RETRY_DELAY_MS = 60 * 60_000;
export interface QueuedNotification { id: string; text: string; createdAt: number }
export interface QueueRetryDecision { attemptCount: number; nextAttemptAt: number; failedAt: number | null }

export function nextQueueAttemptAt(now: number, failedAttemptCount: number): number {
  const exponent = Math.max(0, failedAttemptCount - 1);
  return now + Math.min(60_000 * (2 ** exponent), MAX_QUEUE_RETRY_DELAY_MS);
}

export function queueRetryDecision(now: number, previousAttemptCount: number): QueueRetryDecision {
  const attemptCount = previousAttemptCount + 1;
  return {
    attemptCount,
    nextAttemptAt: nextQueueAttemptAt(now, attemptCount),
    failedAt: attemptCount >= MAX_QUEUE_ATTEMPTS ? now : null,
  };
}

function utc8Time(timestamp: number): string {
  const date = new Date(timestamp + 8 * 60 * 60_000);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function buildDigestChunks(items: QueuedNotification[]): string[] {
  if (items.length === 0) return [];
  const title = `# 延迟通知汇总（${items.length} 条）`;
  const sections = items.map((item) => `## ${utc8Time(item.createdAt)}\n${item.text}`);
  const chunks: string[] = [];
  let current = title;
  for (const section of sections) {
    let remaining = section;
    while (remaining.length) {
      const separator = current === title ? "\n\n" : "\n\n---\n\n";
      const available = MAX_WEIXIN_TEXT - current.length - separator.length;
      if (available <= 0) { chunks.push(current); current = title; continue; }
      current += separator + remaining.slice(0, available);
      remaining = remaining.slice(available);
      if (remaining.length) { chunks.push(current); current = `${title}\n\n（续）`; }
    }
  }
  if (current !== title) chunks.push(current);
  return chunks;
}
