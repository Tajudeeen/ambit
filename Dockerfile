FROM node:20-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM dependencies AS build-web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL"
RUN pnpm --filter @ambit/web build

FROM dependencies AS build-api
RUN pnpm --filter @ambit/db db:generate
RUN pnpm --filter @ambit/api typecheck

FROM dependencies AS build-indexer
RUN pnpm --filter @ambit/indexer typecheck

FROM build-api AS api
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@ambit/api", "start"]

FROM build-indexer AS indexer
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@ambit/indexer", "start"]

FROM node:20-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build-web /workspace/apps/web/.next/standalone ./
COPY --from=build-web /workspace/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
