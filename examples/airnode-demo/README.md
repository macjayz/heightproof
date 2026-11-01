# Airnode demo: catching wrong data with signed proof

## The problem

Ada runs a DeFi app on Base. One evening users report deposits that are not showing, while
others see the right balance. Her logs show nothing: every RPC call returned HTTP 200, and her
monitoring is green.

One of her provider's nodes is serving stale data. It answers successfully, just with the wrong
block, and nothing that watches status codes and latency can see that. Without a second opinion,
she cannot tell whether the fault is her code, the chain or the provider, and the provider can
always say it is on her side.

## What this demo does

1. Starts **your-provider**, a local stand-in for that node. It proxies Base mainnet, but answers
   every block request with the block from 40 blocks earlier, always with HTTP 200.
2. Makes a real, paid call through [AirnodeHub](https://airnodehub.api3.org)'s dRPC listing. Its
   answer is signed by the Airnode, and Heightproof checks that the signature is valid and bound
   to the exact request it sent.
3. Asks both the same question at the same pinned height and runs detector D2 on the result.

```
Asking both providers for Base block 53366354...

  your-provider  HTTP 200  269ms  result 144aef43c1f5fbd971…
  airnode-drpc   HTTP 200  2233ms  result 54bd736f3a74339318…
                 signed by 0x511AcE8648D2f64260d50D036F8f8ce622d92137
                 signature valid: true, bound to this request: true

🔴 D2 provider_disagreement (weight 40)
   eth_getBlockByNumber at block 53366354 returned a different result than airnode-drpc; at equal
   height this is a provider bug or an unpropagated reorg. Airnode-signed evidence from
   0x511AcE8648D2f64260d50D036F8f8ce622d92137 can be verified independently
```

The broken provider is simulated; the AirnodeHub call, its payment and its signature are real.
Ada now knows the provider is at fault, and has evidence the provider cannot dispute.

## Run it

You need a Base Sepolia key holding aUSD, AirnodeHub's test token. Each call costs $0.01.

1. Get a little Base Sepolia ETH for gas from the
   [Coinbase faucet](https://portal.cdp.coinbase.com/products/faucet).
2. Mint aUSD at [airnodehub.api3.org/faucet](https://airnodehub.api3.org/faucet), or call
   `mintFromFaucet(uint256)` on `0xbeA34973e5f67F18F656A2C6070C64326C791808` yourself.
3. From the repository root:

```bash
npm install
AIRNODE_PAYER_KEY=0x... npm run demo -w examples/airnode-demo
```

Use a throwaway key: it only ever needs testnet funds. `BASE_RPC_URL` overrides the upstream the
fake provider proxies, which defaults to `https://mainnet.base.org`.

## With the dashboard

`demo.ts` runs the comparison in-process. `dashboard.ts` runs the same story through a real
Heightproof stack, the way Ada would: her app makes an ordinary call through
`@heightproof/web3`, gets an answer that looks fine, and Heightproof re-checks it in the
background. The worker re-verifies the Airnode signature, raises the D2 incident, and the
dashboard shows it, with the Airnode signer on the AirnodeHub observation in the Request
Explorer.

```bash
docker compose up --build -d
AIRNODE_PAYER_KEY=0x... npm run dashboard -w examples/airnode-demo
```

Each run signs up a fresh workspace and prints its sign-in for the dashboard at
`http://localhost:5173`. `HEIGHTPROOF_ENDPOINT` and `HEIGHTPROOF_DASHBOARD_URL` point it at a
stack on other ports.

How signed verification works, and what a signature does and does not prove:
[docs/airnode.md](../../docs/airnode.md).
