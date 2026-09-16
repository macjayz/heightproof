import { Redis } from "ioredis";
import { HeightproofEvent, withSpan } from "@heightproof/shared";
import { ApiConfig } from "./config.js";

export function createRedis(config: ApiConfig) {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

export async function enqueueEvents(redis: Redis, streamName: string, events: HeightproofEvent[]) {
  return withSpan(
    "heightproof.redis.enqueue_events",
    {
      "heightproof.stream": streamName,
      "heightproof.events.count": events.length
    },
    async () => {
      const pipeline = redis.pipeline();

      for (const event of events) {
        pipeline.xadd(streamName, "*", "event", JSON.stringify(event));
      }

      await pipeline.exec();
    }
  );
}
