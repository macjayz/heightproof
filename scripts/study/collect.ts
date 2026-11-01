/**
 * RPC reliability study: collector.
 *
 * Polls public endpoints on Ethereum mainnet, Base and Arbitrum on a fixed interval through
 * @heightproof/web3, with cross-provider verification on among the endpoints of each chain, so
 * Heightproof records every answer and every detector finding.
 * Meant to run unattended for days (see the `study` compose profile); `report.ts` turns what it
 * collected into numbers.
 *
 * The first run signs up a dedicated workspace and keeps its API key in STUDY_STATE, so restarts
 * keep writing to the same project.
 *
 * Paid endpoints (STUDY_PAID_ENDPOINTS, x402 per call) run only when STUDY_X402_PAYER_KEY is set,
 * on every STUDY_PAID_EVERY_TICKS-th tick, within STUDY_PAID_DAILY_BUDGET_USD. They are never
 * used to verify other endpoints, so verification never spends money on their behalf.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHeightproofRpcClient } from "@heightproof/web3";
import { createPaidBudget } from "./paid.js";

type Chain = {
  chainId: number;
  /** USDC on this chain: a busy contract, for reads and for log queries. */
  usdc: string;
  /**
   * Blocks a log query spans. Free public tiers cap it (BlastAPI at 10 blocks) and treat ranges
   * far from the head as archive requests, so it stays short and recent.
   */
  logRange: number;
  /** How far behind the head a log range ends, about 10 s, so a provider a block behind is not a mismatch. */
  logLag: number;
};
type Endpoint = { name: string; url: string; chain: string; paid: boolean };
type StudyState = { projectId: string; apiKey: string; startedAt: string };

const CHAINS: Record<string, Chain> = {
  ethereum: {
    chainId: 1,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    logRange: 10,
    logLag: 3
  },
  base: {
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    logRange: 10,
    logLag: 5
  },
  arbitrum: {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    logRange: 10,
    logLag: 40
  }
};

// `name=url` is an Ethereum mainnet endpoint; `chain/name=url` names its chain.
const DEFAULT_ENDPOINTS =
  "publicnode=https://ethereum-rpc.publicnode.com," +
  "drpc=https://eth.drpc.org," +
  "blastapi=https://eth-mainnet.public.blastapi.io," +
  "mevblocker=https://rpc.mevblocker.io," +
  "onfinality=https://eth.api.onfinality.io/public," +
  "base/official=https://mainnet.base.org," +
  "base/publicnode=https://base-rpc.publicnode.com," +
  "base/drpc=https://base.drpc.org," +
  "base/blastapi=https://base-mainnet.public.blastapi.io," +
  "arbitrum/official=https://arb1.arbitrum.io/rpc," +
  "arbitrum/publicnode=https://arbitrum-one-rpc.publicnode.com," +
  "arbitrum/drpc=https://arbitrum.drpc.org," +
  "arbitrum/blastapi=https://arbitrum-one.public.blastapi.io";

// RPC sold per call to AI agents over x402. Pocket Network quoted $0.005 a call on 1 Nov 2026.
const DEFAULT_PAID_ENDPOINTS =
  "pocket=https://agent.pocket.network/v1/eth," +
  "base/pocket=https://agent.pocket.network/v1/base," +
  "arbitrum/pocket=https://agent.pocket.network/v1/arb-one";

const api = process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080";
const statePath = process.env.STUDY_STATE ?? ".study/state.json";
const intervalMs = Number(process.env.STUDY_INTERVAL_MS ?? 15_000);
const sampleRate = Number(process.env.STUDY_VERIFY_SAMPLE_RATE ?? 0.2);
const callTimeoutMs = Number(process.env.STUDY_CALL_TIMEOUT_MS ?? 10_000);
// Log queries return the most data by far, so they run on every Nth tick only.
const logsEveryTicks = Number(process.env.STUDY_LOGS_EVERY_TICKS ?? 4);
const payerKey = process.env.STUDY_X402_PAYER_KEY as `0x${string}` | undefined;
const paidEveryTicks = Number(process.env.STUDY_PAID_EVERY_TICKS ?? 80);
const paidPriceUsd = Number(process.env.STUDY_PAID_PRICE_USD ?? 0.005);
const paidDailyBudgetUsd = Number(process.env.STUDY_PAID_DAILY_BUDGET_USD ?? 8);

function parseEndpoints(list: string, paid: boolean): Endpoint[] {
  return list
    .split(",")
    .filter((entry) => entry.trim())
    .map((entry) => {
      const [label, ...url] = entry.trim().split("=");
      const chain = label.includes("/") ? label.slice(0, label.indexOf("/")) : "ethereum";
      if (!CHAINS[chain]) throw new Error(`unknown chain "${chain}" in study endpoints`);
      return { name: label, url: url.join("="), chain, paid };
    });
}

