// A unique id that works in every browser context.
//
// `crypto.randomUUID` exists only in a secure context. A page served over
// plain HTTP on a LAN address — the shape ADR 0031 makes possible — is not
// one, and there the call throws "crypto.randomUUID is not a function",
// which takes the client down before it can render anything.
// `crypto.getRandomValues` is available in every context, so the id is
// built from it when `randomUUID` is missing.
//
// The id correlates one request with its answer. It is not a credential:
// the runtime only has to tell two requests apart, and the credential is
// the per-start token the service issues.

export function randomId(): string {
  const webCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    // Version 4, variant 1: the bits a `randomUUID` would have set.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // A context without WebCrypto at all still gets a distinct id.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
