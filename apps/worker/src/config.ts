export type WorkerConfig = {
  databaseUrl: string;
  redisUrl: string;
  streamName: string;
  groupName: string;
  consumerName: string;
};

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "postgres://heightproof:heightproof@localhost:5432/heightproof",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    streamName: process.env.HEIGHTPROOF_STREAM ?? "heightproof:events",
    groupName: process.env.HEIGHTPROOF_GROUP ?? "heightproof-workers",
    consumerName: process.env.HEIGHTPROOF_CONSUMER ?? `worker-${process.pid}`
  };
}
