import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

export const UPSTREAM = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const STALE_BY = 40;
const AUSD = "0xbeA34973e5f67F18F656A2C6070C64326C791808";

/** Fetch that pays AirnodeHub's $0.01 per call in aUSD, capped at 1 aUSD per payment. */
export function payingFetch(): typeof fetch {
  const payerKey = process.env.AIRNODE_PAYER_KEY as `0x${string}` | undefined;
  if (!payerKey) {
    console.error("Set AIRNODE_PAYER_KEY to a Base Sepolia key holding aUSD. See README.md.");
    process.exit(1);
  }

  const payments = new x402Client().setSpendControls({
    allowedAssets: [{ network: "eip155:84532", asset: AUSD, maxAmountPerPayment: "1000000" }]
  });
  registerExactEvmScheme(payments, { signer: privateKeyToAccount(payerKey) });
  return wrapFetchWithPayment(fetch, payments);
}

/**
 * The misbehaving provider: proxies Base mainnet, but answers every block request with the
 * block from 40 blocks earlier. Everything it returns is a genuine mainnet answer, always with
 * HTTP 200, just not for the block asked.
 */
export async function startStaleProvider() {
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      const call = JSON.parse(raw) as { id?: unknown; method: string; params: unknown[] };
      if (call.method === "eth_getBlockByNumber" && call.params[0] !== "latest") {
        const asked = call.params[0];
        if (typeof asked === "string") {
          call.params[0] = `0x${(Number.parseInt(asked, 16) - STALE_BY).toString(16)}`;
        }
      }
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call })
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(await upstream.text());
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
