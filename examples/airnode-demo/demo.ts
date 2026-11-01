/**
 * A provider serves wrong data with HTTP 200, and Heightproof catches it with signed proof.
 *
 * "your-provider" is a local stand-in for a misbehaving RPC: it proxies Base mainnet but
 * answers block requests with a cached block from 40 blocks earlier. The other side is a real,
 * paid call through AirnodeHub's dRPC listing, whose answer is signed by its Airnode. Both are
 * asked the same question at the same pinned height, and detector D2 judges the result.
 *
 * Needs a wallet holding aUSD on Base Sepolia (see README). Usage:
 *   AIRNODE_PAYER_KEY=0x... npm run demo -w examples/airnode-demo
 */
import { randomUUID } from "node:crypto";
import { RpcVerifier, airnodeDrpcEndpoint } from "@heightproof/web3";
import { detectDisagreement, type HeightproofEvent } from "@heightproof/shared";
import { UPSTREAM, payingFetch, startStaleProvider } from "./setup.js";

const fetchImpl = payingFetch();
const stale = await startStaleProvider();

const verifier = new RpcVerifier({
  sampleRate: 1,
  timeoutMs: 30_000,
  endpoints: [
    { rpcUrl: stale.url, provider: "your-provider" },
    airnodeDrpcEndpoint({ network: "base", fetchImpl })
  ]
});

const method = "eth_getBlockByNumber";
const blockNumber = await verifier.resolvePinHeight(undefined, UPSTREAM);
if (!blockNumber) throw new Error(`could not read the chain head from ${UPSTREAM}`);

console.log(`\nAsking both providers for Base block ${blockNumber}...\n`);
const run = await verifier.verify(method, ["latest", false], blockNumber);
stale.server.close();
if (!run) throw new Error("verification was not run");

const [primary, peer] = run.observations;
for (const observation of run.observations) {
  const answer = observation.resultHash
    ? `${observation.resultHash.slice(0, 18)}…`
    : observation.rpcErrorMessage;
  console.log(
    `  ${observation.provider?.padEnd(14)} HTTP 200  ${observation.latencyMs}ms  result ${answer}`
  );
  const attestation = observation.attestation;
  if (attestation) {
    console.log(`  ${"".padEnd(14)} signed by ${attestation.signer}`);
    console.log(
      `  ${"".padEnd(14)} signature valid: ${attestation.signatureValid}, bound to this request: ${attestation.requestBound}`
    );
  }
}

if (!primary?.resultHash || !peer?.resultHash) {
  console.log("\nComparison incomplete: one side gave no answer.");
  process.exit(1);
}

// The event Heightproof would have recorded for your provider's answer.
const event: HeightproofEvent = {
  id: randomUUID(),
  traceId: randomUUID().replaceAll("-", ""),
  projectId: "demo",
  serviceName: "airnode-demo",
  environment: "demo",
  timestamp: new Date().toISOString(),
  kind: "evm_rpc",
  request: {
    method: "POST",
    path: "/rpc",
    route: "/rpc",
    headers: {},
    query: {},
    auth: { present: true, scheme: "RPC", failed: false }
  },
  response: { statusCode: 200, latencyMs: primary.latencyMs },
  evmRpc: {
    method,
    chainId: "8453",
    provider: primary.provider,
    blockNumber: run.blockNumber,
    resultHash: primary.resultHash,
    resultShape: primary.resultShape,
    endpointHash: primary.endpointHash
  }
};

const attested = peer.attestation?.signatureValid && peer.attestation.requestBound;
const signals = detectDisagreement(event, {
  peerResults: [
    {
      provider: peer.provider,
      endpointHash: peer.endpointHash,
      resultHash: peer.resultHash,
      attestedBy: attested ? peer.attestation?.signer : undefined
    }
  ]
});

if (signals.length === 0) {
  console.log(`\nNo incident: both providers agree at block ${run.blockNumber}.`);
} else {
  for (const signal of signals)
    console.log(`\n🔴 D2 ${signal.name} (weight ${signal.weight})\n   ${signal.reason}`);
}
