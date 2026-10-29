# Collector for the RPC reliability study (docker compose --profile study up -d).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY scripts ./scripts
RUN npm install \
  && npm run build -w packages/shared -w packages/sdk-node -w packages/web3 \
  && mkdir -p /data && chown node:node /data
USER node
CMD ["npx", "tsx", "scripts/study/collect.ts"]
