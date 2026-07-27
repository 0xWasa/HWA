# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC values are intentionally compiled into the browser bundle. Never pass secrets here.
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_DATA_MODE=mainnet
ARG NEXT_PUBLIC_HYPEREVM_CHAIN_ID=999
ARG NEXT_PUBLIC_HYPEREVM_RPC_URL
ARG NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL=/api/rpc/logs
ARG NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE
ARG NEXT_PUBLIC_INDEXER_URL
ARG NEXT_PUBLIC_EXPLORER_URL=https://hyperevmscan.io
ARG NEXT_PUBLIC_DEPLOYMENT_MANIFEST_URL=/deployments/hyperevm-mainnet-999.json
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV \
    NEXT_PUBLIC_DATA_MODE=$NEXT_PUBLIC_DATA_MODE \
    NEXT_PUBLIC_HYPEREVM_CHAIN_ID=$NEXT_PUBLIC_HYPEREVM_CHAIN_ID \
    NEXT_PUBLIC_HYPEREVM_RPC_URL=$NEXT_PUBLIC_HYPEREVM_RPC_URL \
    NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL=$NEXT_PUBLIC_HYPEREVM_LOG_RPC_URL \
    NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE=$NEXT_PUBLIC_HYPEREVM_LOG_RPC_MAX_BLOCK_RANGE \
    NEXT_PUBLIC_INDEXER_URL=$NEXT_PUBLIC_INDEXER_URL \
    NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL \
    NEXT_PUBLIC_DEPLOYMENT_MANIFEST_URL=$NEXT_PUBLIC_DEPLOYMENT_MANIFEST_URL
RUN npm run build:standalone

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3900 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next-standalone/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next-standalone/static ./.next-standalone/static
USER nextjs
EXPOSE 3900
CMD ["node", "server.js"]
