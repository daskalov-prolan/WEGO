# Production on a Hetzner server

The application runs as one Docker image (API plus React build) next to PostgreSQL 17 and Caddy, which fetches
the HTTPS certificate from Let's Encrypt. The GitHub workflow **Deploy** runs only when started by hand. It tests,
builds the image `ghcr.io/daskalov-prolan/wego`, copies `compose.yaml` and `Caddyfile` to the server and starts
the new version.

| File | Purpose |
|---|---|
| `compose.yaml` | Services app, db, caddy and backup on the server in `/opt/wego` |
| `Caddyfile` | HTTPS and reverse proxy to the app |
| `.env.example` | Template for `/opt/wego/.env` with domain and passwords |
| `setup-server.sh` | One-time setup: Docker, user `deploy`, folders, SSH keys only |
| `../.github/workflows/deploy.yml` | The deploy pipeline |

## One-time setup

### 1. Server at Hetzner

In the Hetzner Cloud Console create a server:

- Image **Ubuntu 24.04**, location **Nuremberg** or **Falkenstein** (data stays in Germany).
- Type: the smallest **x86** shared vCPU type (CX line). Not ARM (CAX): the image is built for amd64 only.
- Add your own SSH key, enable **Backups** (daily snapshot of the whole disk).
- Firewall: allow inbound TCP 22, 80, 443 and UDP 443, nothing else.
  Use the Hetzner firewall, not `ufw`: Docker bypasses `ufw` for published ports.

### 2. DNS

Create an `A` record for the domain, e.g. `wego.prolan.de`, pointing to the IPv4 address of the server
(and an `AAAA` record for the IPv6 address). Caddy can only get the certificate once this resolves.

### 3. Deploy key and server setup

On your PC (Git Bash or PowerShell):

```
ssh-keygen -t ed25519 -f wego-deploy -N "" -C github-deploy
scp deploy/setup-server.sh root@<server-ip>:
ssh root@<server-ip> "sh setup-server.sh '$(cat wego-deploy.pub)'"
```

### 4. Configuration on the server

```
ssh root@<server-ip>
cd /opt/wego
nano .env          # content from deploy/.env.example
chown deploy:deploy .env && chmod 600 .env
```

Fill in `WEGO_DOMAIN`, a database password from `openssl rand -hex 32` and a first planner password.
Write the database password down in your password manager: the nightly dumps need it for a restore.

### 5. GitHub

In the repository under **Settings > Environments** create the environment `production` and add yourself
under **Required reviewers**: every deploy then waits for your approval. With the GitHub CLI:

```
gh secret set DEPLOY_HOST --env production --body "<server-ip>"
gh secret set DEPLOY_SSH_KEY --env production < wego-deploy
ssh-keyscan -t ed25519 <server-ip> | gh secret set DEPLOY_KNOWN_HOSTS --env production
gh variable set WEGO_DOMAIN --env production --body "wego.prolan.de"
```

Then delete the private key file `wego-deploy` from your PC; it now exists only as a GitHub secret.

### 6. First deploy

**Actions > Deploy > Run workflow**, branch `main`, approve the deployment. Open `https://<domain>` and sign in
with the planner from `.env`. Change the password, then remove `SEED_PLANER_USERNAME` and `SEED_PLANER_PASSWORD`
from `.env`. They are used only as long as no account exists.

## Daily operation

- **Deploy:** Actions > Deploy > Run workflow, pick the branch. Tests run first; the server is only touched if they pass.
- **Roll back:** open an earlier successful run of Deploy and use **Re-run all jobs**. It deploys that run's commit again.
  Database migrations are not rolled back, so only roll back across versions without a new migration.
- **Logs:** `ssh root@<server-ip>`, then `cd /opt/wego && docker compose logs -f app`.
- **Backups:** every night a dump goes to `/opt/wego/backups`, kept for 14 days, plus the Hetzner disk backups.
  For a copy outside the server, fetch it now and then with `scp root@<server-ip>:/opt/wego/backups/*.dump .`
- **Restore a dump:**

  ```
  cd /opt/wego
  docker compose stop app
  docker compose exec -T db pg_restore -U wego -d wego --clean --if-exists < backups/wego-<date>.dump
  docker compose start app
  ```

- **Updates:** Ubuntu installs security updates by itself. PostgreSQL and Caddy images are pulled again with every deploy.
  Reboot now and then when `/var/run/reboot-required` exists; all containers come back by themselves.
