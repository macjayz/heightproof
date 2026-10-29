import pg from "pg";
import { Redis } from "ioredis";

export type RuntimeMetrics = {
  startedAt: number;
  totalRequests: number;
  ingestionEvents: number;
  ingestionBatches: number;
  failedIngestionBatches: number;
  responseBuckets: Record<string, number>;
};

export type LiveHubStats = {
  connectionCount(): number;
};

export function createRuntimeMetrics(): RuntimeMetrics {
  return {
    startedAt: Date.now(),
    totalRequests: 0,
    ingestionEvents: 0,
    ingestionBatches: 0,
    failedIngestionBatches: 0,
    responseBuckets: {}
  };
}

export type ReadinessTarget = {
  streamName: string;
  groupName: string;
  heartbeatKey: string;
  maxQueueAgeMs: number;
};

export async function buildReadiness(pool: pg.Pool, redis: Redis, target: ReadinessTarget, now = Date.now()) {
  const [database, queue, worker] = await Promise.all([
    measureDatabase(pool),
    measureQueue(redis, target, now),
    measureWorker(redis, target.heartbeatKey)
  ]);

  return {
    status: database.ok && queue.ok && worker.ok ? "ready" : "degraded",
    checks: {
      database,
      queue,
      worker
    }
  };
}

export async function buildMetricsSnapshot(
  metrics: RuntimeMetrics,
  pool: pg.Pool,
  redis: Redis,
  streamName: string,
  groupName: string,
  liveHub: LiveHubStats
) {
  const [database, queueState] = await Promise.all([
    measureDatabase(pool),
    measureQueueState(redis, streamName, groupName)
  ]);

  return {
    uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
    totalRequests: metrics.totalRequests,
    ingestionRate: metrics.ingestionEvents,
    ingestionBatches: metrics.ingestionBatches,
    failedJobs: metrics.failedIngestionBatches,
    queueDepth: queueState.depth,
    queueOldestAgeSeconds: Math.round(queueState.oldestAgeMs / 1000),
    databaseLatencyMs: database.latencyMs,
    processingLatencyMs: 0,
    websocketConnections: liveHub.connectionCount(),
    responseBuckets: metrics.responseBuckets
  };
}

export function toPrometheus(snapshot: Awaited<ReturnType<typeof buildMetricsSnapshot>>): string {
  return [
    "# HELP heightproof_uptime_seconds Heightproof API process uptime.",
    "# TYPE heightproof_uptime_seconds gauge",
    `heightproof_uptime_seconds ${snapshot.uptimeSeconds}`,
    "# HELP heightproof_requests_total Total API requests handled by Heightproof.",
    "# TYPE heightproof_requests_total counter",
    `heightproof_requests_total ${snapshot.totalRequests}`,
    "# HELP heightproof_ingested_events_total Total events accepted by ingestion.",
    "# TYPE heightproof_ingested_events_total counter",
    `heightproof_ingested_events_total ${snapshot.ingestionRate}`,
    "# HELP heightproof_ingestion_batches_total Total event batches accepted by ingestion.",
    "# TYPE heightproof_ingestion_batches_total counter",
    `heightproof_ingestion_batches_total ${snapshot.ingestionBatches}`,
    "# HELP heightproof_failed_jobs_total Failed ingestion or processing jobs.",
    "# TYPE heightproof_failed_jobs_total counter",
    `heightproof_failed_jobs_total ${snapshot.failedJobs}`,
    "# HELP heightproof_queue_depth Current Redis Stream consumer backlog.",
    "# TYPE heightproof_queue_depth gauge",
    `heightproof_queue_depth ${snapshot.queueDepth}`,
    "# HELP heightproof_queue_oldest_age_seconds Age of the oldest unacknowledged or unread stream message.",
    "# TYPE heightproof_queue_oldest_age_seconds gauge",
    `heightproof_queue_oldest_age_seconds ${snapshot.queueOldestAgeSeconds}`,
    "# HELP heightproof_database_latency_ms Database health query latency.",
    "# TYPE heightproof_database_latency_ms gauge",
    `heightproof_database_latency_ms ${snapshot.databaseLatencyMs}`,
    "# HELP heightproof_processing_latency_ms Worker processing latency.",
    "# TYPE heightproof_processing_latency_ms gauge",
    `heightproof_processing_latency_ms ${snapshot.processingLatencyMs}`,
    "# HELP heightproof_websocket_connections Current dashboard WebSocket connections.",
    "# TYPE heightproof_websocket_connections gauge",
    `heightproof_websocket_connections ${snapshot.websocketConnections}`
  ].join("\n");
}

