#!/usr/bin/env bash
set -euo pipefail

: "${GATESIGHT_API_URL:?Set GATESIGHT_API_URL}"
: "${GATESIGHT_ACCESS_TOKEN:?Set a short-lived reviewer access token}"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $GATESIGHT_ACCESS_TOKEN" \
  -H "Accept: application/json" \
  "$GATESIGHT_API_URL/v1/time" >/dev/null

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $GATESIGHT_ACCESS_TOKEN" \
  -H "Accept: application/json" \
  "$GATESIGHT_API_URL/v1/facilities" >/dev/null

echo "GateSight authenticated smoke checks passed."
