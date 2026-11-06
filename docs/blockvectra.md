# Compare with a BlockVectra endpoint

Use this server-side example to add your own BlockVectra RPC endpoint to an existing
Heightproof verification setup. It uses the `VerificationEndpoint.fetchImpl` hook; no SDK
adapter or change to your application's primary provider is needed.

## Configure the comparison endpoint

Set `BLOCKVECTRA_RPC_URL` to the header-authenticated RPC URL for your chosen chain,
with the form `https://api.blockvectra.com/v1/{chain}`. Set `BLOCKVECTRA_API_KEY` in your
server environment. Use a key and account you control; keep both out of source control,
shared configuration and browser bundles. The key is separate from `HEIGHTPROOF_API_KEY`.

Find the chain and required methods in the [BlockVectra chain directory](https://api.blockvectra.com/v1/chains)
and [method and coverage checks](https://docs.blockvectra.com/en/guides/choose-rpc-provider/). The documentation-only
MCP URL is not a JSON-RPC comparison endpoint.

```js
const rpc = new URL(process.env.BLOCKVECTRA_RPC_URL ?? "");
if (
  rpc.origin !== "https://api.blockvectra.com" ||
  rpc.username || rpc.password || rpc.search || rpc.hash ||
  !/^\/v1\/[a-z0-9_]+\/?$/.test(rpc.pathname)
) {
  throw new Error("Set a header-authenticated BlockVectra RPC URL");
}
const key = process.env.BLOCKVECTRA_API_KEY;
if (!key) throw new Error("Set BLOCKVECTRA_API_KEY in the server environment");

const blockvectraEndpoint = {
  rpcUrl: rpc.href,
  provider: "blockvectra",
  fetchImpl: (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", key);
    // Bind the credential to this URL. Preserve the verifier's body and abort signal.
    return fetch(rpc.href, { ...init, headers, redirect: "error" });
  }
};

const verify = {
  endpoints: [blockvectraEndpoint],
  sampleRate: 0.01,
  maxCallsPerMinute: 6,
  timeoutMs: 5000
};
```

Pass `verify` to your existing `heightproofTransport` or `wrapEip1193Provider` options.
Set those options' `rpcUrl` and `provider` to your **existing primary**, so Heightproof
includes that primary in the pinned verification fan-out. Keep the primary URL distinct
from the comparison URL; endpoint deduplication is by URL. If using other comparison
endpoints already, retain them in `verify.endpoints`.

This fetch hook only supplies the comparison endpoint's authentication. It does not
configure authentication for the primary. The sample rate applies to eligible calls;
verification also consumes provider requests. The verifier's request limit is separate
from application traffic, account quotas and provider billing limits.

## Match the workload

Before enabling comparisons, check `eth_chainId` on both endpoints and confirm the same
network. Heightproof's `chainId` option labels telemetry; it is not that identity check.
Choose methods and historical blocks supported by both endpoints. Keyless access,
authenticated access and historical coverage can differ.

For a comparison, keep the method, pinned blocks, log address/topics, pacing and timeout
the same. Inspect block hashes when investigating a disagreement: equal block numbers
do not establish that both providers saw the same canonical block. Keep RPC errors and
unsupported history separate from successful-but-different results.

For an issue such as [a zero log timestamp](https://github.com/OffchainLabs/nitro/issues/4780),
retain the relevant redacted field comparison and log identities alongside the result
hashes. A differing hash alone does not identify the field or establish which provider
is correct. This configuration is not a live compatibility or reliability result.
