# @heightproof/web3

Report every EVM JSON-RPC call your application makes to a self-hosted
[Heightproof](https://github.com/macjayz/heightproof) instance, which detects the provider
failures that still return `200 OK`: stale chain heads, providers disagreeing at the same block
height, JSON-RPC errors inside success responses, reorg lag, and rate limiting disguised as
success.

```bash
npm install @heightproof/web3
```

## Wrap an EIP-1193 provider

```ts
import { wrapEip1193Provider } from "@heightproof/web3";

const provider = wrapEip1193Provider(window.ethereum, {
  projectId: "my-project",
  apiKey: process.env.HEIGHTPROOF_API_KEY!,
  endpoint: "https://heightproof.internal",
  chainId: 1,
  provider: "alchemy"
});
```

## Or use the viem transport

```ts
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import { heightproofTransport } from "@heightproof/web3";

const client = createPublicClient({
  chain: mainnet,
  transport: heightproofTransport({
    projectId: "my-project",
    apiKey: process.env.HEIGHTPROOF_API_KEY!,
    endpoint: "https://heightproof.internal",
    rpcUrl: process.env.EVM_RPC_URL!,
    chainId: 1,
    provider: "alchemy"
  })
});
```

`createHeightproofRpcClient(options)` gives the same recording around a plain `request()` call
when you are not using viem or an injected provider.

## What it records

Method, chain, provider label, latency, status, the block the call resolved against, a hash of the
normalized result, its shape (`value`, `null`, `empty_array`, `empty_data`, `error_in_body`), any
JSON-RPC error code, and whether the response looked like rate limiting. Raw results are not sent.

Your RPC URL never leaves your process: Heightproof receives a hash of the endpoint, never the URL,
because provider URLs embed API keys.

## Cross-provider verification

Off unless configured, because it sends real requests to the endpoints you name:

```ts
wrapEip1193Provider(provider, {
  // ...
  verify: {
    endpoints: [{ rpcUrl: process.env.SECONDARY_RPC_URL!, provider: "infura" }],
    sampleRate: 0.01, // fraction of deterministic reads to re-check
    maxCallsPerMinute: 60 // hard ceiling on extra requests
  }
});
```

Sampled reads are re-issued against every endpoint pinned to the same block height, so a
mismatch is a real disagreement rather than head skew. Verification runs after your call returns
and never delays or fails it.

## Delivery

Events are batched in memory and sent every 5 seconds or every 25 events. Recording never blocks
or throws into your RPC calls. If Heightproof is unreachable, batches are retried; the in-memory
queue is capped (5,000 events by default, oldest dropped first) so an outage costs telemetry,
not your application's memory. Batches the server rejects outright (bad key, invalid payload) are
dropped rather than retried forever.

## License

MIT
