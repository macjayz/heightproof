# Heightproof Helm chart

Deploys the Heightproof API, worker and dashboard, with optional bundled Postgres and Redis.

```text
               Ingress (optional)
   /v1 /live /ready /health[/pipeline] │ /
                 ┌───────────────┴──────────────┐
                 ▼                              ▼
         api (Deployment) ◄──── proxy ──── dashboard (nginx, static build)
           │        │
           │        └─► Redis stream ──► worker (Deployment, N consumers)
           ▼                                   │
        Postgres ◄─────────────────────────────┘
```

## Install

```bash
helm install hp oci://ghcr.io/macjayz/charts/heightproof --version <version> \
  --namespace heightproof --create-namespace
kubectl -n heightproof port-forward svc/hp-heightproof-dashboard 8080:80
```

Without overrides the chart generates the ingestion API key, admin password and Postgres password
once, stores them in the release Secret, and reuses them on every upgrade. `helm install` prints
the commands that read them back.

## Production values

```yaml
auth:
  existingSecret: heightproof            # keys: heightproof-api-key, admin-password, database-url
postgresql:
  enabled: false                         # use a managed database
redis:
  enabled: false
externalRedis:
  url: redis://redis.internal:6379
api:
  replicaCount: 2
  podDisruptionBudget:
    enabled: true
worker:
  autoscaling:
    enabled: true
ingress:
  enabled: true
  className: nginx
  host: heightproof.example.com
  tls:
    - secretName: heightproof-tls
      hosts: [heightproof.example.com]
```

With `auth.existingSecret` the chart creates no Secret, so `database-url` must be in yours even
when the bundled Postgres is off.

## How it behaves

- **Migrations.** `infra/migrations` is mounted from a ConfigMap and applied by an init container
  on every API and worker pod. The SQL is idempotent and the run holds a Postgres advisory lock,
  so rolling several pods at once is safe. The first migration runs `create extension pgcrypto`,
  so the database user needs permission to create it (or create it beforehand).
- **Workers scale horizontally.** Each worker joins the Redis consumer group under its pod name.
  The app's default, `worker-<pid>`, is `worker-1` in every container, and replicas would collide.
- **The API is stateless except `/live`.** The WebSocket hub is in-process, so with several API
  replicas a dashboard only gets live pushes for events ingested by its own pod. Polled views are
  correct at any replica count. Fanning out over Redis pub/sub would remove this limitation.
- **Probes.** Liveness uses `/health`; readiness uses `/ready`, which answers 503 when the pod
  can't reach Postgres or Redis but ignores worker backlog, so a slow worker never takes ingestion
  down. Alert on `/health/pipeline` (503 when events stall or no worker heartbeat) and scrape
  `/metrics`; the API pods carry `prometheus.io/*` annotations.
- **Hardening.** All pods run as non-root with `RuntimeDefault` seccomp, no capabilities and no
  privilege escalation. The app containers also have a read-only root filesystem, and the service
  account token is not mounted.
- **Bundled Postgres and Redis** are single-pod StatefulSets with PVCs, for evaluation. They have
  no replication or backups.

## Verify

```bash
helm test hp -n heightproof     # API readiness, pipeline health, dashboard, and dashboard → API proxy
deploy/kind/e2e.sh              # full build + install + pipeline check on a local kind cluster
```
