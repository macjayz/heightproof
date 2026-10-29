import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeightproofClient, heightproofErrorHandler, heightproofExpress } from "./index.js";

function createFakeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/api/users/42",
    ip: "203.0.113.5",
    headers: {},
    query: {},
    body: {},
    ...overrides
  } as unknown as Request;
}

function createFakeResponse(statusCode: number): Response {
  const res = new EventEmitter() as unknown as Response & { statusCode: number };
  res.statusCode = statusCode;
  res.write = vi.fn().mockReturnValue(true) as unknown as Response["write"];
  res.end = vi.fn(function (this: EventEmitter) {
    this.emit("finish");
    return this;
  }) as unknown as Response["end"];
  return res;
}

describe("heightproofExpress error capture", () => {
  it("attaches the caught error to the request and forwards it to next", () => {
    const handler = heightproofErrorHandler();
    const req = createFakeRequest();
    const next = vi.fn();
    const error = new TypeError("Cannot read property 'email' of undefined");

    handler(error, req, createFakeResponse(500), next);

    expect((req as Request & { heightproofError?: unknown }).heightproofError).toBe(error);
    expect(next).toHaveBeenCalledWith(error);
  });

  it("captures the error type, message, and stack on the emitted event", () => {
    const captured: unknown[] = [];
    vi.spyOn(HeightproofClient.prototype, "capture").mockImplementation(function (event) {
      captured.push(event);
    });

    const middleware = heightproofExpress({
      projectId: "demo",
      apiKey: "dev-heightproof-key",
      endpoint: "http://localhost:8080",
      serviceName: "example-api"
    });
    const errorHandler = heightproofErrorHandler();
    const req = createFakeRequest();
    const res = createFakeResponse(500);
    const next = vi.fn();
    const error = new TypeError("Cannot read property 'email' of undefined");

    middleware(req, res, next);
    errorHandler(error, req, res, next);
    res.end();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      error: {
        type: "TypeError",
        message: "Cannot read property 'email' of undefined"
      }
    });
    expect((captured[0] as { error: { stack?: string } }).error.stack).toContain("TypeError");

    vi.restoreAllMocks();
  });

  it("does not add an error field when the request succeeds", () => {
    const captured: unknown[] = [];
    vi.spyOn(HeightproofClient.prototype, "capture").mockImplementation(function (event) {
      captured.push(event);
    });

    const middleware = heightproofExpress({
      projectId: "demo",
      apiKey: "dev-heightproof-key",
      endpoint: "http://localhost:8080",
      serviceName: "example-api"
    });
    const req = createFakeRequest();
    const res = createFakeResponse(200);
    const next = vi.fn();

    middleware(req, res, next);
    res.end();

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty("error");

    vi.restoreAllMocks();
  });
});

describe("HeightproofClient delivery", () => {
  const options = {
    projectId: "demo",
    apiKey: "dev-heightproof-key",
    endpoint: "http://localhost:8080",
    serviceName: "example-api",
    flushIntervalMs: 60_000,
    maxBatchSize: 2
  };

  function event(id: string) {
    return {
      id,
      projectId: "demo",
      serviceName: "example-api",
      environment: "test",
      timestamp: "2026-09-01T20:12:00.000Z",
      kind: "rest" as const,
      request: {
        method: "GET" as const,
        path: "/",
        headers: {},
        query: {},
        auth: { present: false, failed: false }
      },
      response: { statusCode: 200, latencyMs: 1 }
    };
  }

  function respondWith(...statuses: Array<number | Error>) {
    const fetchMock = vi.fn();
    for (const status of statuses) {
      if (status instanceof Error) fetchMock.mockRejectedValueOnce(status);
      else fetchMock.mockResolvedValueOnce({ ok: status < 300, status });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caps memory while Heightproof is unreachable by dropping the oldest events", () => {
    const drops: Array<[number, string]> = [];
    const client = new HeightproofClient({
      ...options,
      maxBatchSize: 100,
      maxQueueSize: 3,
      onDrop: (count, reason) => drops.push([count, reason])
    });

    for (const id of ["e1", "e2", "e3", "e4", "e5"]) client.capture(event(id));

    expect(client.stats()).toEqual({ queued: 3, dropped: 2 });
    expect(drops).toEqual([
      [1, "queue_full"],
      [1, "queue_full"]
    ]);
    client.stop();
  });

  it("keeps a batch for retry when the network fails or the server is overloaded", async () => {
    respondWith(new TypeError("fetch failed"), 503, 429);
    const client = new HeightproofClient(options);
    client.capture(event("e1"));

    await client.flush();
    await client.flush();
    await client.flush();

    expect(client.stats()).toEqual({ queued: 1, dropped: 0 });
    client.stop();
  });

  it("drops a batch the server rejects instead of retrying it forever", async () => {
    const fetchMock = respondWith(401, 202);
    const drops: Array<[number, string]> = [];
    const client = new HeightproofClient({
      ...options,
      maxBatchSize: 1,
      onDrop: (c, r) => drops.push([c, r])
    });
    client.capture(event("rejected"));
    client.capture(event("next"));

    await client.flush();
    await client.flush();

    expect(drops).toEqual([[1, "rejected"]]);
    expect(client.stats()).toEqual({ queued: 0, dropped: 1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).events[0].id).toBe("next");
    client.stop();
  });

  it("aborts an ingestion request that hangs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HeightproofClient({ ...options, requestTimeoutMs: 1234 });
    client.capture(event("e1"));

    await client.flush();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    client.stop();
  });
});
