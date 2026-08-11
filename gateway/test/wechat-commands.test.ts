import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";

// mock 微信发送
const sent: string[] = [];
vi.mock("../src/ilink", () => ({
  sendTextMessage: vi.fn(async (p: { text: string }) => { sent.push(p.text); return { ret: 0 }; }),
}));

// mock GitHub 事件数据
const mockEvents = [
  { id: "mom", name: "妈妈生日", person: "妈妈", calendar: "lunar", month: 8, day: 15, leap_policy: "leap_first", birth_year: 1962 },
  { id: "anniv", name: "结婚纪念日", person: "爸妈", calendar: "solar", month: 10, day: 1, birth_year: 1988 },
  { id: "kid", name: "孩子生日", person: "宝宝", calendar: "solar", month: 2, day: 29, birth_year: 2020 },
];
vi.mock("../src/github", () => ({
  fetchEvents: vi.fn(async () => ({ events: mockEvents })),
}));

import { handleCommand, type CommandContext } from "../src/wechat-commands";

const ctx: CommandContext = {
  env: { DB: {} as never } as unknown as Env,
  userId: "u1", baseUrl: "https://example.com", botToken: "tok", toUserId: "self", contextToken: "c1",
};

describe("wechat commands", () => {
  it("日历命令列出全部事件", async () => {
    sent.length = 0;
    const ok = await handleCommand(ctx, "日历");
    expect(ok).toBe(true);
    expect(sent.join("\n")).toContain("家庭日历（共 3 条）");
    expect(sent.join("\n")).toContain("妈妈生日");
    expect(sent.join("\n")).toContain("农历 8月15日");
  });

  it("最近命令显示未来 5 天", async () => {
    sent.length = 0;
    const ok = await handleCommand(ctx, "最近");
    expect(ok).toBe(true);
    // 以真实今天计算，妈妈生日(农历8/15)若在5天内会出现
    expect(sent.length).toBeGreaterThan(0);
  });

  it("帮助命令列出所有命令", async () => {
    sent.length = 0;
    const ok = await handleCommand(ctx, "帮助");
    expect(ok).toBe(true);
    const text = sent.join("\n");
    for (const cmd of ["添加日期", "删除日期", "日历", "今天", "最近", "测试", "状态", "帮助"]) {
      expect(text).toContain(cmd);
    }
  });

  it("测试命令回复链路正常", async () => {
    sent.length = 0;
    const ok = await handleCommand(ctx, "测试");
    expect(ok).toBe(true);
    expect(sent[0]).toContain("命令链路正常");
  });

  it("未知命令不处理", async () => {
    sent.length = 0;
    const ok = await handleCommand(ctx, "随便说点什么");
    expect(ok).toBe(false);
    expect(sent.length).toBe(0);
  });
});
