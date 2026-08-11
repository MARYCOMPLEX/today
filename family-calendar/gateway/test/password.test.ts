import { describe, expect, it } from "vitest";
import { passwordProblem, validChinaPhone } from "../src/password";

describe("credential validation", () => {
  it("accepts a non-trivial 12+ character password", () => {
    expect(passwordProblem("Mango!River-2026", "person@example.com", null)).toBeNull();
  });
  it("rejects pure digits and identity fragments", () => {
    expect(passwordProblem("123456789012", "person@example.com", null)).not.toBeNull();
    expect(passwordProblem("person-is-here!2026", "person@example.com", null)).not.toBeNull();
    expect(passwordProblem("Good!13812345678", "person@example.com", "13812345678")).not.toBeNull();
  });
  it("accepts only mainland China mobile numbers", () => {
    expect(validChinaPhone("13812345678")).toBe(true);
    expect(validChinaPhone("12812345678")).toBe(false);
    expect(validChinaPhone("+8613812345678")).toBe(false);
  });
});
