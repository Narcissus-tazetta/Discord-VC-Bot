FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT:-8000}/health" > /dev/null || exit 1

CMD ["bun", "run", "start"]
