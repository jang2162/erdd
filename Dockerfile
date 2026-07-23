FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @erdd/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["apps/server/node_modules/.bin/tsx", "apps/server/src/main.ts"]
