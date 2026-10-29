import { randomUUID } from "node:crypto";
import pg from "pg";
import type { HeightproofEvent, ThreatAssessment } from "@heightproof/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createIncidentIfNeeded, getStaleHeadContext, persistEvent } from "./db.js";
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

  describe("duplicates and retries", () => {
    // Scores 26 (sensitive_rpc), so it opens an incident, and carries an error, so it opens an
    // error group: every derived write the worker makes for one event.
    function sensitiveRpcWithError(projectId: string, id = `it-${randomUUID()}`) {
      return JSON.stringify({
        id,
        projectId,
        serviceName: "integration",
        timestamp: new Date().toISOString(),
        kind: "evm_rpc",
        request: { method: "POST", path: "/", ip: "203.0.113.60" },
        response: { statusCode: 200, latencyMs: 30 },
        evmRpc: { method: "eth_sendRawTransaction", chainId: "1", provider: "integration" },
        error: { type: "RpcError", message: "nonce too low" }
      });
    }

    // error_groups references projects, so these tests need a real project row.
    async function newProject(worker: Worker) {
      const projectId = `it-${randomUUID()}`;
      await worker.pool.query(
        `with org as (insert into organizations (name) values ($1) returning id)
         insert into projects (id, organization_id, name) select $1, id, $1 from org`,
        [projectId]
      );
      return projectId;
    }

    async function effects(worker: Worker, projectId: string) {
      const [events, incidents, errors] = await Promise.all([
        worker.pool.query(`select count(*)::int as n from api_events where project_id = $1`, [
          projectId
        ]),
        worker.pool.query(
          `select coalesce(sum(request_count), 0)::int as n from incidents where project_id = $1`,
          [projectId]
        ),
        worker.pool.query(
          `select coalesce(sum(occurrences), 0)::int as n from error_groups where project_id = $1`,
          [projectId]
        )
      ]);
      return {
        events: events.rows[0].n,
        incidentHits: incidents.rows[0].n,
        errorHits: errors.rows[0].n
      };
    }

    it("applies an event sent twice exactly once", async () => {
      const worker = await startWorker();
      const projectId = await newProject(worker);
      const payload = sensitiveRpcWithError(projectId);
      // The SDK retries a batch whose 202 it never saw, so the same event reaches the stream twice.
      await worker.redis.xadd(worker.config.streamName, "*", "event", payload);
      await worker.redis.xadd(worker.config.streamName, "*", "event", payload);

      await worker.tick();

      expect(await effects(worker, projectId)).toEqual({
        events: 1,
        incidentHits: 1,
        errorHits: 1
      });
      expect(await pendingCount(worker)).toBe(0);
    });

    it("rolls back a partly processed event and applies it once on retry", async () => {
      const worker = await startWorker({ reclaimMinIdleMs: 50 });
      const projectId = await newProject(worker);
      const trigger = `fail_${randomUUID().replaceAll("-", "")}`;
      // Fail the last write (error group) after the event row and incident were already written.
      await worker.pool.query(`
        create function ${trigger}() returns trigger language plpgsql as $$
        begin
          if new.project_id = '${projectId}' then raise exception 'injected failure'; end if;
          return new;
        end $$;
        create trigger ${trigger} before insert on error_groups
          for each row execute function ${trigger}();
      `);
      await worker.redis.xadd(
        worker.config.streamName,
        "*",
        "event",
        sensitiveRpcWithError(projectId)
      );

      try {
        await expect(worker.tick()).rejects.toThrow("injected failure");
        expect(await effects(worker, projectId)).toEqual({
          events: 0,
          incidentHits: 0,
          errorHits: 0
        });
        expect(await pendingCount(worker)).toBe(1);
      } finally {
        await worker.pool.query(
          `drop trigger ${trigger} on error_groups; drop function ${trigger}();`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await worker.reclaim()).toBe(1);

      expect(await effects(worker, projectId)).toEqual({
        events: 1,
        incidentHits: 1,
        errorHits: 1
      });
      expect(await pendingCount(worker)).toBe(0);
    });

    it("does not reopen a resolved incident when an old event is redelivered", async () => {
      const worker = await startWorker();
      const projectId = await newProject(worker);
      const payload = sensitiveRpcWithError(projectId);
      await worker.redis.xadd(worker.config.streamName, "*", "event", payload);
      await worker.tick();
      await worker.pool.query(`update incidents set status = 'resolved' where project_id = $1`, [
        projectId
      ]);

      await worker.redis.xadd(worker.config.streamName, "*", "event", payload);
      await worker.tick();

      const incident = await worker.pool.query(
        `select status, request_count from incidents where project_id = $1`,
        [projectId]
      );
      expect(incident.rows).toEqual([{ status: "resolved", request_count: 1 }]);
    });
  });

  describe("stale-head context", () => {
    const noSignal: ThreatAssessment = { score: 0, severity: "low", signals: [] };

    async function observeHead(
      worker: Worker,
      projectId: string,
      endpointHash: string,
      block: number,
      at: Date,
      shadowOfTraceId?: string
    ) {
      await persistEvent(
        worker.pool,
        {
          id: `it-${randomUUID()}`,
          projectId,
          serviceName: "integration",
          environment: "test",
          timestamp: at.toISOString(),
          kind: "evm_rpc",
          request: {
            method: "POST",
            path: "/rpc",
            headers: {},
            query: {},
            auth: { present: true, failed: false }
          },
          response: { statusCode: 200, latencyMs: 5 },
          evmRpc: {
            method: "eth_blockNumber",
            chainId: "1",
            endpointHash,
            blockNumber: String(block),
            shadowOfTraceId
          }
        },
        noSignal
      );
    }

    it("judges lag only against heads observed up to the event, so late batches do not read as lag", async () => {
      const worker = await startWorker();
      const projectId = `it-${randomUUID()}`;
      const base = Date.now() - 60_000;
      for (let i = 0; i < 3; i++)
        await observeHead(worker, projectId, "endpoint-b", 1_000 + i, new Date(base + i * 1_000));
      // Endpoint A's batch is stored first but describes a later moment.
      await observeHead(worker, projectId, "endpoint-a", 1_010, new Date(base + 10_000));

      const asOfB = await getStaleHeadContext(
        worker.pool,
        projectId,
        "1",
        "endpoint-b",
        new Date(base + 2_000).toISOString()
      );
      const later = await getStaleHeadContext(
        worker.pool,
        projectId,
        "1",
        "endpoint-b",
        new Date(base + 10_000).toISOString()
      );

      expect(asOfB).toMatchObject({ endpointHeadBlockNumber: 1_002, chainHeadBlockNumber: 1_002 });
      expect(later).toMatchObject({ endpointHeadBlockNumber: 1_002, chainHeadBlockNumber: 1_010 });
    });

    it("ignores verification observations pinned behind the head", async () => {
      const worker = await startWorker();
      const projectId = `it-${randomUUID()}`;
      const base = Date.now() - 60_000;
      for (let i = 0; i < 3; i++)
        await observeHead(worker, projectId, "endpoint-b", 1_000 + i, new Date(base + i * 1_000));
      await observeHead(
        worker,
        projectId,
        "endpoint-b",
        900,
        new Date(base + 3_000),
        "0123456789abcdef0123456789abcdef"
      );

      const context = await getStaleHeadContext(
        worker.pool,
        projectId,
        "1",
        "endpoint-b",
        new Date(base + 5_000).toISOString()
      );

      expect(context).toMatchObject({
        endpointHeadBlockNumber: 1_002,
        endpointHeadObservations: 3
      });
    });
  });
});
