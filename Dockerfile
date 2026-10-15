FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY ops/container/version.mjs ./version.mjs
ARG VCS_REF
RUN npm run build && VCS_REF="$VCS_REF" node version.mjs

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:782bb89768cc87b7f95c18b95baa1af250e5d451f26794f59363540161147c01
ARG VCS_REF
LABEL org.opencontainers.image.title="geometrydash-ui" \
      org.opencontainers.image.revision="$VCS_REF"
COPY --from=build /app/dist /usr/share/nginx/html
COPY ops/container/nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
