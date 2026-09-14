#!/bin/bash
# Verification suite for the Nizam.ai auth / ownership / validation fixes
#
# Usage:
#   BASE=http://localhost:4000 bash scripts/verify-fixes.sh
BASE="${BASE:-http://localhost:4101}"
BODY=/tmp/v-body.json
PASS=0; FAIL=0
EMAIL="verify.$(date +%s)@example.com"

j() { python3 -c "
import json,sys
try: d=json.load(open('$BODY'))
except Exception: print(''); sys.exit()
for k in '$1'.split('.'):
    d = d.get(k) if isinstance(d, dict) else None
print(d if d is not None else '')
"; }

req() { # method path data token
  local m="$1" p="$2" d="$3" tk="$4"
  local args=(-s -o "$BODY" -w '%{http_code}' -X "$m" --max-time 40 -H 'Content-Type: application/json')
  [ -n "$tk" ] && args+=(-H "Authorization: Bearer $tk")
  [ -n "$d" ] && args+=(-d "$d")
  curl "${args[@]}" "$BASE$p"
}

chk() { # name expected actual
  if [ "$2" = "$3" ]; then
    printf 'PASS  %-46s %s\n' "$1" "$3"; PASS=$((PASS+1))
  else
    printf 'FAIL  %-46s got %s (expected %s)\n' "$1" "$3" "$2"; FAIL=$((FAIL+1))
    printf '        %s\n' "$(head -c 200 "$BODY")"
  fi
}

echo "--- setup: register + login ---"
req POST /api/auth/register "{\"firstName\":\"Verify\",\"lastName\":\"User\",\"email\":\"$EMAIL\",\"password\":\"Verify12345!\"}" >/dev/null
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"Verify12345!\"}" >/dev/null
TOKEN=$(j token)
echo "        test account: $EMAIL"
echo "        token acquired: $([ -n "$TOKEN" ] && echo YES || echo NO)"

echo "--- FIXED: auth endpoints that were commented out ---"
chk "GET /api/auth/me (real token)" 200 "$(req GET /api/auth/me '' "$TOKEN")"
req GET /api/auth/me '' "$TOKEN" >/dev/null
chk "GET /api/auth/me returns the REAL user" "$EMAIL" "$(j user.email)"
chk "PUT /api/auth/profile (real token)" 200 "$(req PUT /api/auth/profile '{"firstName":"Verified","phone":"1234567890"}' "$TOKEN")"
chk "POST /api/auth/addresses (real token)" 200 "$(req POST /api/auth/addresses '{"type":"shipping","line1":"1 Main St","city":"Austin","state":"TX","postalCode":"78701","country":"USA","isDefault":true}' "$TOKEN")"
chk "DELETE /api/auth/addresses/0 (real token)" 200 "$(req DELETE /api/auth/addresses/0 '' "$TOKEN")"
chk "PUT /api/auth/profile (no token)" 401 "$(req PUT /api/auth/profile '{"firstName":"x"}' '')"
chk "GET /api/auth/me (garbage token)" 401 "$(req GET /api/auth/me '' 'not.a.real.token')"

echo "--- FIXED: order data scoping (no PII leak) ---"
chk "POST /api/create-cod-order" 200 "$(req POST /api/create-cod-order "{\"name\":\"Verify\",\"email\":\"$EMAIL\",\"address\":\"1 Main\",\"items\":[{\"product\":{\"name\":\"Tee\",\"price\":7},\"quantity\":1}],\"total\":7,\"currency\":\"USD\"}")"
ORDER_REF=$(j orderReference)
chk "GET /api/orders/:ref (owner token)" 200 "$(req GET "/api/orders/$ORDER_REF" '' "$TOKEN")"
chk "GET /api/orders/:ref (unauthenticated)" 404 "$(req GET "/api/orders/$ORDER_REF" '' '')"
req GET /api/orders '' '' >/dev/null
chk "GET /api/orders (unauth) leaks 0 orders" "0" "$(j total)"
req GET /api/orders '' "$TOKEN" >/dev/null
chk "GET /api/orders (owner) lists own orders" "1" "$(j total)"

echo "--- FIXED: validation + JSON 404 ---"
chk "GET /api/products/bad-id/ -> 400" 400 "$(req GET /api/products/not-an-objectid/ '' '')"
chk "GET /api/does-not-exist -> JSON 404" 404 "$(req GET /api/does-not-exist '' '')"
chk "POST /api/test (relocated route)" 200 "$(req POST /api/test '' '')"
chk "GET /api/products/ -> 200" 200 "$(req GET /api/products/ '' '')"

echo
echo "====================== PASS=$PASS FAIL=$FAIL ======================"