import { createHeightproofRpcClient } from "@heightproof/web3";

const client = createHeightproofRpcClient({
  projectId: process.env.HEIGHTPROOF_PROJECT_ID ?? "demo",
  apiKey: process.env.HEIGHTPROOF_API_KEY ?? "dev-heightproof-key",
  endpoint: process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080",
  rpcUrl: process.env.EVM_RPC_URL ?? "https://ethereum.publicnode.com",
  serviceName: "web3-rpc-example",
  chainId: 1,
  provider: "publicnode"
});

const blockNumber = await client.request({ method: "eth_blockNumber", params: [] });
console.log({ blockNumber });
