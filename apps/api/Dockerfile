# TechpioAsset API (NestJS + Prisma) — production image.
#
# Built from the monorepo root as context (see docker-compose.prod.yml):
#   docker build -f apps/api/Dockerfile -t techpioasset-api .
#
# The whole workspace is installed and built so pnpm's workspace links and the
# Prisma client resolve exactly as they do in development. Turbo builds the
# api together with its workspace dependencies (domain, contracts) in the
# correct order.
FROM node:20-bookworm-slim

# openssl is required by Prisma's query engine at runtime; the build toolchain
# lets native deps (@node-rs/argon2, @swc/core) compile if a prebuilt binary is
# unavailable for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# Copy the whole workspace (the .dockerignore keeps node_modules/build output out).
COPY . .

# Install every workspace's dependencies from the frozen lockfile.
RUN pnpm install --frozen-lockfile

# Generate the Prisma client before compiling (tsc needs its generated types),
# then build the api and its workspace deps in dependency order via turbo.
RUN pnpm --filter @techpioasset/api exec prisma generate
RUN pnpm exec turbo run build --filter=@techpioasset/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001

# Apply any pending migrations, then start the API. `migrate deploy` is safe to
# run on every boot: it only applies migrations not yet recorded in the DB.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
