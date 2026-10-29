import { describe, expect, it, vi } from "vitest";
import { buildMetricsSnapshot, buildReadiness, createRuntimeMetrics } from "./observability.js";

const pool = {
  query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] })
};

const liveHub = {
  connectionCount: () => 0
};

describe("api observability", () => {
  it("reports queue depth as consumer backlog, not retained stream length", async () => {
    const redis = {
      xinfo: vi
        .fn()
        .mockResolvedValue([
          "name",
          "heightproof-workers",
          "consumers",
          "1",
          "pending",
          "0",
          "last-delivered-id",
          "1-0",
          "lag",
          "0"
        ]),
      xlen: vi.fn().mockResolvedValue(138)
    };

    const snapshot = await buildMetricsSnapshot(
      createRuntimeMetrics(),
      pool as never,
      redis as never,
      "heightproof:events",
      "heightproof-workers",
      liveHub
    );

    expect(snapshot.queueDepth).toBe(0);
    expect(redis.xlen).not.toHaveBeenCalled();
  });

  it("includes pending entries in queue depth", async () => {
    const redis = {
      xinfo: vi.fn().mockResolvedValue([
        ["name", "heightproof-workers", "consumers", 1, "pending", 3, "last-delivered-id", "1-0", "lag", 7]
      ]),
      xlen: vi.fn().mockResolvedValue(20),
      xpending: vi.fn().mockResolvedValue([3, "1-0", "1-0", [["worker-1", "3"]]]),
      xrange: vi.fn().mockResolvedValue([])
    };

    const snapshot = await buildMetricsSnapshot(
      createRuntimeMetrics(),
      pool as never,
      redis as never,
      "heightproof:events",
      "heightproof-workers",
      liveHub
    );

    expect(snapshot.queueDepth).toBe(10);
  });

  describe("readiness", () => {
    const target = {
      streamName: "heightproof:events",
      groupName: "heightproof-workers",
      heartbeatKey: "heightproof:events:heartbeat",
      maxQueueAgeMs: 60_000
    };
    const now = 1_800_000_000_000;
    const heartbeat = JSON.stringify({ consumer: "worker-1", at: "2027-01-15T08:00:00.000Z" });

    function redisWith(options: { pendingSinceMs?: number; unreadSinceMs?: number; heartbeat?: string | null }) {
      const pending = options.pendingSinceMs === undefined ? 0 : 1;
      const lag = options.unreadSinceMs === undefined ? 0 : 1;
      return {
        xinfo: vi.fn().mockResolvedValue([
          ["name", "heightproof-workers", "pending", pending, "last-delivered-id", `${now - 999_999}-0`, "lag", lag]
        ]),
        xlen: vi.fn(),
        xpending: vi
          .fn()
          .mockResolvedValue(
            pending ? [1, `${options.pendingSinceMs}-0`, `${options.pendingSinceMs}-0`, []] : [0, null, null, null]
          ),
        xrange: vi.fn().mockResolvedValue(lag ? [[`${options.unreadSinceMs}-0`, ["event", "{}"]]] : []),
        get: vi.fn().mockResolvedValue(options.heartbeat === undefined ? heartbeat : options.heartbeat)
      };
    }

    it("is ready with an empty queue and a live worker", async () => {
      const readiness = await buildReadiness(pool as never, redisWith({}) as never, target, now);

      expect(readiness.status).toBe("ready");
      expect(readiness.pipeline).toBe("healthy");
      expect(readiness.checks.queue).toMatchObject({ ok: true, depth: 0, oldestAgeMs: 0 });
      expect(readiness.checks.worker).toMatchObject({ ok: true, consumer: "worker-1" });
    });

    it("stays ready while a fresh backlog is draining", async () => {
      const redis = redisWith({ unreadSinceMs: now - 5_000 });
      const readiness = await buildReadiness(pool as never, redis as never, target, now);

      expect(readiness.pipeline).toBe("healthy");
      expect(readiness.checks.queue.oldestAgeMs).toBe(5_000);
    });

    it("reports a stalled pipeline, but stays ready, when a message is stranded", async () => {
      const redis = redisWith({ pendingSinceMs: now - 120_000, unreadSinceMs: now - 1_000 });
      const readiness = await buildReadiness(pool as never, redis as never, target, now);

      // The API can still accept events; taking it out of rotation would only add an outage.
      expect(readiness.status).toBe("ready");
      expect(readiness.pipeline).toBe("stalled");
      expect(readiness.checks.queue).toMatchObject({ ok: false, depth: 2, oldestAgeMs: 120_000 });
    });

    it("reports a stalled pipeline when no worker heartbeat is present", async () => {
      const readiness = await buildReadiness(pool as never, redisWith({ heartbeat: null }) as never, target, now);

      expect(readiness.status).toBe("ready");
      expect(readiness.pipeline).toBe("stalled");
      expect(readiness.checks.worker.ok).toBe(false);
    });

    it("is not ready when Redis cannot be reached, since ingestion cannot enqueue", async () => {
      const down = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
      const redis = { xinfo: down, xlen: down, xpending: down, xrange: down, get: down };
      const readiness = await buildReadiness(pool as never, redis as never, target, now);

      expect(readiness.status).toBe("degraded");
      expect(readiness.checks.queue).toMatchObject({ reachable: false });
    });
  });
});
