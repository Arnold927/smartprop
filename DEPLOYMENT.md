# SmartProp — Deployment Guide

## Prerequisites

- Node.js 20+
- A PostgreSQL database (recommend [Neon](https://neon.tech) for serverless Postgres)
- Optional: [Resend](https://resend.com) account for email

---

## 1. Environment Setup

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

### Required variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Long random string for signing access tokens |
| `JWT_REFRESH_SECRET` | Different long random string for refresh tokens |

Generate secure secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Optional variables

| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | Comma-separated frontend origins (default: `http://localhost:5173`) |
| `APP_URL` | Public URL (used in password reset emails) |
| `RESEND_API_KEY` | For sending emails (invite, password reset) |
| `FROM_EMAIL` | Sender address (e.g. `SmartProp <noreply@yourdomain.com>`) |
| `MPESA_*` | M-PESA integration credentials |
| `PORT` | Server port (default: `5000`) |

---

## 2. Database Setup

Push the schema to your database:

```bash
npm run db:push
```

---

## 3. Running in Development

```bash
# Install all dependencies
npm install
npm install --prefix client

# Start backend (port 5000) + Vite dev server (port 5173, proxies /api to 5000)
npm run dev          # backend
npm run client:dev   # frontend (separate terminal)
```

The app will be available at `http://localhost:5173`.

---

## 4. Building for Production

```bash
# Build the React frontend into dist/public/
npm run build:client

# Start the production server (serves frontend + API on one port)
npm start
```

The server will serve both the API and the built frontend from port `5000`.

---

## 5. Docker Deployment (Recommended)

### Build and run with Docker Compose

```bash
# Create your .env file first
cp .env.example .env
# Edit .env with your values

# Build and start
docker compose up -d

# View logs
docker compose logs -f app
```

### Manual Docker build

```bash
docker build -t smartprop .
docker run -d \
  --name smartprop \
  -p 5000:5000 \
  --env-file .env \
  -v smartprop_uploads:/app/uploads \
  smartprop
```

---

## 6. Deploying to a VPS (Ubuntu/Debian)

```bash
# 1. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone your repo
git clone https://github.com/your-org/smartprop.git
cd smartprop

# 3. Install dependencies
npm install
npm install --prefix client

# 4. Configure environment
cp .env.example .env
nano .env   # fill in your values

# 5. Push database schema
npm run db:push

# 6. Build frontend
npm run build:client

# 7. Install PM2 process manager
sudo npm install -g pm2

# 8. Start with PM2
pm2 start "npm start" --name smartprop
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

### Nginx reverse proxy (optional, for custom domain + HTTPS)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then get an SSL certificate:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 7. Deploying to Railway / Render / Fly.io

These platforms detect Node.js apps automatically.

**Key settings:**
- Build command: `npm install && npm install --prefix client && npm run build:client`
- Start command: `npm start`
- Environment: set all variables from `.env.example`
- Port: `5000` (or use `PORT` env var)

**⚠️  File Uploads on ephemeral platforms:** Railway, Render, and Fly.io containers lose their local filesystem on every restart.  You **must** configure S3/R2 storage (see §9) before going live — lease documents and maintenance photos are legally significant and cannot be recovered from a restarted container.

---

## 8. First Login

After deploying, create your first account:

1. Go to `https://yourdomain.com/auth`
2. Click **Sign Up**
3. Fill in your name, email, password, and organization name
4. You'll be logged in as the organization admin

---

## 9. File Uploads — Cloud Storage Setup (Required in Production)

SmartProp's upload middleware (`server/middleware/s3Upload.ts`) streams all files
directly to S3-compatible object storage when the `S3_*` environment variables are
set, and falls back to `./uploads` on disk for local development.

**Why this matters:** Lease documents, maintenance photos, and expense receipts are
legally significant records.  On multi-instance or ephemeral deployments (Railway,
Render, Docker Swarm) the local `./uploads` directory is lost on every restart.
Cloud storage is mandatory for production.

### Option A — Cloudflare R2 (recommended: no egress fees)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2 Object Storage**
2. Create a bucket (e.g. `smartprop-uploads`)
3. **Settings → R2 API Tokens** → Create token with *Edit* permissions on the bucket
4. Set these env vars:

```env
S3_ACCESS_KEY_ID=<R2 Access Key ID>
S3_SECRET_ACCESS_KEY=<R2 Secret Access Key>
S3_BUCKET=smartprop-uploads
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

### Option B — AWS S3

1. Create an S3 bucket in your preferred region
2. Create an IAM user with `s3:PutObject` / `s3:GetObject` / `s3:DeleteObject` on that bucket
3. Set these env vars:

```env
S3_ACCESS_KEY_ID=AKIAxxxxxxxxxxxxxxxx
S3_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
S3_BUCKET=smartprop-uploads
S3_REGION=us-east-1
# S3_ENDPOINT is not needed for AWS S3
```

### Verifying the configuration

On server startup you will see one of:

```
[s3Upload] Cloud storage enabled — bucket: smartprop-uploads region: auto endpoint: https://...
[s3Upload] Cloud storage not configured — using local disk storage   ← dev only
```

### Docker / Docker Compose

When cloud storage is configured you do **not** need a persistent volume for uploads.
Remove the `smartprop_uploads` volume from `docker-compose.yml` or keep it as a
harmless no-op for backward compatibility.

If you prefer to keep disk storage on a single-server Docker deployment, mount a
named volume instead of relying on the container filesystem:

```bash
docker run -d \
  --name smartprop \
  -p 5000:5000 \
  --env-file .env \
  -v smartprop_uploads:/app/uploads \
  smartprop
```

---

## 10. SMS Setup — Africa's Talking (Recommended for Kenya)

SmartProp uses SMS to reach guards, caretakers, and tenants who don't use WhatsApp. The SMS provider is selected automatically based on which env vars are set — Africa's Talking is preferred; Twilio is the fallback.

| Provider | Cost (Kenya) | Notes |
|---|---|---|
| Africa's Talking | ~KES 0.8/SMS | Dedicated Kenya shortcode, Safaricom/Airtel/Telkom native |
| Twilio | ~KES 5+/SMS | Global fallback, no Kenya shortcode |

### Setting up Africa's Talking

1. Create a free account at [africastalking.com](https://africastalking.com)
2. In the AT dashboard, go to **SMS → Shortcodes / Sender IDs** to register your sender name (e.g. `SMARTPROP`). This is optional — unregistered messages still deliver but show a generic number.
3. Copy your **API Key** and **Username** from the dashboard.
4. Set these env vars:

```env
AT_API_KEY=your_at_api_key_here
AT_USERNAME=your_at_username_here   # "sandbox" for testing
AT_SENDER_ID=SMARTPROP              # optional — your registered shortcode
```

On startup you will see:
```
[messaging] SMS provider: Africa's Talking (sender: SMARTPROP)
```

### Keeping Twilio as a global fallback

If you operate outside Kenya or want a fallback, set both providers. Africa's Talking is always tried first; Twilio is only used when AT env vars are absent.

```env
# AT (Kenya primary)
AT_API_KEY=...
AT_USERNAME=...

# Twilio (international fallback — not used when AT is configured)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

> **Cost note:** At 100 SMS/month AT saves roughly KES 420/month vs Twilio. At 1,000 SMS/month (e.g. rent reminders for a large estate) the saving is ~KES 4,200/month.


The server exposes `GET /api/health` which returns:
```json
{ "status": "ok", "timestamp": "2026-03-20T..." }
```

Use this with your load balancer or monitoring system.
