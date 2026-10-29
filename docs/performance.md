# Performance

Measured with `scripts/load/ingest.ts` against `docker compose up` on one machine (10 CPU,
8 GB to Docker), single worker, Postgres 16 and Redis 7 from the compose file. Each run sends
30 seconds of traffic from 8 concurrent senders in batches of 100, with a real project API key.

| | REST events | EVM RPC events |
|---|---|---|
| Accepted by the API | 59,000 in 30 s | 59,000 in 30 s |
| Accept latency (all responses) p50 / p95 / p99 | 2.9 / 17.5 / 37.8 ms | 3.4 / 21.5 / 55.4 ms |
| Worker throughput while backlogged | **~1,030 events/s** | **~100 events/s** |
| Peak backlog | 56,109 events (≈55 s) | 58,074 events (≈580 s) |
| Drained after sending stopped | 27 s | 559 s |

## What limits it

1. **The per-IP rate limit, at the API.** 600 requests per minute per IP, all routes. With
   100-event batches that is 1,000 events/s sustained from one address; the test spent its
   minute's allowance in its first 30 s and every later batch got `429`. One SDK instance behind
   one NAT shares this budget. Health and metrics endpoints are exempt.
2. **The worker, for RPC traffic.** Every EVM RPC event runs about nine context queries against
   `api_events` (stale head, disagreement, reorg, throttling, cost, baselines) before it is
   written, one event at a time. REST events skip those and run ten times faster. This is the
   real ceiling: ~100 RPC events/s per worker. Scaling out is supported (consumer group plus
   `XCLAIM`), but per-event query cost is the thing to cut first: batch the context lookups per
   endpoint per batch, and keep rolling per-endpoint state (head, baselines) instead of
   re-deriving it from `api_events` on every event.
3. **Not yet measured:** behaviour as `api_events` grows into millions of rows (no partitioning
   or retention yet), and multiple workers.

Accept latency percentiles include the fast `429` rejections, so they slightly flatter the
`202` path.
