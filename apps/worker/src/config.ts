export type WorkerConfig = {
  databaseUrl: string;
  redisUrl: string;
  streamName: string;
  groupName: string;
  consumerName: string;
  /** Stream that receives messages the worker can never process (unparseable, or retried too often). */
  deadLetterStreamName: string;
  /** Key the worker refreshes every loop so /ready can tell whether any consumer is alive. */
  heartbeatKey: string;
  heartbeatTtlMs: number;
  /** A pending message idle this long is assumed abandoned by a dead consumer and reclaimed. */
  reclaimMinIdleMs: number;
  /** Deliveries after which a message is dead-lettered instead of retried again. */
  maxDeliveries: number;
};

export function loadConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  const streamName = overrides.streamName ?? process.env.HEIGHTPROOF_STREAM ?? "heightproof:events";

  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgres://heightproof:heightproof@localhost:5432/heightproof",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    groupName: process.env.HEIGHTPROOF_GROUP ?? "heightproof-workers",
    consumerName: process.env.HEIGHTPROOF_CONSUMER ?? `worker-${process.pid}`,
    deadLetterStreamName: `${streamName}:dlq`,
    heartbeatKey: `${streamName}:heartbeat`,
    heartbeatTtlMs: Number(process.env.HEIGHTPROOF_HEARTBEAT_TTL_MS ?? 30_000),
    reclaimMinIdleMs: Number(process.env.HEIGHTPROOF_RECLAIM_MIN_IDLE_MS ?? 60_000),
    maxDeliveries: Number(process.env.HEIGHTPROOF_MAX_DELIVERIES ?? 20),
    ...overrides,
    streamName
  };
}
