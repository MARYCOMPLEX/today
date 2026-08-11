import { afterEach, describe, expect, it, vi } from "vitest";
import { detectImageType, MAX_IMAGE_BYTES, uploadImage, validateImage } from "../src/image";
import { getImageUploadUrl } from "../src/ilink";

vi.mock("../src/ilink", () => ({
  getImageUploadUrl: vi.fn(async () => ({ ret: 0, upload_full_url: "https://cdn.example/upload" })),
}));

describe("image boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recognizes JPEG, PNG and WebP by signature", () => {
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff]))?.mime).toBe("image/jpeg");
    expect(detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(detectImageType(new TextEncoder().encode("RIFF1234WEBP"))?.mime).toBe("image/webp");
  });

  it("rejects SVG even when a caller labels it as an image", () => {
    expect(() => validateImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toThrow("unsupported_image_type");
  });

  it("enforces the 20 MiB service boundary", () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    expect(() => validateImage(oversized)).toThrow("image_max_20_mib");
  });

  it("encrypts with PKCS7 and uploads directly to WeChat CDN", async () => {
    const cdnFetch = vi.fn(async () => new Response(null, { status: 200, headers: { "x-encrypted-param": "download-param" } }));
    vi.stubGlobal("fetch", cdnFetch);
    const uploaded = await uploadImage({ baseUrl: "https://ilink.example", token: "secret", toUserId: "owner", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1]) });
    expect(uploaded.encryptedSize).toBe(16);
    expect(uploaded.downloadParam).toBe("download-param");
    expect(vi.mocked(getImageUploadUrl)).toHaveBeenCalledWith(expect.objectContaining({ rawSize: 4, encryptedSize: 16 }));
    const [, init] = cdnFetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.body as Uint8Array).byteLength).toBe(16);
  });

  it("retries a transient CDN network failure", async () => {
    vi.useFakeTimers();
    const cdnFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-encrypted-param": "download-param" } }));
    vi.stubGlobal("fetch", cdnFetch);
    const uploading = uploadImage({ baseUrl: "https://ilink.example", token: "secret", toUserId: "owner", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1]) });
    await vi.runAllTimersAsync();
    await expect(uploading).resolves.toMatchObject({ downloadParam: "download-param" });
    expect(cdnFetch).toHaveBeenCalledTimes(2);
  });
});
