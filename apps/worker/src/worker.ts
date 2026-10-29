import { Redis } from "ioredis";
import { assessThreat, withSpan } from "@heightproof/shared";
import { deliverPendingAlerts } from "./alerts.js";
import { evaluateAlertRules } from "./alertRules.js";
import { loadConfig, WorkerConfig } from "./config.js";
import {
  countRecentIpRequests,
  createPool,
  getWeb3ThreatContext,
  raiseAlertRuleIncident,
  recordEvent
} from "./db.js";
import { claimAbandoned, deadLetter, parseStreamMessage, StreamMessage } from "./stream.js";

const ALERT_RULE_EVAL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export async function runWorker(
  overrides: Partial<WorkerConfig> = {},
  options: { blockMs?: number } = {}
) {
  const config = loadConfig(overrides);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const pool = createPool(config);
  let lastAlertRuleEvalAt = 0;

  try {
    await redis.xgroup("CREATE", config.streamName, config.groupName, "$", "MKSTREAM");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }

  // Processing errors (Postgres down, a query failing) propagate and leave the message pending
  // without an XACK, so claimAbandoned() retries it later. Only unparseable messages, which can
  // never succeed, are dead-lettered immediately.
  async function processMessages(messages: StreamMessage[]) {
    for (const [messageId, fields] of messages) {
      const parsed = parseStreamMessage(fields);
      if (!parsed.ok) {
        await deadLetter(redis, config, messageId, fields, parsed.reason);
        continue;
      }

      const event = parsed.event;
      await withSpan(
        "heightproof.worker.process_event",
        {
          "heightproof.event_id": event.id,
          "heightproof.trace_id": event.traceId,
          "heightproof.project_id": event.projectId,
          "heightproof.kind": event.kind
        },
        async () => {
          const [recentIpRequests, web3Context] = await Promise.all([
            countRecentIpRequests(pool, event.projectId, event.request.ip),
            getWeb3ThreatContext(pool, event)
          ]);
          const assessment = assessThreat(event, recentIpRequests, web3Context);
          // Idempotent on event.id: a redelivered or re-sent event is acked without side effects.
          await recordEvent(pool, event, assessment);
        }
      );

      await redis.xack(config.streamName, config.groupName, messageId);
    }
  }

  async function tick() {
    const response = await redis.xreadgroup(
      "GROUP",
      config.groupName,
      config.consumerName,
      "COUNT",
      25,
      "BLOCK",
      options.blockMs ?? 5000,
      "STREAMS",
      config.streamName,
      ">"
    );

    if (!response) return;

    for (const [, messages] of response as Array<[string, StreamMessage[]]>) {
      await processMessages(messages);
    }
  }

  async function reclaim() {
    const claimed = await claimAbandoned(redis, config);
    await processMessages(claimed);
    return claimed.length;
  }

  async function heartbeat() {
    await redis.set(
      config.heartbeatKey,
      JSON.stringify({ consumer: config.consumerName, at: new Date().toISOString() }),
      "PX",
      config.heartbeatTtlMs
    );
  }

  async function deliverAlerts() {
    await deliverPendingAlerts(pool);
  }

  async function checkAlertRules() {
    if (Date.now() - lastAlertRuleEvalAt < ALERT_RULE_EVAL_INTERVAL_MS) return;
    lastAlertRuleEvalAt = Date.now();
    await evaluateAlertRules(pool, raiseAlertRuleIncident);
  }

  return {
    config,
    pool,
    redis,
    tick,
    reclaim,
    heartbeat,
    deliverAlerts,
    checkAlertRules,
    async close() {
      await redis.quit();
      await pool.end();
    }
  };
}

export function backoffDelayMs(consecutiveFailures: number) {
  return Math.min(1000 * 2 ** Math.max(consecutiveFailures - 1, 0), MAX_BACKOFF_MS);
}

if (process.env.NODE_ENV !== "test") {
  const worker = await runWorker();
  let stopping = false;
  let consecutiveFailures = 0;

  // Signals only stop the loop. The current batch finishes and is acked before the connections
  // close, so a deploy or `docker stop` no longer strands in-flight messages.
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      await worker.heartbeat();
      await worker.reclaim();
      await worker.tick();
      await worker.deliverAlerts();
      await worker.checkAlertRules();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      const delayMs = backoffDelayMs(consecutiveFailures);
      console.error(
        JSON.stringify({
          level: "error",
          msg: "worker iteration failed; backing off",
          error: error instanceof Error ? error.message : String(error),
          consecutiveFailures,
          delayMs
        })
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  await worker.close();
  process.exit(0);
}
