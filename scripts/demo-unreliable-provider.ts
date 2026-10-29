/**
 * Reproducible demo: an RPC provider becomes unreliable while still answering HTTP 200.
 *
 * Starts two local JSON-RPC providers over one simulated chain. "steady" always tells the truth;
 * "flaky" is switched through four failure modes. A real @heightproof/web3 client sends
 * application traffic to each, with cross-provider verification enabled on the flaky one, and
 * the script reports what the application saw next to what Heightproof raised.
 *
 * Needs a running stack (`docker compose up`). Usage: npm run demo:unreliable-provider
 */
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHeightproofRpcClient } from "@heightproof/web3";

const api = process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080";
const CALLS_PER_PHASE = 30;
const BLOCK_INTERVAL_MS = 250;
const WALLET = "0x00000000000000000000000000000000000000aa";

type Mode = "healthy" | "stale_head" | "wrong_balance" | "error_in_body" | "throttled";

let head = 21_000_000;
const chainTimer = setInterval(() => (head += 1), BLOCK_INTERVAL_MS);

function balanceAt(block: number) {
  return `0x${(10n ** 18n + BigInt(block)).toString(16)}`;
}

function startProvider(getMode: () => Mode): Promise<{ server: Server; url: string }> {
  let frozenHead: number | undefined;

  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const call = JSON.parse(raw) as { id: number; method: string; params: unknown[] };
      const mode = getMode();
      frozenHead = mode === "stale_head" ? (frozenHead ?? head) : undefined;
      const servedHead = frozenHead ?? head;

      const reply = (body: object) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...body }));
      };

      if (mode === "error_in_body")
        return reply({ error: { code: -32603, message: "internal error" } });
      if (mode === "throttled") {
        return reply({ error: { code: -32005, message: "request rate limited, retry later" } });
      }

      if (call.method === "eth_blockNumber")
        return reply({ result: `0x${servedHead.toString(16)}` });
      if (call.method === "eth_getBalance") {
        const tag = call.params[1];
        const block =
          typeof tag === "string" && tag.startsWith("0x") ? parseInt(tag, 16) : servedHead;
        const balance = balanceAt(block);
        // Same height, different number: the failure no status code or latency check can see.
        return reply({ result: mode === "wrong_balance" ? `${balance.slice(0, -1)}0` : balance });
      }
      reply({ error: { code: -32601, message: "method not found" } });
    });
  });

  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
    )
  );
}

async function json<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const response = await fetch(new URL(path, api), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
    }
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

type Incident = { id: string; title: string; severity: string; status: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A fresh workspace per run, so incidents from earlier runs cannot be mistaken for this one's.
const suffix = Date.now().toString(36);
const signup = await json<{
  token: string;
  apiKey: { key?: string; secret?: string } | string;
  projects: Array<{ id: string }>;
}>("/v1/auth/signup", {
  method: "POST",
  body: JSON.stringify({
    email: `rpc-demo-${suffix}@heightproof.local`,
    password: `demo-${suffix}-password`,
    organizationName: `RPC demo ${suffix}`,
    projectName: "keeper-bot"
  })
});
const projectId = signup.projects[0].id;
const apiKey =
  typeof signup.apiKey === "string"
    ? signup.apiKey
    : (signup.apiKey.key ?? signup.apiKey.secret ?? "");

let flakyMode: Mode = "healthy";
const steady = await startProvider(() => "healthy");
const flaky = await startProvider(() => flakyMode);

const common = { projectId, apiKey, endpoint: api, serviceName: "keeper-bot", chainId: 1 };
const steadyClient = createHeightproofRpcClient({
  ...common,
  rpcUrl: steady.url,
  provider: "steady"
});
const flakyClient = createHeightproofRpcClient({
  ...common,
  rpcUrl: flaky.url,
  provider: "flaky",
  verify: {
    endpoints: [{ rpcUrl: steady.url, provider: "steady" }],
    sampleRate: 1,
    maxCallsPerMinute: 600
  }
});

const seen = new Set<string>();
const rows: string[][] = [];

async function phase(mode: Mode, what: string) {
  flakyMode = mode;
  let appErrors = 0;
  const latencies: number[] = [];

  for (let i = 0; i < CALLS_PER_PHASE; i++) {
    for (const [client, method, params] of [
      [steadyClient, "eth_blockNumber", []],
      [flakyClient, "eth_blockNumber", []],
      [flakyClient, "eth_getBalance", [WALLET, "latest"]]
    ] as const) {
      const started = performance.now();
      try {
        await client.request({ method, params: [...params] });
      } catch {
        appErrors += 1;
      }
      if (client === flakyClient) latencies.push(performance.now() - started);
    }
    await sleep(40);
  }

  // The SDK flushes every 5s; give the worker a moment after that.
  await sleep(8_000);
  const incidents = await json<Incident[]>(`/v1/analytics/incidents?projectId=${projectId}`, {
    token: signup.token
  });
  const fresh = incidents.filter((incident) => !seen.has(incident.id));
  fresh.forEach((incident) => seen.add(incident.id));

  latencies.sort((a, b) => a - b);
  rows.push([
    mode,
    what,
    `${appErrors}/${CALLS_PER_PHASE * 2}`,
    `${latencies[Math.floor(latencies.length / 2)].toFixed(1)}ms`,
    fresh.length
      ? fresh.map((incident) => `${incident.severity}: ${incident.title}`).join("\n")
      : "—"
  ]);
  console.log(
    `[${mode}] app errors ${rows.at(-1)![2]}, incidents: ${rows.at(-1)![4].replaceAll("\n", " | ")}`
  );
}

try {
  console.log(`project ${projectId}; chain advancing one block every ${BLOCK_INTERVAL_MS}ms\n`);
  await phase("healthy", "both providers correct");
  await phase("stale_head", "flaky freezes its chain head; answers stay fast and 200");
  flakyMode = "healthy";
  await sleep(1_000);
  await phase("wrong_balance", "flaky returns a different eth_getBalance at the same height");
  await phase("error_in_body", "flaky returns HTTP 200 with a JSON-RPC error object");
  await phase("throttled", "flaky rate-limits inside HTTP 200 (code -32005)");

  console.log(
    "\nphase | flaky provider | app-visible errors (flaky) | p50 app latency | new Heightproof incidents"
  );
  for (const row of rows) console.log(row.map((cell) => cell.replaceAll("\n", " | ")).join(" | "));
} finally {
  clearInterval(chainTimer);
  steady.server.close();
  flaky.server.close();
}
process.exit(0);
