#!/bin/sh
# scripts/docker-start.sh
# Run migrations then start the server.
# Used as the Docker CMD in production deployments.

set -e

echo "Running database migrations..."
node --import tsx/esm scripts/migrate.ts

echo "Starting server..."
exec node --import tsx/esm server/index.ts