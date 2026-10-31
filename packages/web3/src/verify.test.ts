import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { airnodePassthroughRequestHash } from "@heightproof/shared";
import { describe, expect, it, vi } from "vitest";
import { airnodeDrpcEndpoint, RpcVerifier } from "./verify.js";

const endpoints = [
  { rpcUrl: "https://a.example/key-a", provider: "alchemy" },
  { rpcUrl: "https://b.example/key-b", provider: "infura" }
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("eligibility", () => {
  const always = { random: () => 0, endpoints };

  it("only verifies deterministic reads", () => {
    const verifier = new RpcVerifier({ ...always, sampleRate: 1 });

    expect(verifier.shouldVerify("eth_call")).toBe(true);
    expect(verifier.shouldVerify("eth_getBalance")).toBe(true);
    // Legitimately different between endpoints — comparing these would report every
    // sample as a disagreement.
    expect(verifier.shouldVerify("eth_gasPrice")).toBe(false);
    expect(verifier.shouldVerify("eth_estimateGas")).toBe(false);
    expect(verifier.shouldVerify("eth_sendRawTransaction")).toBe(false);
  });

  it("respects the sample rate", () => {
    const rare = new RpcVerifier({ endpoints, sampleRate: 0.01, random: () => 0.5 });
    const certain = new RpcVerifier({ endpoints, sampleRate: 0.01, random: () => 0.001 });

    expect(rare.shouldVerify("eth_call")).toBe(false);
    expect(certain.shouldVerify("eth_call")).toBe(true);
  });

  it("does nothing when no endpoints are configured", () => {
    const verifier = new RpcVerifier({ endpoints: [], sampleRate: 1, random: () => 0 });

    expect(verifier.shouldVerify("eth_call")).toBe(false);
  });

  it("stops once the per-minute ceiling is reached", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1" }));
    // Ceiling of 4 with 2 endpoints allows exactly two fan-outs.
    const verifier = new RpcVerifier({
      endpoints,
      sampleRate: 1,
      maxCallsPerMinute: 4,
      random: () => 0,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16")).toBeDefined();
    expect(await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16")).toBeDefined();
    expect(await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16")).toBeUndefined();
    expect(verifier.shouldVerify("eth_call")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("frees budget again once the window rolls forward", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1" }));
    const verifier = new RpcVerifier({
      endpoints,
      sampleRate: 1,
      maxCallsPerMinute: 2,
      random: () => 0,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16");
    expect(verifier.shouldVerify("eth_call")).toBe(false);

    now += 61_000;
    expect(verifier.shouldVerify("eth_call")).toBe(true);
  });
});

describe("pinning", () => {
  it("asks every endpoint the same pinned question", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x64" }));
    const verifier = new RpcVerifier({
      endpoints,
      sampleRate: 1,
      random: () => 0,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16");

    expect(run?.pinnedParams).toEqual([{ to: "0xabc" }, "0x10"]);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      // Never `latest` on the wire: that would measure head skew, not disagreement.
      expect(body.params).toEqual([{ to: "0xabc" }, "0x10"]);
    }
  });

  it("refuses to verify a call that cannot be pinned", async () => {
    const fetchImpl = vi.fn();
    const verifier = new RpcVerifier({
      endpoints,
      sampleRate: 1,
      random: () => 0,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(await verifier.verify("eth_call", [{ to: "0xabc" }, "pending"], "16")).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prefers a height the primary response already carries", async () => {
    const fetchImpl = vi.fn();
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(await verifier.resolvePinHeight("500", "https://a.example/key-a")).toBe("500");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves and caches a head when the call was unpinned", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async () => jsonResponse({ result: "0x1b4" }));
    const verifier = new RpcVerifier({
      endpoints,
      headCacheMs: 2_000,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(await verifier.resolvePinHeight(undefined, "https://a.example/key-a")).toBe("436");
    expect(await verifier.resolvePinHeight(undefined, "https://a.example/key-a")).toBe("436");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 3_000;
    await verifier.resolvePinHeight(undefined, "https://a.example/key-a");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up rather than guessing when no height can be established", async () => {
    const verifier = new RpcVerifier({ endpoints });

    expect(await verifier.resolvePinHeight(undefined, undefined)).toBeUndefined();
  });
});

describe("observations", () => {
  it("hashes each endpoint's answer so they can be compared", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      jsonResponse({ result: url.includes("a.example") ? "0x64" : "0x65" })
    );
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_getBalance", ["0xabc", "latest"], "16");
    const [a, b] = run!.observations;

    expect(a.provider).toBe("alchemy");
    expect(b.provider).toBe("infura");
    expect(a.resultHash).not.toBe(b.resultHash);
    expect(a.missingBlock).toBe(false);
  });

  it("marks an endpoint that lacks the block rather than calling it a disagreement", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: -32000, message: "header not found" } })
    );
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_getBalance", ["0xabc", "latest"], "16");

    expect(run!.observations[0].missingBlock).toBe(true);
    expect(run!.observations[0].rpcErrorCode).toBe(-32000);
    expect(run!.observations[0].resultHash).toBeUndefined();
  });

  it("treats a null result as a lagging endpoint, not a null answer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ result: null }));
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_getTransactionReceipt", ["0xdead"], "16");

    expect(run!.observations[0].missingBlock).toBe(true);
  });

  it("never rejects when an endpoint is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_call", [{ to: "0xabc" }, "latest"], "16");

    expect(run!.observations).toHaveLength(2);
    expect(run!.observations[0].rpcErrorMessage).toBe("ECONNREFUSED");
    expect(run!.observations[0].missingBlock).toBe(false);
  });

  it("captures the block hash so reorg tracking has something to compare", async () => {
    const hash = `0x${"a".repeat(64)}`;
    const fetchImpl = vi.fn(async () => jsonResponse({ result: { blockHash: hash, blockNumber: "0x10" } }));
    const verifier = new RpcVerifier({
      endpoints,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_getTransactionReceipt", ["0xdead"], "16");

    expect(run!.observations[0].blockHash).toBe(hash);
  });
});

describe("airnode-attested endpoints", () => {
  // A stand-in Airnode: signs whatever it answers exactly as the real one does.
  const privateKey = secp256k1.utils.randomPrivateKey();
  const signer = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(-20))}`;

  function signedResponse(requestHash: string, text: string, timestamp = 1_793_476_662n) {
    const digest = keccak_256(
      concatBytes(hexToBytes(requestHash.slice(2)), hexToBytes(timestamp.toString(16).padStart(64, "0")), utf8ToBytes(text))
    );
    const signature = secp256k1.sign(
      keccak_256(concatBytes(utf8ToBytes("\x19Ethereum Signed Message:\n32"), digest)),
      privateKey
    );
    const encoded = `0x${bytesToHex(signature.toCompactRawBytes())}${(signature.recovery + 27).toString(16)}`;

    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-airnode-address": signer,
        "x-airnode-request-hash": requestHash,
        "x-airnode-timestamp": timestamp.toString(),
        "x-airnode-signature": encoded
      }
    });
  }

  function fakeAirnode(answer: (requestHash: string) => Response) {
    return vi.fn(async (url: string, init: RequestInit) =>
      answer(airnodePassthroughRequestHash({ method: "POST", url, body: String(init.body) })!)
    );
  }

  it("builds a passthrough endpoint for the dRPC listing", () => {
    expect(airnodeDrpcEndpoint({ network: "base" })).toMatchObject({
      rpcUrl: "https://airnode-drpc.fly.dev/api/ogrpc?network=base",
      provider: "airnode-drpc",
      attestation: "airnode"
    });
  });

  it("keeps a valid, request-bound attestation with the signed body", async () => {
    const text = '{"id":1,"jsonrpc":"2.0","result":"0x64"}';
    const airnodeFetch = fakeAirnode((hash) => signedResponse(hash, text));
    const verifier = new RpcVerifier({
      endpoints: [airnodeDrpcEndpoint({ network: "base", fetchImpl: airnodeFetch as unknown as typeof fetch })]
    });

    const run = await verifier.verify("eth_getBalance", ["0xabc", "latest"], "100");
    const attestation = run!.observations[0]!.attestation;

    expect(airnodeFetch).toHaveBeenCalledTimes(1);
    expect(attestation).toMatchObject({
      scheme: "airnode",
      signer,
      signatureValid: true,
      requestBound: true,
      signedBody: text
    });
  });

  it("flags an answer signed for a different request", async () => {
    const airnodeFetch = fakeAirnode(() =>
      signedResponse(`0x${"ab".repeat(32)}`, '{"id":1,"jsonrpc":"2.0","result":"0x64"}')
    );
    const verifier = new RpcVerifier({
      endpoints: [airnodeDrpcEndpoint({ network: "base", fetchImpl: airnodeFetch as unknown as typeof fetch })]
    });

    const run = await verifier.verify("eth_getBalance", ["0xabc", "latest"], "100");

    expect(run!.observations[0]!.attestation).toMatchObject({ signatureValid: true, requestBound: false });
  });

  it("records an unpaid 402 as a failed observation, never as an answer", async () => {
    const unpaid = vi.fn(async () =>
      new Response('{"error":"Payment required"}', { status: 402, headers: { "content-type": "application/json" } })
    );
    const verifier = new RpcVerifier({
      endpoints: [airnodeDrpcEndpoint({ network: "base", fetchImpl: unpaid as unknown as typeof fetch })]
    });

    const observation = (await verifier.verify("eth_getBalance", ["0xabc", "latest"], "100"))!.observations[0]!;

    expect(observation.resultHash).toBeUndefined();
    expect(observation.rpcErrorMessage).toContain("402");
    expect(observation.attestation).toBeUndefined();
  });

  it("uses each endpoint's own fetch and the shared one for the rest", async () => {
    const shared = vi.fn(async () => jsonResponse({ result: "0x64" }));
    const paying = fakeAirnode((hash) => signedResponse(hash, '{"id":1,"jsonrpc":"2.0","result":"0x64"}'));
    const verifier = new RpcVerifier({
      endpoints: [
        { rpcUrl: "https://a.example/key-a", provider: "alchemy" },
        airnodeDrpcEndpoint({ network: "base", fetchImpl: paying as unknown as typeof fetch })
      ],
      fetchImpl: shared as unknown as typeof fetch
    });

    const run = await verifier.verify("eth_getBalance", ["0xabc", "latest"], "100");

    expect(shared).toHaveBeenCalledTimes(1);
    expect(paying).toHaveBeenCalledTimes(1);
    expect(run!.observations[0]!.attestation).toBeUndefined();
    expect(run!.observations[1]!.resultHash).toBe(run!.observations[0]!.resultHash);
  });
});
