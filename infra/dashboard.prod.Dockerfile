# Production dashboard image: static Vite build served by unprivileged nginx, which also proxies
# the API on the same origin. infra/dashboard.Dockerfile remains the dev-server image for compose.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
RUN npm install
# Empty means "same origin": the dashboard calls /v1, /ready and /live on whatever host serves it.
ENV VITE_HEIGHTPROOF_API_URL=""
RUN npm run build -w apps/dashboard

FROM nginxinc/nginx-unprivileged:1.27-alpine
# Upstream the proxy forwards to; the Helm chart points it at the API Service.
ENV API_UPSTREAM=http://api:8080
COPY infra/nginx/dashboard.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 8080
