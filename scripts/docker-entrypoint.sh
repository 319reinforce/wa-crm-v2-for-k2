#!/bin/sh
set -eu

node scripts/run-startup-migrations.cjs

exec "$@"
