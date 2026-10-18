#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 server for WEGO. Run as root:
#   sh setup-server.sh "<public key of the GitHub deploy key>"
set -eu

DEPLOY_KEY="${1:?usage: sh setup-server.sh \"ssh-ed25519 AAAA... github-deploy\"}"

# Docker Engine with the compose plugin
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# User the GitHub workflow signs in as. Membership in the docker group is enough to deploy.
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_KEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# Application folder: compose.yaml, Caddyfile, .env and the nightly database dumps
install -d -m 750 -o deploy -g deploy /opt/wego /opt/wego/backups

# Sign in with SSH keys only
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh

# Security updates are installed automatically (default on Ubuntu, made sure here)
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Done. Now create /opt/wego/.env from deploy/.env.example (as user deploy)."
