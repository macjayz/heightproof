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
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { RpcVerifier, airnodeDrpcEndpoint } from "@heightproof/web3";
import { detectDisagreement, type HeightproofEvent } from "@heightproof/shared";

const UPSTREAM = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const STALE_BY = 40;
const AUSD = "0xbeA34973e5f67F18F656A2C6070C64326C791808";

const payerKey = process.env.AIRNODE_PAYER_KEY as `0x${string}` | undefined;
if (!payerKey) {
  console.error("Set AIRNODE_PAYER_KEY to a Base Sepolia key holding aUSD. See README.md.");
  process.exit(1);
}

// The misbehaving provider. Everything is a genuine mainnet answer, just not for the block asked.
const stale = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", async () => {
    const call = JSON.parse(raw) as { method: string; params: unknown[] };
    if (call.method === "eth_getBlockByNumber" && typeof call.params[0] === "string") {
      call.params[0] = `0x${(Number.parseInt(call.params[0], 16) - STALE_BY).toString(16)}`;
    }
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call })
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(await upstream.text());
  });
});
await new Promise<void>((resolve) => stale.listen(0, "127.0.0.1", resolve));
const staleUrl = `http://127.0.0.1:${(stale.address() as AddressInfo).port}`;

// Pays AirnodeHub's $0.01 per call in aUSD, capped at 1 aUSD per payment.
const payments = new x402Client().setSpendControls({
  allowedAssets: [{ network: "eip155:84532", asset: AUSD, maxAmountPerPayment: "1000000" }]
});
registerExactEvmScheme(payments, { signer: privateKeyToAccount(payerKey) });

const verifier = new RpcVerifier({
  sampleRate: 1,
  timeoutMs: 30_000,
  endpoints: [
    { rpcUrl: staleUrl, provider: "your-provider" },
    airnodeDrpcEndpoint({ network: "base", fetchImpl: wrapFetchWithPayment(fetch, payments) })
  ]
});

const method = "eth_getBlockByNumber";
const blockNumber = await verifier.resolvePinHeight(undefined, UPSTREAM);
if (!blockNumber) throw new Error(`could not read the chain head from ${UPSTREAM}`);

console.log(`\nAsking both providers for Base block ${blockNumber}...\n`);
const run = await verifier.verify(method, ["latest", false], blockNumber);
stale.close();
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
