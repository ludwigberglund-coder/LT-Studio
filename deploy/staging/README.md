# Staging deployment assets

These files are safe templates for the private LT Studio staging server.

They intentionally contain no real hostname, customer identity, password, MFA secret, R2 credential or other runtime secret.

## Files

- `staging.env.example` – public environment-variable template. Copy it to `/etc/lt-studio/staging.env` on the server and replace placeholders only there.
- `lt-studio-staging.service` – hardened systemd service for the Node.js API.
- `Caddyfile.example` – same-origin HTTPS reverse proxy template.

The full sequence is documented in `docs/STAGING-DEPLOYMENT.md`.

## Server installation outline

Create a dedicated Linux user and runtime directories:

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin ltstudio
sudo install -d -o ltstudio -g ltstudio -m 700 /srv/lt-studio-data
sudo install -d -o ltstudio -g ltstudio -m 700 /srv/lt-studio-backups
sudo install -d -o ltstudio -g ltstudio -m 700 /srv/lt-studio-restore
sudo install -d -o ltstudio -g ltstudio -m 700 /srv/lt-studio-ops
sudo install -d -o root -g ltstudio -m 750 /etc/lt-studio
```

Deploy the reviewed repository checkout to `/opt/lt-studio/current`.

Copy the environment template outside Git and restrict it:

```bash
sudo cp deploy/staging/staging.env.example /etc/lt-studio/staging.env
sudo chown root:ltstudio /etc/lt-studio/staging.env
sudo chmod 600 /etc/lt-studio/staging.env
```

Fill the placeholders on the server or through the hosting provider's secret store. Never commit the filled file.

Install the systemd unit:

```bash
sudo cp deploy/staging/lt-studio-staging.service /etc/systemd/system/lt-studio-staging.service
sudo systemctl daemon-reload
```

Configure Caddy with a private staging hostname by replacing `<STAGING_HOST>` in `Caddyfile.example`. Do not commit the real hostname if it is intended to remain private.

Before starting the service, run the staging preflight and create the database only with the synthetic bootstrap described in `docs/STAGING-DEPLOYMENT.md`.

## Important

Do not weaken systemd hardening just to make startup succeed. If the service needs a new writable path, document the reason and add only that specific path to `ReadWritePaths`.

Do not point the service at a pilot or production database, backup directory or secret file.
