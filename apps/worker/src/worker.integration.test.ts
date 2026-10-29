import { randomUUID } from "node:crypto";
import pg from "pg";
import type { HeightproofEvent, ThreatAssessment } from "@heightproof/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createIncidentIfNeeded, persistEvent } from "./db.js";
import { runWorker } from "./worker.js";

/**
 * Runs the worker against a real Redis and a migrated Postgres. Skipped unless
 * HEIGHTPROOF_INTEGRATION=1, with DATABASE_URL and REDIS_URL pointing at disposable instances
 * (see `npm run test:integration` and the CI integration job).
 */
const enabled = process.env.HEIGHTPROOF_INTEGRATION === "1";

type Worker = Awaited<ReturnType<typeof runWorker>>;
const workers: Worker[] = [];

async function startWorker(overrides: Parameters<typeof runWorker>[0] = {}) {
  const worker = await runWorker(
    { streamName: `it:${randomUUID()}`, ...overrides },
    { blockMs: 100 }
  );
  workers.push(worker);
  return worker;
}

function event(id: string) {
  return JSON.stringify({
    id,
    projectId: "integration",
    serviceName: "integration",
    timestamp: new Date().toISOString(),
    kind: "rest",
    request: { method: "GET", path: "/integration" },
    response: { statusCode: 200, latencyMs: 5 }
  });
}

async function persisted(worker: Worker, id: string) {
  const result = await worker.pool.query(
    `select count(*)::int as count from api_events where id = $1`,
    [id]
  );
  return result.rows[0].count as number;
}

async function pendingCount(worker: Worker) {
  const summary = (await worker.redis.xpending(
    worker.config.streamName,
    worker.config.groupName
  )) as unknown[];
  return Number(summary[0]);
}

afterEach(async () => {
  for (const worker of workers.splice(0)) {
    await worker.redis.del(
      worker.config.streamName,
      worker.config.deadLetterStreamName,
      worker.config.heartbeatKey
    );
    await worker.close();
  }
});

