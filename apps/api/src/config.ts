export type ApiConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  heightproofApiKey: string;
  allowDevFallbackApiKey: boolean;
  bootstrapDemoUser: boolean;
  seedDemoEvents: boolean;
  streamName: string;
  groupName: string;
  /** Key the worker refreshes on every loop; /ready reports degraded when it expires. */
  workerHeartbeatKey: string;
  /** /ready reports degraded once the oldest unprocessed message is older than this. */
  maxQueueAgeMs: number;
  adminEmail: string;
  adminPassword: string;
};

export function loadConfig(): ApiConfig {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    port: Number(process.env.PORT ?? 8080),
    databaseUrl: process.env.DATABASE_URL ?? "postgres://heightproof:heightproof@localhost:5432/heightproof",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    heightproofApiKey: process.env.HEIGHTPROOF_API_KEY ?? "dev-heightproof-key",
    allowDevFallbackApiKey:
      process.env.HEIGHTPROOF_ALLOW_DEV_FALLBACK_KEY === "true" ||
      (!isProduction && process.env.HEIGHTPROOF_ALLOW_DEV_FALLBACK_KEY !== "false"),
    bootstrapDemoUser:
      process.env.HEIGHTPROOF_BOOTSTRAP_DEMO_USER === "true" ||
      (!isProduction && process.env.HEIGHTPROOF_BOOTSTRAP_DEMO_USER !== "false"),
    // Only ever seeds the "demo" project, and only when it's genuinely empty (see seedDemoEventsIfEmpty
    // in seed.ts) — never touches a real signed-up user's project, and never re-seeds on every restart.
    seedDemoEvents:
      process.env.HEIGHTPROOF_SEED_DEMO_EVENTS === "true" ||
      (!isProduction && process.env.HEIGHTPROOF_SEED_DEMO_EVENTS !== "false"),
    streamName: process.env.HEIGHTPROOF_STREAM ?? "heightproof:events",
    groupName: process.env.HEIGHTPROOF_GROUP ?? "heightproof-workers",
    workerHeartbeatKey: `${process.env.HEIGHTPROOF_STREAM ?? "heightproof:events"}:heartbeat`,
    maxQueueAgeMs: Number(process.env.HEIGHTPROOF_MAX_QUEUE_AGE_MS ?? 60_000),
    adminEmail: process.env.HEIGHTPROOF_ADMIN_EMAIL ?? "owner@heightproof.local",
    adminPassword: process.env.HEIGHTPROOF_ADMIN_PASSWORD ?? "heightproof-demo"
  };
}
