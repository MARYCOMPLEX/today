import { describe, expect, it } from "vitest";
import { clientIdFromIdempotencyKey, openJson, sealJson, secureEqual } from "../src/crypto";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("crypto", () => {
  it("round-trips sealed JSON and binds AAD", async () => {
    const sealed = await sealJson({ token: "secret" }, key, "account/current");
    await expect(openJson(sealed, key, "account/current")).resolves.toEqual({ token: "secret" });
    await expect(openJson(sealed, key, "context/other")).rejects.toThrow();
    expect(sealed).not.toContain("secret");
  });

  it("compares bearer values without comparing raw strings", async () => {
    await expect(secureEqual("same", "same")).resolves.toBe(true);
    await expect(secureEqual("same", "different")).resolves.toBe(false);
  });

  it("derives a stable iLink client id", async () => {
    const first = await clientIdFromIdempotencyKey("deploy-123");
    const second = await clientIdFromIdempotencyKey("deploy-123");
    expect(first).toBe(second);
    expect(first).toMatch(/^wx-notify:\d+-[0-9a-f]{8}$/);
  });
});
