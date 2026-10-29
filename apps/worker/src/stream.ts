import { Redis } from "ioredis";
import { HeightproofEvent, HeightproofEventSchema } from "@heightproof/shared";
import type { WorkerConfig } from "./config.js";

export type StreamMessage = [id: string, fields: string[]];

export type ParsedMessage =
  | { ok: true; event: HeightproofEvent }
  | { ok: false; reason: "missing_event_field" | "invalid_json" | "schema_mismatch" };

/**
 * Turns a raw stream entry into an event. Never throws: a message that cannot be parsed now
 * will never parse, so the caller dead-letters it instead of letting it crash the loop.
 */
export function parseStreamMessage(fields: string[]): ParsedMessage {
  const index = fields.findIndex((field, position) => position % 2 === 0 && field === "event");
  if (index === -1) return { ok: false, reason: "missing_event_field" };

  let json: unknown;
  try {
    json = JSON.parse(fields[index + 1]);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const parsed = HeightproofEventSchema.safeParse(json);
  return parsed.success
    ? { ok: true, event: parsed.data }
    : { ok: false, reason: "schema_mismatch" };
}

/**
 * Copies a message to the dead-letter stream and acks the original in one MULTI, so a message
 * is never both lost and acked, nor dead-lettered twice.
 */
export async function deadLetter(
  redis: Redis,
  config: WorkerConfig,
  messageId: string,
  fields: string[],
  reason: string
) {
  await redis
    .multi()
    .xadd(config.deadLetterStreamName, "*", "reason", reason, "originalId", messageId, ...fields)
    .xack(config.streamName, config.groupName, messageId)
    .exec();
}

type PendingEntry = [id: string, consumer: string, idleMs: number, deliveries: number];

/**
 * Takes over messages another consumer read but never acked (it crashed, or was stopped
 * mid-batch). Messages already retried `maxDeliveries` times are dead-lettered rather than
 * retried forever. Returns the messages this consumer now owns and must process.
 */
export async function claimAbandoned(
  redis: Redis,
  config: WorkerConfig,
  count = 25
): Promise<StreamMessage[]> {
  const pending = (await redis.xpending(
    config.streamName,
    config.groupName,
    "IDLE",
    config.reclaimMinIdleMs,
    "-",
    "+",
    count
  )) as PendingEntry[];
  if (pending.length === 0) return [];

  const retry: string[] = [];
  for (const [id, , , deliveries] of pending) {
    if (Number(deliveries) < config.maxDeliveries) {
      retry.push(id);
      continue;
    }
    const entries = (await redis.xrange(config.streamName, id, id)) as StreamMessage[];
    await deadLetter(redis, config, id, entries[0]?.[1] ?? [], "max_deliveries_exceeded");
  }
  if (retry.length === 0) return [];

  // XCLAIM re-checks the idle time, so two workers reclaiming at once cannot both win a message.
  // Entries trimmed from the stream come back as null and are dropped from the PEL by Redis.
  const claimed = (await redis.xclaim(
    config.streamName,
    config.groupName,
    config.consumerName,
    config.reclaimMinIdleMs,
    ...retry
  )) as Array<StreamMessage | null>;
  return claimed.filter((entry): entry is StreamMessage => entry !== null);
}