const endpoints: Endpoint[] = [
  ...parseEndpoints(process.env.STUDY_ENDPOINTS ?? DEFAULT_ENDPOINTS, false),
  ...(payerKey ? parseEndpoints(process.env.STUDY_PAID_ENDPOINTS ?? DEFAULT_PAID_ENDPOINTS, true) : [])
];
const budget = payerKey
  ? createPaidBudget({
      payerKey,
      paidUrls: endpoints.filter((e) => e.paid).map((e) => e.url),
      priceUsd: paidPriceUsd,
      dailyBudgetUsd: paidDailyBudgetUsd
    })
  : undefined;

// Deterministic reads whose answers every honest provider must agree on at a given height.
const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type Call = { method: string; params: unknown[] };

/**
 * One tick's calls against one endpoint. The block at the tip is where reorgs and lagging nodes
 * show; a log range over a busy contract is where providers silently truncate.
 */
function callsFor(chain: Chain, head: number | undefined, tick: number): Call[] {
  const calls: Call[] = [
    { method: "eth_getBalance", params: [WALLET, "latest"] },
    { method: "eth_call", params: [{ to: chain.usdc, data: "0x18160ddd" }, "latest"] },
    { method: "eth_getBlockByNumber", params: ["latest", false] }
  ];
  if (head !== undefined && tick % logsEveryTicks === 0) {
    const toBlock = head - chain.logLag;
    calls.push({
      method: "eth_getLogs",
      params: [
        {
          address: chain.usdc,
          topics: [TRANSFER_TOPIC],
          fromBlock: `0x${(toBlock - chain.logRange + 1).toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`
        }
      ]
    });
  }
  return calls;
}

const state = await loadOrCreateState();
console.log(
  `study project ${state.projectId} (since ${state.startedAt}); ${endpoints.length} endpoints every ${intervalMs}ms, verify sample ${sampleRate}`
);
console.log(
  budget
    ? `paid endpoints on: every ${paidEveryTicks} ticks, $${paidPriceUsd}/call, budget $${paidDailyBudgetUsd}/day`
    : "paid endpoints off (set STUDY_X402_PAYER_KEY to a Base key holding USDC)"
);

const clients = endpoints.map((endpoint) => ({
  endpoint,
  client: createHeightproofRpcClient({
    projectId: state.projectId,
    apiKey: state.apiKey,
    endpoint: api,
    rpcUrl: endpoint.url,
    fetchImpl: endpoint.paid ? budget!.fetch : undefined,
    provider: endpoint.name,
    chainId: CHAINS[endpoint.chain].chainId,
    serviceName: "rpc-study",
    environment: "study",
    verify: {
      endpoints: endpoints
        .filter((other) => other !== endpoint && other.chain === endpoint.chain && !other.paid)
        .map((other) => ({ rpcUrl: other.url, provider: other.name })),
      sampleRate,
      maxCallsPerMinute: 20,
      timeoutMs: callTimeoutMs,
      // A paid endpoint is also asked for the head when verifying, so that call must pay too.
      fetchImpl: endpoint.paid ? budget!.fetch : undefined
    }
  })
}));

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

const totals = new Map(endpoints.map((endpoint) => [endpoint.name, { ok: 0, failed: 0 }]));
for (let tick = 1; !stopping; tick++) {
  const started = Date.now();
  // A multiple of logsEveryTicks, so paid endpoints get the log query too.
  const paidTick = tick % paidEveryTicks === 0;
  await Promise.all(
    clients.map(async ({ endpoint, client }) => {
      // Skip, rather than fail, paid calls outside their ticks or past the budget, so they do
      // not show up as provider failures in the report.
      if (endpoint.paid && (!paidTick || budget!.exhausted())) return;

      const head = await withTimeout(
        client.request({ method: "eth_blockNumber", params: [] }),
        callTimeoutMs
      ).then(
        (result) => (typeof result === "string" ? Number.parseInt(result, 16) : undefined),
        () => undefined
      );
      totals.get(endpoint.name)![head === undefined ? "failed" : "ok"] += 1;

      for (const call of callsFor(CHAINS[endpoint.chain], head, tick)) {
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
    const spend = budget ? `  x402 spent today $${budget.spentTodayUsd().toFixed(3)}` : "";
    console.log(`${new Date().toISOString()} tick ${tick}  ok/total: ${summary}${spend}`);
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
