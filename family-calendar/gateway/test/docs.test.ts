import { describe, expect, it } from "vitest";
import { apiMarkdown } from "../src/pages";

describe("public API documentation", () => {
  it("derives every example from the current origin", () => {
    const docs = apiMarkdown("https://notify.example");
    expect(docs).toContain("Base URL: https://notify.example");
    expect(docs).toContain("https://notify.example/api/v1/notify/image");
  });

  it("documents the enforced image boundary", () => {
    const docs = apiMarkdown("https://notify.example");
    expect(docs).toContain("JPEG、PNG 或 WebP");
    expect(docs).toContain("最大 20 MiB");
    expect(docs).toContain("SVG：明确不支持");
    expect(docs).not.toContain("图片说明");
    expect(docs).not.toContain("caption_sent");
  });

  it("documents bounded delivery retries", () => {
    const docs = apiMarkdown("https://notify.example");
    expect(docs).toContain("网络错误最多自动尝试 3 次");
    expect(docs).toContain("连续失败 12 次后标记为最终失败");
  });
});
