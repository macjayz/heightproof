import { hashRpcResult } from "@heightproof/shared";
import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./worker.js";
import { parseStreamMessage } from "./stream.js";

const event = {
  id: "event-stream-1",
  projectId: "demo",
  serviceName: "api",
  timestamp: "2026-09-01T20:12:00.000Z",
  kind: "rest",
  request: { method: "GET", path: "/health" },
  response: { statusCode: 200, latencyMs: 3 }
};

describe("parseStreamMessage", () => {
  it("parses a well-formed event", () => {
    const parsed = parseStreamMessage(["event", JSON.stringify(event)]);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.id).toBe("event-stream-1");
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseStreamMessage(["event", "not-json"])).toEqual({
      ok: false,
      reason: "invalid_json"
    });
  });

  it("reports a missing event field", () => {
    expect(parseStreamMessage(["payload", "{}"])).toEqual({
      ok: false,
      reason: "missing_event_field"
    });
  });

  it("does not mistake a field value of 'event' for the field name", () => {
    expect(parseStreamMessage(["kind", "event"])).toEqual({
      ok: false,
      reason: "missing_event_field"
    });
  });

  it("reports events that fail the schema", () => {
    expect(parseStreamMessage(["event", JSON.stringify({ id: "x" })])).toEqual({
      ok: false,
      reason: "schema_mismatch"
    });
  });

  describe("airnode attestations", () => {
    // A real AirnodeHub dRPC answer (eth_chainId on Base) and its signature.
    const signedBody = '{"id":1,"jsonrpc":"2.0","result":"0x2105"}';
    const attested = (attestation: Record<string, unknown>) => ({
      ...event,
      kind: "evm_rpc",
      request: { method: "POST", path: "/rpc" },
      evmRpc: {
        method: "eth_chainId",
        resultHash: hashRpcResult("0x2105", "eth_chainId"),
        attestation: {
          scheme: "airnode",
          signer: "0x511AcE8648D2f64260d50D036F8f8ce622d92137",
          requestHash: "0x54a6129d7f43c1eca3275010c8dab07929f1a29f218c1a3943e20607ec43166c",
          timestamp: "1793476662",
          signature:
            "0x6c4a5442ff116c6d37d133d17155b22743226cc10d82f29bf226b25a8bdda6db24b375f87102c888b631d700af78bab5b55b3e0919d67dafee1242e110543bca1c",
          signatureValid: true,
          requestBound: true,
          signedBody,
          ...attestation
        }
      }
    });

    function verdict(attestation: Record<string, unknown>) {
      const parsed = parseStreamMessage(["event", JSON.stringify(attested(attestation))]);
      if (!parsed.ok) throw new Error(parsed.reason);
      return parsed.event.evmRpc?.attestation?.signatureValid;
    }

    it("keeps a signature it can re-check itself", () => {
      expect(verdict({})).toBe(true);
    });

    it("overrules an SDK that vouched for a tampered body", () => {
      expect(verdict({ signedBody: signedBody.replace("0x2105", "0x2106") })).toBe(false);
    });

    it("overrules an SDK verdict it has no body to check", () => {
      expect(verdict({ signedBody: undefined })).toBe(false);
    });
  });
});

describe("backoffDelayMs", () => {
  it("doubles from one second and caps at thirty", () => {
    expect([1, 2, 3, 5, 6, 10].map(backoffDelayMs)).toEqual([
      1000, 2000, 4000, 16000, 30000, 30000
    ]);
  });
});
