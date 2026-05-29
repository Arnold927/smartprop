# SmartProp — Setup & Deployment Guide

## Why the VS Code terminal was hanging

When you open VS Code and run `npm run dev`, it was hanging because:

1. **`node_modules` was missing** — dependencies were never installed. The
   terminal just sits waiting because `tsx` (the TypeScript runner) doesn't exist yet.
2. **Two separate `package.json` files** — the root one runs the server, the
   `client/` one runs the Vite frontend. You must install both.
3. **The `.env` file** may be missing `JWT_SECRET` or `DATABASE_URL`, causing the
   server to crash silently on startup.

---

## Quick Start (VS Code)

### Step 1 — Open the project correctly

Open the **root folder** (`smartprop_fixed/`) in VS Code, **not** a subfolder:

```
File → Open Folder → select "smartprop_fixed"
```

Then open the workspace file for best TypeScript support:

```
File → Open Workspace from File → smartprop.code-workspace
```

### Step 2 — Run the setup script (first time only)

Open a terminal in VS Code (`Ctrl+`` ` ``) and run:

```bash
bash setup.sh
```

This installs all dependencies and creates your `.env` file from the template.

### Step 3 — Configure your environment

Edit `.env` in the root folder. The required fields are:

```env
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
JWT_SECRET=<generate one — see below>
JWT_REFRESH_SECRET=<generate another one>
```

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Step 4 — Push the database schema

```bash
npm run db:push
```

This creates all the tables in your PostgreSQL database.

### Step 5 — Start the app

```bash
npm run dev
```

This starts **both servers at the same time**:
- API server → `http://localhost:5000`
- Frontend (Vite) → `http://localhost:5173`

**Open your browser at `http://localhost:5173`**

---

## How it works (architecture)

```
npm run dev
  ├─ npm run dev:server  →  tsx watch server/index.ts  (port 5000)
  └─ npm run dev:client  →  vite dev                   (port 5173)

Browser → localhost:5173 (Vite)
  └─ /api/* requests proxied → localhost:5000 (Express)
```

In **development**, Vite proxies all `/api/` requests to the Express server.
There is no CORS issue because Vite handles the proxy.

In **production**, Express serves the built frontend files directly from
`dist/public/` and handles all API routes itself — it's a single process.

---

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start both server + client for development |
| `npm run dev:server` | Start only the Express API server |
| `npm run dev:client` | Start only the Vite frontend |
| `npm run build` | Build frontend + type-check server |
| `npm run build:client` | Build frontend to `dist/public/` |
| `npm run start` | Run production server (after build) |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (database browser) |
| `npm run install:all` | Install root + client dependencies |

---

## Deployment

### Railway / Render / Fly.io (recommended)

Set these environment variables in the dashboard:

```
DATABASE_URL=postgresql://...
JWT_SECRET=<64-char hex string>
JWT_REFRESH_SECRET=<different 64-char hex string>
NODE_ENV=production
PORT=5000
APP_URL=https://your-app-domain.com
ALLOWED_ORIGINS=https://your-app-domain.com
```

Build command:
```
npm run install:all && npm run build
```

Start command:
```
npm run start
```

### VPS (Ubuntu/Debian)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and setup
git clone <repo> smartprop && cd smartprop
bash setup.sh         # install deps + create .env
nano .env             # fill in DATABASE_URL and JWT secrets
npm run db:push       # create tables
npm run build         # build the frontend

# Run with PM2
npm install -g pm2
pm2 start "npm run start" --name smartprop
pm2 save && pm2 startup
```

### Docker

```bash
docker-compose up -d
```

The `docker-compose.yml` already sets `NODE_ENV=production` and maps port 5000.
Set your real `DATABASE_URL` in `docker-compose.yml` or via a `.env` file.

### Nginx reverse proxy (for VPS)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Troubleshooting

### Terminal shows path endlessly / hangs on start

**Cause:** `node_modules` not installed.
**Fix:** Run `bash setup.sh` or `npm run install:all` first.

### `Cannot find module 'tsx'`

**Cause:** Root `node_modules` not installed.
**Fix:** Run `npm install` in the root folder.

### `tsx: command not found`

**Cause:** Same as above, or PATH issue.
**Fix:** `npm install` in root, then `npm run dev`.

### `Error: Frontend build not found`

**Cause:** Running `npm run start` (production mode) without building first.
**Fix:** Run `npm run build` before `npm run start`.

### `CORS error` in browser

**Cause:** `ALLOWED_ORIGINS` in `.env` doesn't include your frontend URL.
**Fix:** Add your domain: `ALLOWED_ORIGINS=https://your-domain.com`

### `401 Unauthorized` on all API calls

**Cause:** `JWT_SECRET` is empty or different between restarts.
**Fix:** Set a permanent `JWT_SECRET` in `.env` and restart.

### Database connection errors

**Cause:** `DATABASE_URL` is wrong or empty.
**Fix:** Check your Neon/Supabase/Postgres dashboard for the correct connection string.
The URL format is: `postgresql://user:password@host/database?sslmode=require`

### TypeScript errors in VS Code

**Cause:** VS Code is using its own TypeScript instead of the project's.
**Fix:** Open `smartprop.code-workspace` and press `Ctrl+Shift+P` →
`TypeScript: Select TypeScript Version` → `Use Workspace Version`.

