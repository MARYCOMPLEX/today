import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIlinkSendFailure, sendImageMessage, sendTextMessage } from "../src/ilink";

describe("iLink send failure classification", () => {
  it("separates expired authorization from expired conversation context", () => {
    expect(classifyIlinkSendFailure({ ret: -14 })).toBe("stale_token");
    expect(classifyIlinkSendFailure({ ret: -2, errmsg: "prepare failed" })).toBe("stale_context");
    expect(classifyIlinkSendFailure({ ret: -2, errmsg: "another failure" })).toBe("rejected");
    expect(classifyIlinkSendFailure({ ret: 0 })).toBeNull();
  });
});

describe("iLink sendmessage boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses current headers, preserves raw Markdown, and omits Content-Length", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ret":0}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTextMessage({
      baseUrl: "https://ilink.example/",
      token: "bot-secret",
      toUserId: "owner@im.wechat",
      contextToken: "context-secret",
      clientId: "wx-notify:1-abcdef12",
      text: "**bold**\n- item",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body as string);
    expect(url.toString()).toBe("https://ilink.example/ilink/bot/sendmessage");
    expect(headers.Authorization).toBe("Bearer bot-secret");
    expect(headers.AuthorizationType).toBe("ilink_bot_token");
    expect(headers["iLink-App-Id"]).toBe("bot");
    expect(headers["Content-Length"]).toBeUndefined();
    expect(body.msg.text_item).toBeUndefined();
    expect(body.msg.item_list[0].text_item.text).toBe("**bold**\n- item");
    expect(body.msg.context_token).toBe("context-secret");
  });

  it("sends an encrypted CDN reference as an image item", async () => {
    const fetchMock = vi.fn(async () => new Response('{"ret":0}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendImageMessage({
      baseUrl: "https://ilink.example/", token: "bot-secret", toUserId: "owner@im.wechat",
      contextToken: "context-secret", clientId: "wx-image:1", downloadParam: "cdn-param",
      aesKeyBase64: "YWVzLWtleQ==", encryptedSize: 1024,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.msg.item_list).toEqual([{ type: 2, image_item: {
      media: { encrypt_query_param: "cdn-param", aes_key: "YWVzLWtleQ==", encrypt_type: 1 }, mid_size: 1024,
    } }]);
    expect(body.msg.context_token).toBe("context-secret");
  });

  it("retries transient network failures with the same client id", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response('{"ret":0}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sending = sendTextMessage({
      baseUrl: "https://ilink.example/", token: "bot-secret", toUserId: "owner@im.wechat",
      contextToken: "context-secret", clientId: "wx-notify:stable", text: "hello",
    });
    await vi.runAllTimersAsync();
    await expect(sending).resolves.toEqual({ ret: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies.map((body) => body.msg.client_id)).toEqual(["wx-notify:stable", "wx-notify:stable"]);
  });

  it("does not retry a permanent HTTP rejection", async () => {
    const fetchMock = vi.fn(async () => new Response("rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTextMessage({
      baseUrl: "https://ilink.example/", token: "bot-secret", toUserId: "owner@im.wechat",
      contextToken: "context-secret", clientId: "wx-notify:stable", text: "hello",
    })).rejects.toThrow("iLink HTTP 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
