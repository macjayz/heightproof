# @heightproof/sdk-node

Node.js client for a self-hosted [Heightproof](https://github.com/macjayz/heightproof) instance:
batched, non-blocking event delivery, plus Express middleware that records REST and GraphQL
requests so they can be correlated with RPC incidents.

For EVM JSON-RPC monitoring, use [`@heightproof/web3`](https://www.npmjs.com/package/@heightproof/web3),
which builds on this package.

```bash
npm install @heightproof/sdk-node
```

## Express

```ts
import { heightproofErrorHandler, heightproofExpress } from "@heightproof/sdk-node";

app.use(
  heightproofExpress({
    projectId: "my-project",
    apiKey: process.env.HEIGHTPROOF_API_KEY!,
    endpoint: "https://heightproof.internal",
    serviceName: "payments-api"
  })
);

// ...routes...

app.use(heightproofErrorHandler()); // captures thrown errors for error grouping
```

Sensitive headers and body fields (authorization, cookies, passwords, private keys, mnemonics)
are redacted before anything leaves the process. Add your own with the `redaction` option.

## Delivery options

| Option | Default | |
|---|---|---|
| `flushIntervalMs` | `5000` | How often queued events are sent |
| `maxBatchSize` | `25` | Events per request; reaching it also triggers a send |
| `maxQueueSize` | `5000` | Events held while Heightproof is unreachable; oldest dropped beyond this |
| `requestTimeoutMs` | `5000` | Abort an ingestion request after this long |
| `onDrop` | — | `(count, reason) => void`, called when events are discarded (`queue_full` or `rejected`) |

Network failures, timeouts, `408`, `429` and `5xx` responses are retried on the next flush. Other
`4xx` responses are dropped, since they would be rejected identically every time.
`HeightproofClient#stats()` reports how many events are queued and how many have been dropped.

## License

MIT
