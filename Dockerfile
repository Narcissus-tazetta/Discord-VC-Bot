FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./tsconfig.json
RUN mkdir -p /app/data

CMD ["bun", "run", "start"]