describe.skipIf(!enabled)("worker against real Redis and Postgres", () => {
  it("dead-letters an unparseable message and keeps processing the rest", async () => {
    const worker = await startWorker();
    const id = `it-${randomUUID()}`;
    await worker.redis.xadd(worker.config.streamName, "*", "event", "not-json");
    await worker.redis.xadd(worker.config.streamName, "*", "event", event(id));

    await worker.tick();

    expect(await persisted(worker, id)).toBe(1);
    expect(await pendingCount(worker)).toBe(0);
    const dead = (await worker.redis.xrange(worker.config.deadLetterStreamName, "-", "+")) as Array<
      [string, string[]]
    >;
    expect(dead).toHaveLength(1);
    expect(dead[0][1].slice(0, 2)).toEqual(["reason", "invalid_json"]);
  });

  it("reclaims and processes messages a crashed consumer read but never acked", async () => {
    const worker = await startWorker({ reclaimMinIdleMs: 50 });
    const id = `it-${randomUUID()}`;
    await worker.redis.xadd(worker.config.streamName, "*", "event", event(id));
    // A consumer that reads the message and dies before XACK.
    await worker.redis.xreadgroup(
      "GROUP",
      worker.config.groupName,
      "crashed",
      "STREAMS",
      worker.config.streamName,
      ">"
    );
    await worker.tick();
    expect(await persisted(worker, id)).toBe(0);
    expect(await pendingCount(worker)).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await worker.reclaim()).toBe(1);

    expect(await persisted(worker, id)).toBe(1);
    expect(await pendingCount(worker)).toBe(0);
  });

  it("dead-letters a message that keeps failing instead of retrying it forever", async () => {
    const worker = await startWorker({ reclaimMinIdleMs: 0, maxDeliveries: 1 });
    await worker.redis.xadd(worker.config.streamName, "*", "event", event(`it-${randomUUID()}`));
    await worker.redis.xreadgroup(
      "GROUP",
      worker.config.groupName,
      "crashed",
      "STREAMS",
      worker.config.streamName,
      ">"
    );

    expect(await worker.reclaim()).toBe(0);

    expect(await pendingCount(worker)).toBe(0);
    const dead = (await worker.redis.xrange(worker.config.deadLetterStreamName, "-", "+")) as Array<
      [string, string[]]
    >;
    expect(dead[0][1].slice(0, 2)).toEqual(["reason", "max_deliveries_exceeded"]);
  });

  it("survives Postgres terminating its connections and keeps processing", async () => {
    const worker = await startWorker();
    await worker.pool.query("select 1");
    expect(worker.pool.idleCount).toBeGreaterThan(0);

    // What a Postgres restart or failover does to every idle client in the pool. No listener is
    // added here on purpose: without the one createPool() installs, the idle client's error is an
    // unhandled 'error' event, which vitest reports as a failure (and which exits a real process).
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    const terminated = await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'heightproof-worker'`
    );
    await admin.end();
    expect(terminated.rowCount).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const id = `it-${randomUUID()}`;
    await worker.redis.xadd(worker.config.streamName, "*", "event", event(id));
    await worker.tick();
    expect(await persisted(worker, id)).toBe(1);
  });

  it("writes a heartbeat that expires", async () => {
    const worker = await startWorker({ heartbeatTtlMs: 200 });
    await worker.heartbeat();
    expect(JSON.parse((await worker.redis.get(worker.config.heartbeatKey)) ?? "{}")).toMatchObject({
      consumer: worker.config.consumerName
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await worker.redis.get(worker.config.heartbeatKey)).toBeNull();
  });

  describe("incident recurrence", () => {
    const assessment: ThreatAssessment = {
      score: 60,
      severity: "high",
      signals: [
        { name: "auth_failure", weight: 24, reason: "Authentication failed or was rejected" }
      ]
    };

    function failedLogin(projectId: string): HeightproofEvent {
      return {
        id: `it-${randomUUID()}`,
        projectId,
        serviceName: "integration",
        environment: "test",
        timestamp: new Date().toISOString(),
        kind: "rest",
        request: {
          method: "POST",
          path: "/login",
          ip: "203.0.113.50",
          headers: {},
          query: {},
          auth: { present: true, failed: true }
        },
        response: { statusCode: 401, latencyMs: 12 }
      };
    }

    // What the worker does per event: persist it, then upsert the incident that references it.
    async function observe(worker: Worker, event: HeightproofEvent) {
      await persistEvent(worker.pool, event, assessment);
      await createIncidentIfNeeded(worker.pool, event, assessment);
    }

    async function incidentsFor(worker: Worker, projectId: string) {
      const result = await worker.pool.query(
        `select status, request_count from incidents where project_id = $1`,
        [projectId]
      );
      return result.rows as Array<{ status: string; request_count: number }>;
    }

    it("reopens a resolved incident when the problem recurs", async () => {
      const worker = await startWorker();
      const projectId = `it-${randomUUID()}`;
      await observe(worker, failedLogin(projectId));
      await worker.pool.query(`update incidents set status = 'resolved' where project_id = $1`, [
        projectId
      ]);

      await observe(worker, failedLogin(projectId));

      expect(await incidentsFor(worker, projectId)).toEqual([{ status: "open", request_count: 2 }]);
    });

    it("keeps an ignored incident suppressed when the problem recurs", async () => {
      const worker = await startWorker();
      const projectId = `it-${randomUUID()}`;
      await observe(worker, failedLogin(projectId));
      await worker.pool.query(`update incidents set status = 'ignored' where project_id = $1`, [
        projectId
      ]);

      await observe(worker, failedLogin(projectId));

      expect(await incidentsFor(worker, projectId)).toEqual([
        { status: "ignored", request_count: 1 }
      ]);
    });
  });
});
