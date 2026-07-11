FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install
COPY . .
RUN bun run build

FROM oven/bun:alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src/entry.server.ts ./src/entry.server.ts

CMD ["bun", "src/entry.server.ts"]
