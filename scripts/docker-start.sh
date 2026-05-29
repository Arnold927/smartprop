#!/bin/sh
# scripts/docker-start.sh
# Run migrations then start the server.
# Used as the Docker CMD in production deployments.

set -e

echo "Running database migrations..."
node --loader tsx/esm scripts/migrate.ts

echo "Starting server..."
exec node --loader tsx/esm server/index.ts
