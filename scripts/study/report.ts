/**
 * RPC reliability study: report.
 *
 * Reads what the collector recorded and prints a Markdown summary per provider: availability,
 * errors inside 200 responses, rate limiting, latency, how often each provider's chain head
 * trailed the others, and how often providers disagreed at the same block height.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/study/report.ts [--out report.md]
 * The project comes from STUDY_PROJECT_ID, or from the collector's STUDY_STATE file.
 */
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://heightproof:heightproof@localhost:5432/heightproof";
const intervalSeconds = Number(process.env.STUDY_INTERVAL_MS ?? 15_000) / 1000;
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > -1 ? process.argv[outIndex + 1] : undefined;

const projectId =
  process.env.STUDY_PROJECT_ID ??
  (
    JSON.parse(await readFile(process.env.STUDY_STATE ?? ".study/state.json", "utf8")) as {
      projectId: string;
    }
  ).projectId;

const pool = new pg.Pool({ connectionString: databaseUrl });
const q = async <T>(sql: string, params: unknown[] = [projectId]) =>
  (await pool.query(sql, params)).rows as T[];

// Primary calls only: verification (shadow) calls are reported separately as disagreements.
const PRIMARY = `project_id = $1 and kind = 'evm_rpc' and evm_shadow_of_trace_id is null`;

const [window] = await q<{ first: Date; last: Date; calls: number }>(
  `select min(timestamp) as first, max(timestamp) as last, count(*)::int as calls from api_events where ${PRIMARY}`
);
if (!window?.calls) throw new Error(`no study data for project ${projectId}`);
const hours = (window.last.getTime() - window.first.getTime()) / 3_600_000;

const availability = await q<{
  provider: string;
  calls: number;
  transport_failed: number;
  error_in_body: number;
  throttled: number;
  p50: number;
  p95: number;
}>(
  `select evm_provider as provider, count(*)::int as calls,
     count(*) filter (where status_code >= 400)::int as transport_failed,
     count(*) filter (where evm_result_shape = 'error_in_body')::int as error_in_body,
     count(*) filter (where evm_throttled)::int as throttled,
     percentile_cont(0.5) within group (order by latency_ms) filter (where status_code < 400) as p50,
     percentile_cont(0.95) within group (order by latency_ms) filter (where status_code < 400) as p95
   from api_events where ${PRIMARY}
   group by 1 order by 1`
);

// Every provider is polled at the same moment each tick, so within one tick the highest head any
// provider reported is the reference. Lag of 1 block is mostly a block landing mid-tick; the
// stale-head detector's threshold is more than 3.
const headLag = await q<{
  provider: string;
  samples: number;
  lag_ge_2: number;
  lag_gt_3: number;
  max_lag: number;
}>(
  `with heads as (
     select evm_provider as provider, evm_block_number::bigint as head,
            floor(extract(epoch from timestamp) / $2) as tick
     from api_events
     where ${PRIMARY} and evm_rpc_method = 'eth_blockNumber' and evm_block_number is not null
   ), lagged as (
     select provider, max(head) over (partition by tick) - head as lag from heads
   )
   select provider, count(*)::int as samples,
     count(*) filter (where lag >= 2)::int as lag_ge_2,
     count(*) filter (where lag > 3)::int as lag_gt_3,
     coalesce(max(lag), 0)::int as max_lag
   from lagged group by 1 order by 1`,
  [projectId, intervalSeconds]
);

// One verification run = every endpoint answering the same call pinned to the same height.
const disagreements = await q<{ method: string; runs: number; disagreeing: number }>(
  `with runs as (
     select evm_shadow_of_trace_id as run, evm_rpc_method as method, evm_block_number as block,
            count(distinct evm_result_hash) filter (where evm_result_shape <> 'error_in_body') as answers
     from api_events
     where project_id = $1 and evm_shadow_of_trace_id is not null
     group by 1, 2, 3
   )
   select method, count(*)::int as runs, count(*) filter (where answers > 1)::int as disagreeing
   from runs group by 1 order by 1`
);

const minority = await q<{ provider: string; times_in_minority: number }>(
  `with answers as (
     select evm_shadow_of_trace_id as run, evm_block_number as block, evm_provider as provider, evm_result_hash as hash
     from api_events
     where project_id = $1 and evm_shadow_of_trace_id is not null and evm_result_shape <> 'error_in_body'
   ), counted as (
     select run, block, hash, count(*) as votes from answers group by 1, 2, 3
   ), majority as (
     select distinct on (run, block) run, block, hash from counted order by run, block, votes desc
   )
   select a.provider, count(*)::int as times_in_minority
   from answers a join majority m using (run, block)
   where a.hash is distinct from m.hash
   group by 1 order by 2 desc`
);

const signals = await q<{ signal: string; provider: string; events: number }>(
  `select s->>'name' as signal, evm_provider as provider, count(*)::int as events
   from api_events, jsonb_array_elements(threat_signals) s
   where ${PRIMARY}
   group by 1, 2 order by 1, 2`
);

const incidents = await q<{
  title: string;
  severity: string;
  status: string;
  request_count: number;
}>(
  `select title, severity, status, request_count from incidents where project_id = $1 order by request_count desc`
);

const pct = (part: number, whole: number) =>
  whole ? `${((100 * part) / whole).toFixed(2)}%` : "—";
const ms = (value: number | null) => (value === null ? "—" : `${Math.round(value)} ms`);
const table = (head: string[], rows: Array<Array<string | number>>) =>
  [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`)
  ].join("\n");

const report = `# Ethereum mainnet RPC reliability

Project \`${projectId}\` · ${window.first.toISOString()} → ${window.last.toISOString()} (${hours.toFixed(1)} h) · ${window.calls.toLocaleString()} primary calls · polled every ${intervalSeconds}s

## Availability and answers

${table(
  [
    "Provider",
    "Calls",
    "Transport failures",
    "JSON-RPC error inside 200",
    "Rate limited",
    "p50",
    "p95"
  ],
  availability.map((r) => [
    r.provider,
    r.calls,
    pct(r.transport_failed, r.calls),
    pct(r.error_in_body, r.calls),
    pct(r.throttled, r.calls),
    ms(r.p50),
    ms(r.p95)
  ])
)}

## Chain head lag (vs. the highest head any provider reported in the same tick)

${table(
  ["Provider", "Samples", "≥ 2 blocks behind", "> 3 blocks behind", "Worst"],
  headLag.map((r) => [
    r.provider,
    r.samples,
    pct(r.lag_ge_2, r.samples),
    pct(r.lag_gt_3, r.samples),
    `${r.max_lag} blocks`
  ])
)}

## Disagreement at equal height (verification runs)

${table(
  ["Method", "Runs", "Runs with differing answers"],
  disagreements.map((r) => [r.method, r.runs, `${r.disagreeing} (${pct(r.disagreeing, r.runs)})`])
)}

${
  minority.length
    ? table(
        ["Provider", "Times in the minority"],
        minority.map((r) => [r.provider, r.times_in_minority])
      )
    : "No provider ever disagreed with the majority."
}

## Detector findings

${
  signals.length
    ? table(
        ["Signal", "Provider", "Events"],
        signals.map((r) => [r.signal, r.provider ?? "—", r.events])
      )
    : "None."
}

${
  incidents.length
    ? table(
        ["Incident", "Severity", "Status", "Events"],
        incidents.map((r) => [r.title, r.severity, r.status, r.request_count])
      )
    : "No incidents."
}
`;

if (outPath) await writeFile(outPath, report);
console.log(report);
await pool.end();
