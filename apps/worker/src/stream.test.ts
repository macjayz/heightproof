import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./worker.js";
import { parseStreamMessage } from "./stream.js";

const event = {
  id: "event-stream-1",
  projectId: "demo",
  serviceName: "api",
  timestamp: "2026-09-01T20:12:00.000Z",
  kind: "rest",
  request: { method: "GET", path: "/health" },
  response: { statusCode: 200, latencyMs: 3 }
};

describe("parseStreamMessage", () => {
  it("parses a well-formed event", () => {
    const parsed = parseStreamMessage(["event", JSON.stringify(event)]);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.id).toBe("event-stream-1");
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(parseStreamMessage(["event", "not-json"])).toEqual({
      ok: false,
      reason: "invalid_json"
    });
  });

  it("reports a missing event field", () => {
    expect(parseStreamMessage(["payload", "{}"])).toEqual({
      ok: false,
      reason: "missing_event_field"
    });
  });

  it("does not mistake a field value of 'event' for the field name", () => {
    expect(parseStreamMessage(["kind", "event"])).toEqual({
      ok: false,
      reason: "missing_event_field"
    });
  });

  it("reports events that fail the schema", () => {
    expect(parseStreamMessage(["event", JSON.stringify({ id: "x" })])).toEqual({
      ok: false,
      reason: "schema_mismatch"
    });
  });
});

describe("backoffDelayMs", () => {
  it("doubles from one second and caps at thirty", () => {
    expect([1, 2, 3, 5, 6, 10].map(backoffDelayMs)).toEqual([
      1000, 2000, 4000, 16000, 30000, 30000
    ]);
  });
});
