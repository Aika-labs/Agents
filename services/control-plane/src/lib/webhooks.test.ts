import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload } from "./webhooks.js";

describe("signPayload", () => {
  it("produces a sha256= prefixed hex signature", () => {
    const payload = '{"event":"agent.created"}';
    const secret = "test-secret-key";
    const sig = signPayload(payload, secret);

    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("matches manual HMAC-SHA256 computation", () => {
    const payload = '{"data":"hello"}';
    const secret = "my-secret";

    const expected = `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
    const actual = signPayload(payload, secret);

    expect(actual).toBe(expected);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "same-secret";
    const sig1 = signPayload("payload-1", secret);
    const sig2 = signPayload("payload-2", secret);

    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const payload = "same-payload";
    const sig1 = signPayload(payload, "secret-1");
    const sig2 = signPayload(payload, "secret-2");

    expect(sig1).not.toBe(sig2);
  });

  it("handles empty payload", () => {
    const sig = signPayload("", "secret");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("handles unicode payload", () => {
    const sig = signPayload('{"msg":"こんにちは"}', "secret");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
