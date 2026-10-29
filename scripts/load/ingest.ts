/**
 * Ingestion load test.
 *
 * Phase 1 drives POST /v1/events at a fixed concurrency and records accept latency, throughput and
 * rejections. Phase 2 watches the worker drain what was accepted and records its processing rate,
 * which is the pipeline's real throughput ceiling. Run against a stack nothing else is loading.
 *
 * Usage: npx tsx scripts/load/ingest.ts [--kind rest|evm_rpc] [--seconds 30] [--concurrency 8] [--batch 100]
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const kind = arg("kind", "rest") as "rest" | "evm_rpc";
const seconds = Number(arg("seconds", "30"));
const concurrency = Number(arg("concurrency", "8"));
const batchSize = Number(arg("batch", "100"));
const api = process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://heightproof:heightproof@localhost:5432/heightproof";

// A fresh workspace per run: a real project-scoped key exercises the production auth path (a
// key lookup in Postgres on every batch), and its events are easy to count in isolation.
const suffix = `${kind}-${Date.now().toString(36)}`;
const signup = await fetch(new URL("/v1/auth/signup", api), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `loadtest-${suffix}@heightproof.local`,
    password: `loadtest-${suffix}-password`,
    organizationName: `Load test ${suffix}`,
    projectName: "loadtest"
  })
});
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
const workspace = (await signup.json()) as {
  projects: Array<{ id: string }>;
  apiKey: { key: string };
};
const projectId = workspace.projects[0].id;
const apiKey = workspace.apiKey.key;

function event(i: number) {
  const base = {
    id: randomUUID(),
    projectId,
    serviceName: "loadtest",
    environment: "loadtest",
    timestamp: new Date().toISOString(),
    request: {
      method: "POST" as const,
      path: kind === "rest" ? `/api/orders/${i % 500}` : "/rpc",
      route: kind === "rest" ? "/api/orders/:id" : "/rpc",
      ip: `198.51.100.${i % 200}`,
      headers: {},
      query: {},
      auth: { present: true, failed: false }
    },
    response: { statusCode: 200, latencyMs: 20 + (i % 80) }
  };
  if (kind === "rest") return { ...base, kind: "rest" };
  return {
    ...base,
    kind: "evm_rpc",
    evmRpc: {
      method: ["eth_blockNumber", "eth_getBalance", "eth_call"][i % 3],
      chainId: "1",
      provider: `provider-${i % 4}`,
      endpointHash: `endpoint-${i % 4}`,
      blockNumber: String(21_000_000 + Math.floor(i / 40)),
      resultShape: "value",
      resultHash: `hash-${i % 7}`
    }
  };
}

const latencies: number[] = [];
const statuses = new Map<number, number>();
let accepted = 0;
let sent = 0;
const deadline = Date.now() + seconds * 1000;
const started = Date.now();

async function sender() {
  while (Date.now() < deadline) {
    const events = Array.from({ length: batchSize }, () => event(sent++));
    const t0 = performance.now();
    const response = await fetch(new URL("/v1/events", api), {
      method: "POST",
      headers: { "content-type": "application/json", "x-heightproof-api-key": apiKey },
      body: JSON.stringify({ events })
    }).catch(() => undefined);
    latencies.push(performance.now() - t0);
    const status = response?.status ?? 0;
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    if (status === 202) accepted += events.length;
    if (status === 429) await new Promise((r) => setTimeout(r, 100));
  }
}

// Rows landing in Postgres, sampled every second from the start, give the worker's real
// processing rate and how far behind it fell. (Polling /ready would share the API's per-IP rate
// limit with the senders.)
const pool = new pg.Pool({ connectionString: databaseUrl });
const count = async () =>
  Number(
    (await pool.query(`select count(*) from api_events where project_id = $1`, [projectId])).rows[0]
      .count
  );
const samples: Array<{ t: number; accepted: number; persisted: number }> = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    samples.push({ t: (Date.now() - started) / 1000, accepted, persisted: await count() });
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

console.log(
  `phase 1: ${kind} events, ${concurrency} senders × ${batchSize}/batch for ${seconds}s → project ${projectId}`
);
await Promise.all(Array.from({ length: concurrency }, sender));
const sendSeconds = (Date.now() - started) / 1000;

latencies.sort((a, b) => a - b);
const p = (q: number) =>
  latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))].toFixed(1);
console.log(
  `  requests ${latencies.length} (${[...statuses].map(([s, n]) => `${s}: ${n}`).join(", ")})\n` +
    `  accepted ${accepted} events = ${(accepted / sendSeconds).toFixed(0)} events/s averaged over the run`
);
console.log(
  `  accept latency p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · p99 ${p(0.99)} ms · max ${latencies.at(-1)!.toFixed(1)} ms`
);

while (samples.at(-1)!.persisted < accepted && (Date.now() - started) / 1000 < sendSeconds + 900) {
  await new Promise((r) => setTimeout(r, 1000));
}
sampling = false;
await sampler;

// Worker rate: from the first persisted row to the last, the backlog was never empty.
const first = samples.find((s) => s.persisted > 0)!;
const done = samples.find((s) => s.persisted >= accepted) ?? samples.at(-1)!;
const workerRate = (done.persisted - first.persisted) / Math.max(1, done.t - first.t);
const peakBacklog = Math.max(...samples.map((s) => s.accepted - s.persisted));
console.log(
  `phase 2: persisted ${done.persisted}/${accepted}; worker processed ${workerRate.toFixed(0)} events/s while it had a backlog\n` +
    `  peak backlog ${peakBacklog} events (≈${(peakBacklog / workerRate).toFixed(0)}s behind); fully drained ${Math.max(0, done.t - sendSeconds).toFixed(0)}s after sending stopped`
);
await pool.end();
