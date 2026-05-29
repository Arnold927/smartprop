#!/usr/bin/env bash
# ============================================================
# SmartProp — One-Command Setup Script
# Run this once after cloning or extracting the project
# Usage: bash setup.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD}  SmartProp Setup${NC}"
echo -e "${BOLD}================================================${NC}"
echo ""

# ── 1. Check Node.js ─────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Download from https://nodejs.org (v18 or higher required)"
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  error "Node.js v18+ required. Current: $(node -v). Download from https://nodejs.org"
fi
success "Node.js $(node -v) detected"

# ── 2. Check npm ─────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  error "npm not found. It should come with Node.js."
fi
success "npm $(npm -v) detected"

# ── 3. Create .env if missing ────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env created from .env.example"
    warn "IMPORTANT: Edit .env and fill in your DATABASE_URL and JWT secrets before starting!"
  else
    error ".env.example not found — cannot create .env"
  fi
else
  success ".env already exists"
fi

# ── 4. Install root dependencies ─────────────────────────────
info "Installing server dependencies (root)..."
npm install --silent
success "Server dependencies installed"

# ── 5. Install client dependencies ───────────────────────────
info "Installing client dependencies..."
npm install --prefix client --silent
success "Client dependencies installed"

# ── 6. Check DATABASE_URL ────────────────────────────────────
echo ""
if grep -q "username:password" .env 2>/dev/null || grep -q "^DATABASE_URL=$" .env 2>/dev/null; then
  warn "DATABASE_URL in .env still has placeholder values."
  warn "Edit .env and set your real PostgreSQL connection string before running the app."
else
  success "DATABASE_URL appears to be set"
fi

# ── 7. Check JWT secrets ─────────────────────────────────────
if grep -q "your_very_long_random_secret_here" .env 2>/dev/null; then
  warn "JWT secrets in .env are still placeholders."
  warn "Run this to generate a real secret:"
  echo -e "  ${BOLD}node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"${NC}"
fi

# ── 8. Done ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}================================================${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo -e "${BOLD}================================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env with your database URL and JWT secrets"
echo "  2. Push the schema to your database:"
echo -e "       ${BOLD}npm run db:push${NC}"
echo "  3. Start the development server:"
echo -e "       ${BOLD}npm run dev${NC}"
echo ""
echo "This starts BOTH the API server (port 5000) and the"
echo "Vite dev server (port 5173) simultaneously."
echo ""
echo "Open: http://localhost:5173"
echo ""
