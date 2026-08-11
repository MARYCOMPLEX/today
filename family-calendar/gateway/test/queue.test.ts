import { describe, expect, it } from "vitest";
import { buildDigestChunks, MAX_QUEUE_ATTEMPTS, queueRetryDecision } from "../src/queue";

describe("digest", () => {
  it("combines notifications and never exceeds the Weixin text limit", () => {
    const chunks = buildDigestChunks([
      { id: "a", text: "first", createdAt: Date.parse("2026-07-18T16:20:00Z") },
      { id: "b", text: "x".repeat(5000), createdAt: Date.parse("2026-07-18T17:30:00Z") },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
    expect(chunks.join("\n")).toContain("first");
  });

  it("backs off to one hour and becomes terminal at the attempt limit", () => {
    const now = Date.parse("2026-07-18T23:00:00Z");
    expect(queueRetryDecision(now, 0)).toEqual({
      attemptCount: 1,
      nextAttemptAt: now + 60_000,
      failedAt: null,
    });
    expect(queueRetryDecision(now, 7).nextAttemptAt).toBe(now + 60 * 60_000);
    expect(queueRetryDecision(now, MAX_QUEUE_ATTEMPTS - 1)).toEqual({
      attemptCount: MAX_QUEUE_ATTEMPTS,
      nextAttemptAt: now + 60 * 60_000,
      failedAt: now,
    });
  });
});
