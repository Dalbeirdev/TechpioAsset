# TechpioAsset Web (Next.js 15) — production image.
#
# Built from the monorepo root as context (see docker-compose.prod.yml).
#
# NEXT_PUBLIC_API_URL is a BUILD-TIME value: Next.js inlines NEXT_PUBLIC_* vars
# into the client bundle during `next build`, so it must be supplied as a build
# arg (the public site origin), not just at runtime.
FROM node:20-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Build the web app and its workspace deps (contracts, domain, ui-tokens) in
# dependency order.
RUN pnpm exec turbo run build --filter=@techpioasset/web

WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "exec", "next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
