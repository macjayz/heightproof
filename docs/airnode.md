# Signed verification with AirnodeHub

Cross-provider verification (D2) tells you that two providers disagreed. Adding an
[AirnodeHub](https://airnodehub.api3.org) endpoint to the fan-out makes that finding
**independently checkable**: every answer it gives is signed, so anyone holding the stored
evidence can confirm, offline and without trusting Heightproof, which address answered which
request and when.

## What a signature does and does not prove

An Airnode signs `keccak256(requestHash ‖ timestamp ‖ body)` with EIP-191
([spec](https://airnodehub-docs.api3.org/airnode/attestation)). Heightproof checks two things:

| Check            | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `signatureValid` | The signature recovers to the Airnode's address over the exact body received. |
| `requestBound`   | The signed request hash is the one *this* request derives, so the answer cannot be a replay of another request's. |

**A signature is attribution, not truth.** An Airnode can be stale like any other endpoint.
Heightproof compares its answer like any other peer and never treats it as the correct one; a
signature changes no detector weight. What it adds is evidence: the D2 incident names the signer,
and the signed body is kept so the finding can be re-verified later.

## Trust boundary

The SDK checks every attestation as it arrives, but the SDK runs in your application, so the
worker checks again before anything is stored or compared. It re-recovers the signer from the
kept body and confirms that body holds the very result whose hash was compared. A signed answer
to some other question cannot vouch for this one. An attestation over a body larger than 64 KiB
is kept without the body and is not credited, because there is nothing left to re-check.

## Setup

AirnodeHub's dRPC listing covers the standard EVM reads on 100+ chains. Its reads cost $0.01 per
call, paid with [x402](https://x402.org) in aUSD, API3's test dollar on Base Sepolia, while
AirnodeHub is in early access. Heightproof does not handle payment itself. You pass the endpoint
a `fetch` that pays:

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { airnodeDrpcEndpoint, heightproofTransport } from "@heightproof/web3";

// A wallet used only to pay for verification calls. Fund it from
// https://airnodehub.api3.org/faucet (minting needs a little Base Sepolia ETH for gas).
const payer = privateKeyToAccount(process.env.AIRNODE_PAYER_KEY as `0x${string}`);
const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(payer) }]
});

const transport = heightproofTransport({
  projectId: "my-project",
  apiKey: process.env.HEIGHTPROOF_API_KEY!,
  endpoint: "https://heightproof.internal",
  rpcUrl: process.env.EVM_RPC_URL!,
  chainId: 8453,
  provider: "alchemy",
  verify: {
    endpoints: [
      { rpcUrl: process.env.SECOND_RPC_URL!, provider: "infura" },
      // dRPC network slug, not a chain ID.
      airnodeDrpcEndpoint({ network: "base", fetchImpl: payingFetch })
    ],
    sampleRate: 0.01,
    maxCallsPerMinute: 30
  }
});
```

`maxCallsPerMinute` caps the spend: with the Airnode as one of three endpoints, a ceiling of 30
is at most 10 paid calls a minute. An unpaid or refused call (`402`) is recorded as a failed
observation and never compared.

## Where it shows up

- **Incidents:** a D2 reason ends with `Airnode-signed evidence from 0x… can be verified independently`.
- **Request explorer:** a verified answer shows its signer as *Airnode Signer (verified)*.
- **Postgres:** `api_events.evm_attestation` holds the full attestation, including `signedBody`.
  `evm_attested_by` holds the signer, and is set only when the worker's re-check passed.

To re-verify stored evidence yourself, take `signer`, `requestHash`, `timestamp`, `signature` and
`signedBody` from `evm_attestation` and run the check from the
[attestation spec](https://airnodehub-docs.api3.org/airnode/attestation#verifying-a-response), or
call `checkAirnodeAttestation` from `@heightproof/shared`.
