#!/usr/bin/env bash
# Builds the three images, loads them into a kind cluster, installs the chart and proves the
# ingest pipeline works end to end (API -> Redis stream -> worker -> Postgres).
# Usage: deploy/kind/e2e.sh [cluster-name]   (creates the cluster if it doesn't exist)
set -euo pipefail

cluster="${1:-heightproof}"
ns=heightproof
release=hp
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

if ! kind get clusters | grep -qx "$cluster"; then
  kind create cluster --name "$cluster" --wait 120s
fi
kubectl config use-context "kind-$cluster" >/dev/null

for component in api worker; do
  docker build -f infra/node.Dockerfile --build-arg WORKSPACE="apps/$component" \
    -t "heightproof.local/e2e-$component:e2e" .
done
docker build -f infra/dashboard.prod.Dockerfile -t heightproof.local/e2e-dashboard:e2e .

for component in api worker dashboard; do
  kind load docker-image --name "$cluster" "heightproof.local/e2e-$component:e2e"
done

helm upgrade --install "$release" deploy/helm/heightproof \
  --namespace "$ns" --create-namespace \
  -f deploy/kind/e2e-values.yaml \
  --wait --timeout 5m

helm test "$release" -n "$ns" --logs

echo "Waiting for the worker to persist seeded events..."
for _ in $(seq 1 30); do
  count=$(kubectl -n "$ns" exec "statefulset/$release-heightproof-postgresql" -- \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from api_events"')
  if [ "${count:-0}" -gt 0 ]; then
    echo "Pipeline OK: $count events persisted"
    kubectl -n "$ns" get pods -o wide
    exit 0
  fi
  sleep 2
done

echo "No events reached Postgres" >&2
kubectl -n "$ns" logs -l app.kubernetes.io/component=worker --tail=50 >&2 || true
exit 1