async function measureDatabase(pool: pg.Pool) {
  const started = performance.now();

  try {
    await pool.query("select 1");
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

async function measureQueue(redis: Redis, target: ReadinessTarget, now: number) {
  const started = performance.now();

  try {
    const { depth, oldestAgeMs } = await measureQueueState(redis, target.streamName, target.groupName, now);
    // Depth alone says nothing about health (a burst is fine if it drains); age of the oldest
    // unprocessed message is what climbs when the worker is dead, stuck, or messages are stranded.
    return {
      ok: oldestAgeMs <= target.maxQueueAgeMs,
      latencyMs: Math.round(performance.now() - started),
      depth,
      oldestAgeMs
    };
  } catch {
    return { ok: false, latencyMs: -1, depth: -1, oldestAgeMs: -1 };
  }
}

async function measureWorker(redis: Redis, heartbeatKey: string) {
  try {
    const raw = await redis.get(heartbeatKey);
    if (!raw) return { ok: false, consumer: null, lastSeenAt: null };
    const beat = JSON.parse(raw) as { consumer?: string; at?: string };
    return { ok: true, consumer: beat.consumer ?? null, lastSeenAt: beat.at ?? null };
  } catch {
    return { ok: false, consumer: null, lastSeenAt: null };
  }
}

export async function measureQueueState(redis: Redis, streamName: string, groupName: string, now = Date.now()) {
  const group = await readGroup(redis, streamName, groupName);
  if (group === null) return { depth: 0, oldestAgeMs: 0 };

  const depth = (group && backlogFromGroup(group)) ?? Number(await redis.xlen(streamName));
  if (depth <= 0) return { depth, oldestAgeMs: 0 };

  const oldest: number[] = [];
  if (group) {
    const summary = (await redis.xpending(streamName, groupName)) as unknown[];
    if (Number(summary[0]) > 0 && typeof summary[1] === "string") oldest.push(streamIdMs(summary[1]));
  }

  // First entry the group has not been handed yet; with no group, the whole stream is unread.
  const lastDelivered = group ? readRedisField(group, "last-delivered-id") : undefined;
  const start = typeof lastDelivered === "string" ? `(${lastDelivered}` : "-";
  const unread = (await redis.xrange(streamName, start, "+", "COUNT", 1)) as Array<[string, string[]]>;
  if (unread[0]) oldest.push(streamIdMs(unread[0][0]));

  return { depth, oldestAgeMs: oldest.length > 0 ? Math.max(0, now - Math.min(...oldest)) : 0 };
}

function streamIdMs(id: string) {
  return Number(id.split("-")[0]);
}

/** The consumer group's XINFO entry, undefined if the group is missing, null if the stream is. */
async function readGroup(redis: Redis, streamName: string, groupName: string) {
  try {
    const groups = (await redis.xinfo("GROUPS", streamName)) as unknown[];
    return readRedisField(groups, "name") === groupName
      ? groups
      : groups.find((entry) => readRedisField(entry, "name") === groupName);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ERR no such key")) return null;
    throw error;
  }
}

function backlogFromGroup(group: unknown) {
  const lag = readRedisNumberField(group, "lag");
  const pending = readRedisNumberField(group, "pending");
  if (lag >= 0 && pending >= 0) return lag + pending;
  if (lag >= 0) return lag;
  if (pending >= 0) return pending;
  return undefined;
}

function readRedisField(entry: unknown, field: string) {
  if (!Array.isArray(entry)) return undefined;
  const index = entry.findIndex((value) => value === field);
  return entry[index + 1];
}

function readRedisNumberField(entry: unknown, field: string) {
  const value = readRedisField(entry, field);
  if (typeof value !== "string" && typeof value !== "number") return -1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}
