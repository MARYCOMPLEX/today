import { describe, expect, it } from "vitest";
import { dashboardPage, loginPage, registerPage } from "../src/pages";

const repositoryUrl = "https://github.com/frankie0736/wx-clawbot-notify-webhook";

describe("global repository link", () => {
  it.each([
    ["login", () => loginPage()],
    ["register", () => registerPage("")],
    ["dashboard", () => dashboardPage({
      email: "user@example.com",
      role: "user",
      origin: "https://example.com",
      quietStart: 0,
      quietEnd: 420,
      bindingStatus: null,
      phone: null,
    })],
  ])("renders on the %s page", (_name, render) => {
    const markup = String(render());

    expect(markup).toContain(`<footer class="site-footer">`);
    expect(markup).toContain(`href="${repositoryUrl}"`);
    expect(markup).toContain(`aria-label="GitHub 仓库"`);
  });
});

describe("WeChat binding actions", () => {
  const renderDashboard = (bindingStatus: "pending_context" | "active" | "reauth_required" | null) => String(dashboardPage({
    email: "user@example.com",
    role: "user",
    origin: "https://example.com",
    quietStart: 0,
    quietEnd: 420,
    bindingStatus,
    phone: null,
  }));

  it("does not offer QR login while the authorization is active", () => {
    const markup = renderDashboard("active");
    expect(markup).not.toContain(`id="bindWechat"`);
    expect(markup).toContain("绑定正常，可以接收通知。");
  });

  it("asks for init when only the conversation context is missing", () => {
    const markup = renderDashboard("pending_context");
    expect(markup).not.toContain(`id="bindWechat"`);
    expect(markup).toContain("给 Bot 发送 init");
  });

  it.each([
    [null, "扫码绑定"],
    ["reauth_required" as const, "重新扫码绑定"],
  ])("offers the correct QR action for %s", (bindingStatus, label) => {
    const markup = renderDashboard(bindingStatus);
    expect(markup).toContain(`id="bindWechat"`);
    expect(markup).toContain(`>${label}</button>`);
  });
});
