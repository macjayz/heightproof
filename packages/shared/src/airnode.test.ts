import { describe, expect, it } from "vitest";
import {
  airnodePassthroughRequestHash,
  checkAirnodeAttestation,
  readAirnodeAttestation,
  recoverAirnodeSigner,
  reverifyAttestation
} from "./airnode.js";
import { hashRpcResult } from "./rpc.js";

// A real response from AirnodeHub's dRPC listing (eth_chainId on Base), captured as sent.
const URL_BASE = "https://airnode-drpc.fly.dev/api/ogrpc?network=base";
const REQUEST_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
const RESPONSE_BODY = '{"id":1,"jsonrpc":"2.0","result":"0x2105"}';
const SIGNED = {
  signer: "0x511AcE8648D2f64260d50D036F8f8ce622d92137",
  requestHash: "0x54a6129d7f43c1eca3275010c8dab07929f1a29f218c1a3943e20607ec43166c",
  timestamp: "1793476662",
  signature:
    "0x6c4a5442ff116c6d37d133d17155b22743226cc10d82f29bf226b25a8bdda6db24b375f87102c888b631d700af78bab5b55b3e0919d67dafee1242e110543bca1c"
};

describe("airnode passthrough request hash", () => {
  it("derives the hash the Airnode signed for this exact request", () => {
    expect(
      airnodePassthroughRequestHash({ method: "post", url: URL_BASE, body: REQUEST_BODY })
    ).toBe(SIGNED.requestHash);
  });

  it("ignores the Airnode's own x-airnode-* query parameters", () => {
    expect(
      airnodePassthroughRequestHash({
        method: "POST",
        url: `${URL_BASE}&x-airnode-sign=false`,
        body: REQUEST_BODY
      })
    ).toBe(SIGNED.requestHash);
  });

  it("changes with the body, so an answer cannot be replayed for another request", () => {
    const other = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] });
    expect(airnodePassthroughRequestHash({ method: "POST", url: URL_BASE, body: other })).not.toBe(
      SIGNED.requestHash
    );
  });

  it("refuses a URL that is not a passthrough route", () => {
    expect(
      airnodePassthroughRequestHash({
        method: "POST",
        url: "https://airnode-drpc.fly.dev/",
        body: ""
      })
    ).toBeUndefined();
  });
});

describe("airnode signature", () => {
  it("recovers the listed signer over the body exactly as received", () => {
    expect(recoverAirnodeSigner(SIGNED, RESPONSE_BODY)).toBe(SIGNED.signer.toLowerCase());
    expect(checkAirnodeAttestation(SIGNED, RESPONSE_BODY, SIGNED.requestHash)).toEqual({
      signatureValid: true,
      requestBound: true
    });
  });

  it("rejects a body that differs by a single character", () => {
    const tampered = RESPONSE_BODY.replace("0x2105", "0x2106");
    expect(checkAirnodeAttestation(SIGNED, tampered).signatureValid).toBe(false);
  });

  it("rejects a re-serialized body, which is why responses are read as text", () => {
    const reserialized = JSON.stringify(JSON.parse(RESPONSE_BODY), null, 1);
    expect(checkAirnodeAttestation(SIGNED, reserialized).signatureValid).toBe(false);
  });

  it("does not call an answer to a different request bound", () => {
    const check = checkAirnodeAttestation(SIGNED, RESPONSE_BODY, `0x${"0".repeat(64)}`);
    expect(check).toEqual({ signatureValid: true, requestBound: false });
  });

  it("treats a malformed signature as invalid instead of throwing", () => {
    expect(
      checkAirnodeAttestation({ ...SIGNED, signature: `0x${"00".repeat(65)}` }, RESPONSE_BODY)
    ).toEqual({
      signatureValid: false,
      requestBound: false
    });
  });
});

describe("readAirnodeAttestation", () => {
  it("reads the four headers", () => {
    const headers = new Headers({
      "X-Airnode-Address": SIGNED.signer,
      "X-Airnode-Request-Hash": SIGNED.requestHash,
      "X-Airnode-Timestamp": SIGNED.timestamp,
      "X-Airnode-Signature": SIGNED.signature
    });
    expect(readAirnodeAttestation(headers)).toEqual(SIGNED);
  });

  it("returns undefined when any header is missing or malformed", () => {
    expect(
      readAirnodeAttestation(new Headers({ "X-Airnode-Address": SIGNED.signer }))
    ).toBeUndefined();
    expect(
      readAirnodeAttestation(
        new Headers({
          "X-Airnode-Address": SIGNED.signer,
          "X-Airnode-Request-Hash": SIGNED.requestHash,
          "X-Airnode-Timestamp": "soon",
          "X-Airnode-Signature": SIGNED.signature
        })
      )
    ).toBeUndefined();
  });
});

describe("reverifyAttestation", () => {
  const resultHash = hashRpcResult("0x2105", "eth_chainId");
  const claimed = { ...SIGNED, signatureValid: true, signedBody: RESPONSE_BODY };

  it("keeps a signature that covers the compared result", () => {
    expect(
      reverifyAttestation(claimed, "eth_chainId", resultHash, hashRpcResult).signatureValid
    ).toBe(true);
  });

  it("drops a valid signature over some other answer", () => {
    const otherHash = hashRpcResult("0x1", "eth_chainId");
    expect(
      reverifyAttestation(claimed, "eth_chainId", otherHash, hashRpcResult).signatureValid
    ).toBe(false);
  });

  it("drops a verdict the SDK claimed without a body to check", () => {
    const withoutBody = { ...claimed, signedBody: undefined };
    expect(
      reverifyAttestation(withoutBody, "eth_chainId", resultHash, hashRpcResult).signatureValid
    ).toBe(false);
  });

  it("drops a forged verdict over a tampered body", () => {
    const forged = { ...claimed, signedBody: RESPONSE_BODY.replace("0x2105", "0x2106") };
    expect(
      reverifyAttestation(forged, "eth_chainId", resultHash, hashRpcResult).signatureValid
    ).toBe(false);
  });
});
