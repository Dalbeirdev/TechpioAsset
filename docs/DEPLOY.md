# Deploying TechpioAsset to a VPS (piotask.com)

The whole stack — Next.js web, NestJS API, PostgreSQL, Redis — runs in Docker
containers on one VPS, behind a Caddy reverse proxy that terminates HTTPS
automatically.

```
piotask.com ──▶ Caddy (auto TLS)
                 ├── /api/*, /health/*  ──▶ api   (NestJS)
                 └── everything else     ──▶ web   (Next.js)
                              api ──▶ postgres + redis  (private containers)
```

## Requirements

- A VPS with **root/SSH** access (Ubuntu 22.04/24.04 recommended).
- **At least 2 GB RAM** for the build (4 GB comfortable). On a 1–2 GB box, add
  swap first (see step 5 note) or the Next.js/Nest build can be killed (OOM).
- Ports **80** and **443** open to the internet.
- The `piotask.com` DNS **A record** pointing at the VPS's public IP. (For `www`,
  add a second A record and see the note at the end.)

---

## 1. Point DNS at the server

In your domain's DNS, set an **A record**: `@` (piotask.com) → your VPS IP.
Wait for it to resolve before step 6 (Caddy needs it to issue the certificate):

```bash
dig +short piotask.com   # should print your VPS IP
```

## 2. Install Docker on the VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
docker --version && docker compose version
```

## 3. Get the code

```bash
git clone https://github.com/Dalbeirdev/TechpioAsset.git
cd TechpioAsset
```

## 4. Create the production environment file

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in every `CHANGE_ME`:

- `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY` — generate each:
  ```bash
  openssl rand -base64 48
  ```
- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` — your first login.

Leave `DOMAIN=piotask.com` / `PUBLIC_URL=https://piotask.com` as-is (change only
if the domain differs). Email stays off (`MAIL_PROVIDER=mock`) until you add SMTP.

## 5. Build and start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

> Low-RAM VPS: if the build is killed, add swap once and retry:
> ```bash
> sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
> ```

The API applies database migrations automatically on start. Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

## 6. Seed reference data + create your admin (first deploy only)

```bash
# Roles, permissions, categories, workflows (NODE_ENV=production skips demo users):
docker compose -f docker-compose.prod.yml exec api pnpm seed

# Create the single super-admin from SEED_ADMIN_* in .env.prod:
docker compose -f docker-compose.prod.yml exec api pnpm seed:admin
```

## 7. Verify

- Visit **https://piotask.com** — the login page loads over HTTPS.
- Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then change the password
  in the app.
- API health: `curl https://piotask.com/health/ready` → `ok`.

---

## Everyday operations

**Deploy new code:**
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# migrations run automatically on api start
```

**Logs / restart / stop:**
```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down          # stop (keeps data volumes)
```

**Back up the database:**
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U techpioasset techpioasset > backup-$(date +%F).sql
```

## Turning on email later

Edit `.env.prod`: set `MAIL_PROVIDER=smtp` and fill `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`. Then:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Turning on real AI extraction later

Edit `.env.prod`: `AI_PROVIDER=anthropic`, `AI_ENABLED=true`, `ANTHROPIC_API_KEY=...`,
then re-up. It stays inert (`mock`) until you do.

## Adding www

Add a `www.piotask.com` A record, then change the site line in `Caddyfile` to
`piotask.com, www.piotask.com {` and re-up. Caddy will issue a certificate for both.
