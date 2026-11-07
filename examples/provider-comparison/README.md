# Compare user-selected RPC providers

Use this server-side recipe to add an optional comparison endpoint to an existing
Heightproof setup. It uses `VerificationEndpoint.fetchImpl`; it does not change the
primary provider or recommend a provider. No RPC URL is selected by default.

## Supply the configuration

Set these variables in your server environment:

| Variable | Purpose |
| --- | --- |
| `COMPARISON_RPC_URL` | HTTPS JSON-RPC URL for the network you want to compare |
| `COMPARISON_PROVIDER` | Label for that provider in Heightproof |
| `COMPARISON_RPC_HEADER` | Optional authentication header name |
| `COMPARISON_RPC_KEY` | Header value; set only together with the header name |

This recipe supports keyless and header-authenticated endpoints. It deliberately
rejects URL credentials and query strings; do not put keys in URLs, source control,
shared configuration or browser bundles. Comparison credentials are separate from
`HEIGHTPROOF_API_KEY`. Use accounts and keys you control.

```js
let rpc;
try {
  rpc = new URL(process.env.COMPARISON_RPC_URL ?? "");
} catch {
  throw new Error("Set COMPARISON_RPC_URL to a valid HTTPS JSON-RPC URL");
}
if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.search || rpc.hash) {
  throw new Error("Use an HTTPS RPC URL without credentials, query or fragment");
}
const provider = process.env.COMPARISON_PROVIDER;
if (!provider) throw new Error("Set COMPARISON_PROVIDER");
const header = process.env.COMPARISON_RPC_HEADER;
const key = process.env.COMPARISON_RPC_KEY;
if (Boolean(header) !== Boolean(key)) {
  throw new Error("Set both comparison header and key, or neither for keyless access");
}
const authHeaders = new Headers();
if (header && key) {
  try {
    authHeaders.set(header, key);
  } catch {
    throw new Error("Invalid comparison authentication header configuration");
  }
}
const comparisonEndpoint = {
  rpcUrl: rpc.href,
  provider,
  fetchImpl: (_input, init) => {
    const headers = new Headers(init?.headers);
    authHeaders.forEach((value, name) => headers.set(name, value));
    // Bind credentials to this URL; keep the verifier's body and abort signal.
    return fetch(rpc.href, { ...init, headers, redirect: "error" });
  }
};
const verify = {
  endpoints: [comparisonEndpoint],
  sampleRate: 0.01,
  maxCallsPerMinute: 6,
  timeoutMs: 5000
};
```

Pass `verify` to your existing `heightproofTransport` or `wrapEip1193Provider` options.
Set those options' `rpcUrl` and `provider` to your **existing primary**, so Heightproof
includes the primary in the pinned verification fan-out. Keep its URL distinct from
the comparison URL: deduplication is by URL. Retain any other comparison endpoints
already configured. This hook authenticates only the comparison endpoint, not the primary.

Verification consumes provider requests. Sampling applies to eligible calls; the
per-minute verifier budget is separate from application traffic, account quotas and
provider billing limits. This README does not run a collector or request credentials.

## Match and interpret the workload

Before enabling comparisons, check `eth_chainId` on both endpoints and confirm the
same network. Heightproof's `chainId` option labels telemetry; it does not perform
that check. Choose methods and historical blocks both endpoints support. Compare
the same pinned blocks, address/topics, pacing and timeout, and inspect block hashes:
equal block numbers do not prove the providers saw the same canonical block.

Keep these observations separate when investigating a result:

| Observation | What to preserve and check |
| --- | --- |
| Successful but different values | Redacted fields and block hashes; a different result hash alone identifies neither the field nor the correct provider |
| Missing expected logs | Identical filters and `(blockHash, transactionHash, logIndex)` identities against the same canonical block; an empty response alone can be valid |
| Unsupported request or history | RPC/HTTP refusal and the provider's method/history support; do not count it as successful-but-different data |

For the [zero log timestamp investigation](https://github.com/OffchainLabs/nitro/issues/4780),
the useful distinction was identical log identities with a different `blockTimestamp`.
This table is an interpretation checklist, not a claim that Heightproof automatically
classifies all three cases or that any provider passed a live compatibility test.

## Optional provider setup notes

For BlockVectra, select the authenticated URL for your chain from its
[chain directory](https://api.blockvectra.com/v1/chains), then use `x-api-key` as
`COMPARISON_RPC_HEADER` with your own key as `COMPARISON_RPC_KEY`. Confirm method and
history support using the [coverage guide](https://docs.blockvectra.com/en/guides/choose-rpc-provider/).
The documentation-only MCP URL is not a JSON-RPC comparison endpoint. This note does
not choose an endpoint, enable verification or imply a provider recommendation.
