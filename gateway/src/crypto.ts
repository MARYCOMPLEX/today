const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SealedValue {
  v: 1;
  iv: string;
  data: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.byteLength !== 32) throw new Error("MASTER_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealJson(value: unknown, base64Key: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(base64Key);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  const sealed: SealedValue = {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(sealed);
}

export async function openJson<T>(sealedText: string, base64Key: string, aad: string): Promise<T> {
  const sealed = JSON.parse(sealedText) as SealedValue;
  if (sealed.v !== 1 || typeof sealed.iv !== "string" || typeof sealed.data !== "string") {
    throw new Error("invalid sealed value");
  }
  const key = await importKey(base64Key);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(sealed.iv), additionalData: encoder.encode(aad) },
    key,
    base64ToBytes(sealed.data),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}

export async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Hex(value: string): Promise<string> {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function clientIdFromIdempotencyKey(key: string): Promise<string> {
  const digest = await sha256Bytes(key);
  let numeric = 0n;
  for (const byte of digest.slice(0, 6)) numeric = (numeric << 8n) | BigInt(byte);
  const suffix = Array.from(digest.slice(6, 10), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `wx-notify:${numeric}-${suffix}`;
}

export function randomClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `wx-notify:${Date.now()}-${suffix}`;
}
