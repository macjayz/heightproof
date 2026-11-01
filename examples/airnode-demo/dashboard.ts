/**
 * The same story as demo.ts, end to end through a running Heightproof stack.
 *
 * Your app makes an ordinary call through @heightproof/web3 to "your-provider", which answers
 * with HTTP 200 and looks fine. In the background Heightproof re-asks that provider and
 * AirnodeHub the same question at a pinned height, the worker re-checks the Airnode signature
 * and raises D2, and the incident appears in the dashboard.
 *
 * Needs a running stack (`docker compose up`) and a wallet holding aUSD on Base Sepolia.
 * Usage:
 *   AIRNODE_PAYER_KEY=0x... npm run dashboard -w examples/airnode-demo
 */
import { airnodeDrpcEndpoint, createHeightproofRpcClient } from "@heightproof/web3";
import { payingFetch, startStaleProvider } from "./setup.js";

const api = process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080";
const dashboard = process.env.HEIGHTPROOF_DASHBOARD_URL ?? "http://localhost:5173";
const INCIDENT_TIMEOUT_MS = 90_000;

type Incident = { id: string; title: string; description?: string; severity: string };

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A fresh workspace per run, so the only incident in it is this run's.
const suffix = Date.now().toString(36);
const login = { email: `ada-${suffix}@heightproof.local`, password: `demo-${suffix}-password` };
const signup = await json<{
  token: string;
  apiKey: { key?: string; secret?: string } | string;
  projects: Array<{ id: string }>;
}>("/v1/auth/signup", {
  method: "POST",
  body: JSON.stringify({ ...login, organizationName: "Ada's DeFi app", projectName: "ada-defi" })
});
const projectId = signup.projects[0].id;
const apiKey =
  typeof signup.apiKey === "string"
    ? signup.apiKey
    : (signup.apiKey.key ?? signup.apiKey.secret ?? "");

const fetchImpl = payingFetch();
const stale = await startStaleProvider();

const rpc = createHeightproofRpcClient({
  projectId,
  apiKey,
  endpoint: api,
  rpcUrl: stale.url,
  provider: "your-provider",
  serviceName: "ada-defi",
  chainId: 8453,
  verify: {
    endpoints: [airnodeDrpcEndpoint({ network: "base", fetchImpl })],
    // Every call, for the demo. In production a small fraction is enough.
    sampleRate: 1,
    timeoutMs: 30_000
  }
});

const block = (await rpc.request({
  method: "eth_getBlockByNumber",
  params: ["latest", false]
})) as {
  number: string;
};
console.log(
  `\nYour app: eth_getBlockByNumber -> block ${Number.parseInt(block.number, 16)}, HTTP 200. Looks fine.`
);
console.log(
  "Heightproof: re-asking your-provider and AirnodeHub at that height, in the background..."
);

const deadline = Date.now() + INCIDENT_TIMEOUT_MS;
let incident: Incident | undefined;
while (!incident && Date.now() < deadline) {
  await sleep(2_000);
  const incidents = await json<Incident[]>(`/v1/analytics/incidents?projectId=${projectId}`, {
    token: signup.token
  });
  incident = incidents[0];
}
stale.server.close();

if (!incident) {
  console.log("\nNo incident raised within 90s. Is the worker running?");
  process.exit(1);
}

console.log(`\n🔴 Incident (${incident.severity}): ${incident.title}`);
if (incident.description) console.log(`   ${incident.description}`);
console.log(`\nOpen ${dashboard} and sign in as ${login.email} / ${login.password}`);
process.exit(0);
