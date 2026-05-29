# SmartProp — Local Setup Guide

Two terminals. ~10 minutes from zip to running app.

---

## What you need first

| Tool | Version | Download |
|------|---------|----------|
| Node.js | **v18 or v20** (LTS) | https://nodejs.org — pick the LTS installer |
| PostgreSQL | v14+ | https://www.postgresql.org/download or use free cloud (see below) |
| A terminal | Any | Terminal on Mac, PowerShell or WSL2 on Windows |

Check you have the right Node version:
```bash
node -v   # should print v18.x.x or v20.x.x
npm -v    # should print 9.x or 10.x
```

---

## Step 1 — Extract the project

```bash
unzip smartprop_full_ui.zip
cd smartprop_patched
```

---

## Step 2 — Get a PostgreSQL database

You need a PostgreSQL connection string that looks like:
```
postgresql://username:password@host:5432/database_name
```

**Option A — Free cloud (easiest, takes 2 minutes)**
1. Go to **https://neon.tech** and create a free account
2. Click "Create project" → give it a name → click Create
3. Copy the connection string shown on screen — it looks like:
   `postgresql://neondb_owner:abc123@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require`

**Option B — Local PostgreSQL**

On Mac:
```bash
brew install postgresql@16
brew services start postgresql@16
createdb smartprop
# Your connection string: postgresql://postgres@localhost:5432/smartprop
```

On Ubuntu/Debian:
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres createdb smartprop
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'yourpassword';"
# Your connection string: postgresql://postgres:yourpassword@localhost:5432/smartprop
```

On Windows:
1. Download the installer from https://www.postgresql.org/download/windows
2. Install with default settings, set a password when prompted
3. Open pgAdmin or psql and create a database called `smartprop`
4. Connection string: `postgresql://postgres:yourpassword@localhost:5432/smartprop`

---

## Step 3 — Configure environment variables

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in these three required values:

```env
# Your PostgreSQL connection string from Step 2
DATABASE_URL=postgresql://username:password@host:5432/database_name

# Two different random secrets for JWT tokens
# Generate them by running this command:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=paste_a_long_random_string_here
JWT_REFRESH_SECRET=paste_a_different_long_random_string_here
```

Generate the secrets quickly:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Run this twice — paste first output as JWT_SECRET, second as JWT_REFRESH_SECRET
```

Everything else in `.env` is optional for local development.

---

## Step 4 — Install dependencies

This project has **two separate** `package.json` files — one for the server (root) and one for the frontend (`client/`). Both must be installed.

```bash
# Option A — one command (recommended)
npm run setup

# Option B — manually (if setup fails)
npm install
cd client
npm install
cd ..
```

This takes 2–5 minutes depending on your internet connection. You will see a lot of output — that is normal.

> **Windows note:** If you see `cd : not recognised`, run the two installs separately as shown in Option B.

---

## Step 5 — Push the database schema

This creates all the tables in your PostgreSQL database:

```bash
npm run db:push
```

You should see output like:
```
[✓] Changes applied
```

If you see a connection error, double-check your `DATABASE_URL` in `.env`.

---

## Step 6 — Start the app

Open **two terminals**, both in the project root folder:

**Terminal 1 — Backend API server:**
```bash
npm run dev:server
```
You should see:
```
Server running on port 5000
WebSocket server initialised
```

**Terminal 2 — Frontend (Vite dev server):**
```bash
npm run client:dev
```
You should see:
```
  VITE v5.x.x  ready in 1234 ms
  ➜  Local:   http://localhost:5173/
```

---

## Step 7 — Open the app

Go to **http://localhost:5173** in your browser.

Click **Sign up**, create your account, and you're in.

---

## One-command start (shortcut)

If you'd rather start both servers at once in a single terminal:
```bash
npm run dev
```
This uses `concurrently` to run both the API server and Vite together. Logs from both appear in the same terminal, colour-coded.

---

## Common problems

**"Cannot connect to database" on startup**
- Check `DATABASE_URL` in `.env` — no spaces, no quotes around the value
- If using Neon, make sure you copied the full string including `?sslmode=require`
- If local PostgreSQL, make sure the service is running (`brew services list` on Mac)

**"Port 5000 already in use"**
```bash
# Mac / Linux
lsof -ti:5000 | xargs kill -9
# Windows PowerShell
netstat -ano | findstr :5000   # find the PID
taskkill /PID <pid> /F
```
Or change the port in `.env`: `PORT=5001`

**"Module not found" or dependency errors**
```bash
# Nuke and reinstall
rm -rf node_modules client/node_modules
npm install
npm install --prefix client
```

**White screen at http://localhost:5173**
- Make sure the backend is also running (Terminal 1)
- Check the browser console for errors (F12 → Console)
- The frontend proxies all `/api` requests to port 5000 — if the server is not running, all data loads will fail silently

**"FATAL: Missing required environment variable: JWT_SECRET"**
- You haven't filled in `.env` yet — go back to Step 3

**Windows path issues**
- Use WSL2 (Windows Subsystem for Linux) for the best experience
- If using PowerShell, replace `npm run dev:server` with `npx tsx watch server/index.ts`

---

## Useful commands

```bash
npm run db:studio       # Open Drizzle Studio — visual database browser at localhost:4983
npm run db:push         # Push schema changes to database (run after editing shared/schema.ts)
npm run typecheck       # Run TypeScript type checking
npm run test            # Run the test suite
npm run build           # Build the frontend for production
```

---

## Project structure (quick reference)

```
smartprop_patched/
├── server/             ← Express API (TypeScript)
│   ├── index.ts        ← Server entry point
│   ├── routes/         ← All API route files
│   ├── services/       ← M-Pesa, eTIMS, email, etc.
│   └── middleware/     ← Auth, audit log, etc.
├── client/             ← React frontend (TypeScript + Vite)
│   └── src/
│       ├── pages/      ← All page components (79 files)
│       ├── components/ ← Shared UI components
│       └── lib/        ← Helpers, query client
├── shared/
│   └── schema.ts       ← Drizzle database schema (single source of truth)
├── migrations/         ← SQL migration files
├── .env                ← Your local config (never commit this)
├── .env.example        ← Template with all available options
└── QUICKSTART.md       ← This file
```

---

## Need the mobile app?

The React Native mobile app lives in `mobile-apps/`. It requires Expo or a full React Native environment. For most purposes, the web app at http://localhost:5173 covers everything including a mobile-responsive layout.

To run the mobile app separately, see `mobile-apps/README.md`.
