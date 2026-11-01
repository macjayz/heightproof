/**
 * Paying for priced RPC endpoints in the study: providers that sell JSON-RPC per call over x402
 * (USDC on Base). Spending is capped twice: x402 refuses any single payment above
 * MAX_PER_PAYMENT, and this wrapper stops paying for the rest of the UTC day once the daily
 * budget is spent.
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const BASE_MAINNET = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** $0.01 in USDC base units: no single study call should cost more. */
const MAX_PER_PAYMENT = "10000";

export type PaidBudget = {
  fetch: typeof fetch;
  /** True once today's budget cannot cover another call. */
  exhausted(): boolean;
  spentTodayUsd(): number;
};

export function createPaidBudget(options: {
  payerKey: `0x${string}`;
  paidUrls: string[];
  priceUsd: number;
  dailyBudgetUsd: number;
}): PaidBudget {
  const payments = new x402Client().setSpendControls({
    allowedAssets: [{ network: BASE_MAINNET, asset: BASE_USDC, maxAmountPerPayment: MAX_PER_PAYMENT }]
  });
  registerExactEvmScheme(payments, { signer: privateKeyToAccount(options.payerKey) });
  const paying = wrapFetchWithPayment(fetch, payments);
  const paidUrls = new Set(options.paidUrls);

  let day = utcDay();
  let spent = 0;
  const rollOver = () => {
    if (utcDay() !== day) {
      day = utcDay();
      spent = 0;
    }
  };
  const exhausted = () => {
    rollOver();
    return spent + options.priceUsd > options.dailyBudgetUsd;
  };

  const budgetFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!paidUrls.has(url)) return fetch(input, init);
    if (exhausted()) throw new Error("x402 daily budget reached");

    const response = await paying(input, init);
    // A settled payment comes back with a payment-response header; a successful answer
    // implies one too. Rejected payments (unfunded wallet, bad signature) cost nothing.
    const settled = response.headers.has("payment-response") || response.headers.has("x-payment-response");
    if (settled || response.ok) spent += options.priceUsd;
    return response;
  }) as typeof fetch;

  return { fetch: budgetFetch, exhausted, spentTodayUsd: () => (rollOver(), spent) };
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}
