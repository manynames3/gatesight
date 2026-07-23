#!/usr/bin/env bash
set -euo pipefail

: "${GATESIGHT_USER_POOL_ID:?Set GATESIGHT_USER_POOL_ID}"
: "${GATESIGHT_REVIEWER_EMAIL:?Set GATESIGHT_REVIEWER_EMAIL}"
: "${GATESIGHT_TENANT_ID:?Set GATESIGHT_TENANT_ID}"
GATESIGHT_REVIEWER_GROUP="${GATESIGHT_REVIEWER_GROUP:-VIEWER}"
GATESIGHT_FACILITY_IDS="${GATESIGHT_FACILITY_IDS:-}"

case "$GATESIGHT_REVIEWER_GROUP" in
  ADMIN|SECURITY|OPERATOR|VIEWER) ;;
  *) echo "Reviewer group must be ADMIN, SECURITY, OPERATOR, or VIEWER." >&2; exit 2 ;;
esac

aws cognito-idp admin-create-user \
  --user-pool-id "$GATESIGHT_USER_POOL_ID" \
  --username "$GATESIGHT_REVIEWER_EMAIL" \
  --user-attributes \
    "Name=email,Value=$GATESIGHT_REVIEWER_EMAIL" \
    "Name=email_verified,Value=true" \
    "Name=custom:tenant_id,Value=$GATESIGHT_TENANT_ID" \
    "Name=custom:facility_ids,Value=$GATESIGHT_FACILITY_IDS" \
  --desired-delivery-mediums EMAIL

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$GATESIGHT_USER_POOL_ID" \
  --username "$GATESIGHT_REVIEWER_EMAIL" \
  --group-name "$GATESIGHT_REVIEWER_GROUP"
