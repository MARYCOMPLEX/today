import { describe, expect, it } from "vitest";
import { bindingReadiness } from "../src/gateway";
import type { BindingRow } from "../src/types";

describe("WeChat binding readiness", () => {
  const binding = (status: BindingRow["status"], context: string | null): BindingRow => ({
    user_id: "user-1",
    generation: "generation-1",
    bot_token_ciphertext: "bot-token",
    context_token_ciphertext: context,
    base_url: "https://ilink.example",
    bot_id: "bot-1",
    owner_user_id: "owner-1",
    cursor: "",
    status,
    bound_at: 1,
    context_updated_at: null,
    last_poll_at: null,
    last_error: null,
  });

  it.each([
    [null, "wechat_not_bound"],
    [binding("pending_context", null), "context_required"],
    [binding("pending_context", "stale"), "context_required"],
    [binding("reauth_required", "stale"), "reauth_required"],
    [binding("active", null), "context_required"],
  ])("maps an unavailable binding to %s", (row, expected) => {
    const readiness = bindingReadiness(row);
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) expect(readiness.error).toBe(expected);
  });

  it("returns the proven ready binding", () => {
    const row = binding("active", "current");
    const readiness = bindingReadiness(row);
    expect(readiness.ready).toBe(true);
    if (readiness.ready) expect(readiness.binding).toBe(row);
  });
});
