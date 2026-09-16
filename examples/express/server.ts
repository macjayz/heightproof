import bodyParser from "body-parser";
import express from "express";
import { heightproofErrorHandler, heightproofExpress } from "@heightproof/sdk-node";

const app = express();
const users: Array<{ id: string; email: string }> = [{ id: "1", email: "demo@heightproof.local" }];

app.use(bodyParser.json());
app.use(
  heightproofExpress({
    projectId: "demo",
    apiKey: process.env.HEIGHTPROOF_API_KEY ?? "dev-heightproof-key",
    endpoint: process.env.HEIGHTPROOF_ENDPOINT ?? "http://localhost:8080",
    serviceName: "example-api",
    redaction: {
      fields: ["cardNumber", "walletPrivateKey"]
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/graphql", (req, res) => {
  res.json({ data: { operationName: req.body.operationName ?? "anonymous" } });
});

app.post("/rpc", (req, res) => {
  if (req.body.method === "eth_sendRawTransaction") {
    return res.status(401).json({ error: "signature rejected" });
  }

  res.json({ jsonrpc: "2.0", id: req.body.id, result: "0x1" });
});

app.get("/api/users/:id", (req, res, next) => {
  try {
    const user = users.find((entry) => entry.id === req.params.id);
    res.json({ email: user.email });
  } catch (error) {
    next(error);
  }
});

// heightproofErrorHandler must be registered after all routes, following Express's
// error-handling middleware convention, so it can capture whatever they throw.
app.use(heightproofErrorHandler());

app.listen(4000, () => {
  console.log("Example API listening on http://localhost:4000");
});
