FROM node:24.16.0-alpine3.23 AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS development
COPY . .
EXPOSE 3000
CMD ["pnpm", "start:dev"]

FROM base AS build
COPY . .
RUN pnpm build

FROM node:24.16.0-alpine3.23 AS production
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
