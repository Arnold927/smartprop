# ============================================================
# SmartProp - Production Dockerfile
# Multi-stage build: build frontend, then run server
# ============================================================

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy client package files
COPY client/package.json client/package-lock.json ./client/

# Install root deps
RUN npm ci --ignore-scripts

# Install client deps
RUN npm ci --prefix client --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY client/ ./client/
COPY tsconfig.json ./

# Build frontend
RUN npm run build:client

# Stage 2: Production server
FROM node:20-alpine AS production
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy server source and shared schema
COPY server/ ./server/
COPY shared/ ./shared/
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

# tsx runs TypeScript directly — no compile step, no silent tsc failures
# This is safe at SmartProp's scale and simplifies the build considerably.
# Switch to a tsc compile step (without || true) if you outgrow it.
RUN npm ci --ignore-scripts

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/dist/public ./dist/public

# Create uploads directory
RUN mkdir -p /app/uploads

# Copy startup script
COPY scripts/docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# Run migrations then start the compiled server
CMD ["/bin/sh", "/app/docker-start.sh"]