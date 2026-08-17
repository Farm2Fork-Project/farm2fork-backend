FROM node:24.16.0-alpine3.23 AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=farm2fork-corepack,target=/root/.cache/node/corepack \
    --mount=type=cache,id=farm2fork-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN rm -f tsconfig.build.tsbuildinfo && pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=farm2fork-corepack,target=/root/.cache/node/corepack \
    --mount=type=cache,id=farm2fork-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM deps AS development
COPY . .
EXPOSE 3000
CMD ["pnpm", "start:dev"]

FROM node:24.16.0-alpine3.23 AS production
WORKDIR /app
RUN corepack enable
RUN addgroup -S farm2fork && adduser -S farm2fork -G farm2fork

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER farm2fork

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main"]
