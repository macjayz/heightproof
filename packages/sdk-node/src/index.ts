import type { NextFunction, Request, Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import {
  classifyTraffic,
  EventBatch,
  normalizeRoutePath,
  RedactionConfig,
  redactHeaders,
  redactValue,
  HeightproofEvent
} from "@heightproof/shared";

export type HeightproofMiddlewareOptions = {
  projectId: string;
  apiKey: string;
  endpoint: string;
  serviceName: string;
  environment?: string;
  redaction?: RedactionConfig;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  /**
   * Most events held in memory while Heightproof is unreachable. Beyond this the oldest are
   * dropped, so an outage costs telemetry, never the host application's memory. Default 5000.
   */
  maxQueueSize?: number;
  /** Abort an ingestion request after this long. Default 5000ms. */
  requestTimeoutMs?: number;
  /** Called when events are discarded, with how many and why. */
  onDrop?: (count: number, reason: DropReason) => void;
};

export type DropReason = "queue_full" | "rejected";

const DEFAULT_MAX_QUEUE_SIZE = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

type RequestWithCapturedError = Request & { heightproofError?: unknown };

export function heightproofErrorHandler() {
  return function heightproofErrorMiddleware(err: unknown, req: Request, _res: Response, next: NextFunction) {
    (req as RequestWithCapturedError).heightproofError = err;
    next(err);
  };
}

export function heightproofExpress(options: HeightproofMiddlewareOptions) {
  const client = new HeightproofClient(options);

  return function heightproofMiddleware(req: Request, res: Response, next: NextFunction) {
    const started = performance.now();
    const chunks: Buffer[] = [];
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = ((chunk: Buffer | string, ...args: unknown[]) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalWrite(chunk, ...(args as never[]));
    }) as unknown as Response["write"];

    res.end = ((chunk?: Buffer | string, ...args: unknown[]) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalEnd(chunk, ...(args as never[]));
    }) as unknown as Response["end"];

    res.on("finish", () => {
      const body = req.body;
      const kind = classifyTraffic(req.path, body);
      const headers = normalizeHeaders(req.headers);
      const authHeader = headers.authorization;
      const route = req.route?.path ? String(req.route.path) : normalizeRoutePath(req.path);
      const traceId = getTraceId(req);
      const event: HeightproofEvent = {
        id: randomUUID(),
        traceId,
        projectId: options.projectId,
        serviceName: options.serviceName,
        environment: options.environment ?? process.env.NODE_ENV ?? "development",
        timestamp: new Date().toISOString(),
        kind,
        request: {
          method: req.method as HeightproofEvent["request"]["method"],
          path: req.path,
          route,
          ip: req.ip,
          userAgent: headers["user-agent"],
          headers: redactHeaders(headers, options.redaction),
          query: redactValue(req.query, options.redaction) as Record<string, unknown>,
          body: redactValue(body, options.redaction),
          auth: {
            present: Boolean(authHeader),
            scheme: authHeader?.split(" ")[0],
            failed: [401, 403].includes(res.statusCode)
          }
        },
        response: {
          statusCode: res.statusCode,
          latencyMs: Math.round(performance.now() - started),
          bodyBytes: Buffer.concat(chunks).byteLength
        }
      };

      if (kind === "graphql" && isRecord(body)) {
        event.graphQL = {
          operationName: typeof body.operationName === "string" ? body.operationName : undefined,
          operationType: inferGraphQLOperation(body.query)
        };
      }

      if (kind === "evm_rpc" && isRecord(body) && typeof body.method === "string") {
        event.evmRpc = { method: body.method, chainId: headers["x-chain-id"] };
      }

      const capturedError = (req as RequestWithCapturedError).heightproofError;
      if (capturedError instanceof Error) {
        event.error = {
          type: capturedError.name || "Error",
          message: capturedError.message,
          stack: capturedError.stack
        };
      } else if (capturedError !== undefined) {
        event.error = { type: "Error", message: String(capturedError) };
      }

      client.capture(event);
    });

    next();
  };
}

function getTraceId(req: Request) {
  const existing = req.headers["x-heightproof-trace-id"];
  if (typeof existing === "string" && /^[0-9a-f]{32}$/i.test(existing)) return existing;
  return randomBytes(16).toString("hex");
}

export class HeightproofClient {
  private queue: HeightproofEvent[] = [];
  private timer?: NodeJS.Timeout;
  private dropped = 0;

  constructor(private readonly options: HeightproofMiddlewareOptions) {
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 5000);
    this.timer.unref?.();
  }

  capture(event: HeightproofEvent): void {
    this.queue.push(event);
    this.enforceQueueLimit();
    if (this.queue.length >= (this.options.maxBatchSize ?? 25)) {
      void this.flush();
    }
  }

  /** Events waiting to be sent, and events discarded since the client started. */
  stats(): { queued: number; dropped: number } {
    return { queued: this.queue.length, dropped: this.dropped };
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, this.options.maxBatchSize ?? 25);
    const payload: EventBatch = { events };

    try {
      const response = await fetch(new URL("/v1/events", this.options.endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-heightproof-api-key": this.options.apiKey
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      });

      if (response.ok) return;
      if (isRetryableStatus(response.status)) {
        this.requeue(events);
      } else {
        // A 400, 401, 403 or 413 will be rejected identically on every retry. Re-queueing it
        // would put it back at the head of the queue and block every later batch for good.
        this.drop(events.length, "rejected");
      }
    } catch {
      // Network failure or timeout: Heightproof may come back, so keep the batch.
      this.requeue(events);
    }
  }

  private requeue(events: HeightproofEvent[]) {
    this.queue.unshift(...events);
    this.enforceQueueLimit();
  }

  private enforceQueueLimit() {
    const overflow = this.queue.length - (this.options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
    if (overflow <= 0) return;
    this.queue.splice(0, overflow);
    this.drop(overflow, "queue_full");
  }

  private drop(count: number, reason: DropReason) {
    this.dropped += count;
    try {
      this.options.onDrop?.(count, reason);
    } catch {
      // A throwing callback must not break capture in the host application.
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function normalizeHeaders(headers: Request["headers"]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : String(value ?? "")
    ])
  );
}

function inferGraphQLOperation(query: unknown): string | undefined {
  if (typeof query !== "string") return undefined;
  const match = query.trim().match(/^(query|mutation|subscription)\b/);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
