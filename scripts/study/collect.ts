/**
 * RPC reliability study: collector.
 *
 * Polls several Ethereum mainnet endpoints on a fixed interval through @heightproof/web3, with
 * cross-provider verification on, so Heightproof records every answer and every detector finding.
 * Meant to run unattended for days (see the `study` compose profile); `report.ts` turns what it
 * collected into numbers.
 *
 * The first run signs up a dedicated workspace and keeps its API key in STUDY_STATE, so restarts
 * keep writing to the same project.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHeightproofRpcClient } from "@heightproof/web3";

type Endpoint = { name: string; url: string };
type StudyState = { projectId: string; apiKey: string; startedAt: string };

const DEFAULT_ENDPOINTS =
  "publicnode=https://ethereum-rpc.publicnode.com," +
  "drpc=https://eth.drpc.org," +
  "blastapi=https://eth-mainnet.public.blastapi.io," +
  "mevblocker=https://rpc.mevblocker.io," +
  "onfinality=https://eth.api.onfinality.io/public";

const api = process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080";
const statePath = process.env.STUDY_STATE ?? ".study/state.json";
const intervalMs = Number(process.env.STUDY_INTERVAL_MS ?? 15_000);
const sampleRate = Number(process.env.STUDY_VERIFY_SAMPLE_RATE ?? 0.2);
const callTimeoutMs = Number(process.env.STUDY_CALL_TIMEOUT_MS ?? 10_000);
const endpoints: Endpoint[] = (process.env.STUDY_ENDPOINTS ?? DEFAULT_ENDPOINTS)
  .split(",")
  .map((entry) => {
    const [name, ...url] = entry.trim().split("=");
    return { name, url: url.join("=") };
  });

// Deterministic reads whose answers every honest provider must agree on at a given height.
const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const CALLS: Array<{ method: string; params: unknown[] }> = [
  { method: "eth_blockNumber", params: [] },
  { method: "eth_getBalance", params: [WALLET, "latest"] },
  { method: "eth_call", params: [{ to: USDC, data: "0x18160ddd" }, "latest"] }
];

const state = await loadOrCreateState();
console.log(
  `study project ${state.projectId} (since ${state.startedAt}); ${endpoints.length} endpoints every ${intervalMs}ms, verify sample ${sampleRate}`
);

const clients = endpoints.map((endpoint) => ({
  endpoint,
  client: createHeightproofRpcClient({
    projectId: state.projectId,
    apiKey: state.apiKey,
    endpoint: api,
    rpcUrl: endpoint.url,
    provider: endpoint.name,
    chainId: 1,
    serviceName: "rpc-study",
    environment: "study",
    verify: {
      endpoints: endpoints
        .filter((other) => other !== endpoint)
        .map((other) => ({ rpcUrl: other.url, provider: other.name })),
      sampleRate,
      maxCallsPerMinute: 20,
      timeoutMs: callTimeoutMs
    }
  })
}));

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

const totals = new Map(endpoints.map((endpoint) => [endpoint.name, { ok: 0, failed: 0 }]));
for (let tick = 1; !stopping; tick++) {
  const started = Date.now();
  await Promise.all(
    clients.map(async ({ endpoint, client }) => {
      for (const call of CALLS) {
        const outcome = await withTimeout(client.request(call), callTimeoutMs).then(
          () => "ok" as const,
          () => "failed" as const
        );
        totals.get(endpoint.name)![outcome] += 1;
      }
    })
  );

  if (tick % 20 === 0) {
    const summary = [...totals].map(([name, t]) => `${name} ${t.ok}/${t.ok + t.failed}`).join("  ");
    console.log(`${new Date().toISOString()} tick ${tick}  ok/total: ${summary}`);
  }
  await sleep(Math.max(0, intervalMs - (Date.now() - started)));
}
// Give the SDK one flush interval to send what it has queued.
await sleep(6_000);
process.exit(0);

async function loadOrCreateState(): Promise<StudyState> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as StudyState;
  } catch {
    // First run: fall through and create a workspace.
  }

  const suffix = randomBytes(4).toString("hex");
  const response = await fetch(new URL("/v1/auth/signup", api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `rpc-study-${suffix}@heightproof.local`,
      password: randomBytes(18).toString("base64url"),
      organizationName: "RPC reliability study",
      projectName: "mainnet-study"
    })
  });
  if (!response.ok) throw new Error(`signup failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as {
    projects: Array<{ id: string }>;
    apiKey: { key: string };
  };

  const created: StudyState = {
    projectId: body.projects[0].id,
    apiKey: body.apiKey.key,
    startedAt: new Date().toISOString()
  };
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(created, null, 2), { mode: 0o600 });
  return created;
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
