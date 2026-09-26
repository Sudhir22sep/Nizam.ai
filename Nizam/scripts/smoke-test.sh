#!/bin/bash
# Nizam.ai server smoke test
#
# Usage:
#   BASE=http://localhost:4000 bash scripts/smoke-test.sh
#
# Expects a running server (node dist/Nizam/server/server.mjs).
# NOTE: the "no token" order/wishlist cases return 200 in development because
# development falls back to a sandbox user; in production (NODE_ENV=production)
# they return 401.
BASE="${BASE:-http://localhost:4101}"
BODY=/tmp/smoke-body.json
PASS=0; FAIL=0; INFO=0
EMAIL="smoketest.$(date +%s)@example.com"
TOKEN=""

t() { # name expected method path [data]
  local name="$1" expected="$2" method="$3" path="$4" data="$5" code
  if [ -n "$data" ]; then
    code=$(curl -s -o "$BODY" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' \
      -d "$data" --max-time 40 "$BASE$path")
  else
    code=$(curl -s -o "$BODY" -w '%{http_code}' -X "$method" --max-time 40 "$BASE$path")
  fi
  if [ "$expected" = "ANY" ]; then
    printf 'INFO  %-42s -> %s\n' "$name" "$code"; INFO=$((INFO+1))
  elif [ "$code" = "$expected" ]; then
    printf 'PASS  %-42s -> %s\n' "$name" "$code"; PASS=$((PASS+1))
  else
    printf 'FAIL  %-42s -> %s (expected %s)\n' "$name" "$code" "$expected"; FAIL=$((FAIL+1))
    printf '        body: %s\n' "$(head -c 220 "$BODY")"
  fi
}

j() { python3 -c "
import json,sys
try:
    d=json.load(open('$BODY'))
except Exception:
    print(''); sys.exit()
for k in '$1'.split('.'):
    d = d.get(k) if isinstance(d, dict) else None
print(d if d is not None else '')
"; }

echo "==================== HEALTH & STATIC ===================="
t "GET /health" 200 GET /health
t "GET /api/health" 200 GET /api/health
t "GET /api/test" 200 GET /api/test

echo "==================== SSR PAGES ===================="
for route in / /products /contact /about /login /register /cart /product/507f1f77bcf86cd799439011; do
  t "SSR $route" 200 GET "$route"
done

echo "==================== PRODUCTS API ===================="
t "GET /api/products/" 200 GET /api/products/
t "GET /api/products/?limit=1" 200 GET "/api/products/?limit=1"
t "GET /api/products/?search=shirt" 200 GET "/api/products/?search=shirt"
t "GET /api/products/valid-but-missing-id/" 404 GET /api/products/507f1f77bcf86cd799439011/
t "GET /api/products/INVALID-ID/ (bad ObjectId)" 400 GET /api/products/not-an-objectid/
t "POST /api/products/ missing fields" 400 POST /api/products/ '{"name":"x"}'

echo "==================== AUTH ===================="
t "GET /api/auth/me (no token)" 401 GET /api/auth/me
t "GET /api/auth/me (bad token)" 401 GET /api/auth/me
t "POST /api/auth/register (bad payload)" 400 POST /api/auth/register '{"email":"nope"}'
t "POST /api/auth/login (bad creds)" 401 POST /api/auth/login '{"email":"nobody@example.com","password":"wrongwrong"}'

t "POST /api/auth/register (valid)" ANY POST /api/auth/register \
  "{\"firstName\":\"Smoke\",\"lastName\":\"Test\",\"email\":\"$EMAIL\",\"password\":\"SmokeTest123!\"}"
REG_MSG="$(head -c 200 "$BODY")"
t "POST /api/auth/login (valid)" ANY POST /api/auth/login \
  "{\"email\":\"$EMAIL\",\"password\":\"SmokeTest123!\"}"
TOKEN="$(j token)"
if [ -z "$TOKEN" ]; then TOKEN="$(j accessToken)"; fi
echo "        register resp: $REG_MSG"
echo "        token acquired: $([ -n "$TOKEN" ] && echo YES || echo NO)"

if [ -n "$TOKEN" ]; then
  code=$(curl -s -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" --max-time 40 "$BASE/api/auth/me")
  printf '%s  %-42s -> %s\n' "$([ "$code" = 200 ] && echo PASS || echo FAIL)" "GET /api/auth/me (valid token)" "$code"
  [ "$code" = 200 ] && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); head -c 250 "$BODY"; echo; }
  code=$(curl -s -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" --max-time 40 "$BASE/api/orders")
  printf '%s  %-42s -> %s\n' "$([ "$code" = 200 ] && echo PASS || echo FAIL)" "GET /api/orders (with token)" "$code"
  [ "$code" = 200 ] && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); head -c 250 "$BODY"; echo; }
  code=$(curl -s -o "$BODY" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" --max-time 40 "$BASE/api/wishlist")
  printf '%s  %-42s -> %s\n' "$([ "$code" = 200 ] && echo PASS || echo FAIL)" "GET /api/wishlist (with token)" "$code"
  [ "$code" = 200 ] && PASS=$((PASS+1)) || { FAIL=$((FAIL+1)); head -c 250 "$BODY"; echo; }
fi
t "GET /api/orders (no token, dev sandbox user)" 200 GET /api/orders
t "GET /api/wishlist (no token, dev sandbox user)" 200 GET /api/wishlist

echo "==================== CONTACT ===================="
t "POST /api/contact (missing fields)" 400 POST /api/contact '{"name":"x"}'
t "POST /api/contact (valid)" 200 POST /api/contact \
  "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"message\":\"Automated smoke test message\"}"

echo "==================== CHECKOUT / PAYMENTS ===================="
t "POST /api/create-razorpay-order (bad payload)" 400 POST /api/create-razorpay-order '{"name":"x"}'
t "POST /api/create-razorpay-order (valid)" ANY POST /api/create-razorpay-order \
  "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"address\":\"1 Test St\",\"items\":[{\"product\":{\"name\":\"Test Tee\",\"price\":5},\"quantity\":1}],\"total\":5,\"currency\":\"USD\"}"
echo "        razorpay resp: $(head -c 220 "$BODY")"
t "POST /api/create-cod-order (zero total)" 400 POST /api/create-cod-order \
  '{"name":"Smoke","email":"a@b.com","items":[{"product":{"name":"x","price":1},"quantity":1}],"total":0}'
t "POST /api/create-cod-order (valid)" 200 POST /api/create-cod-order \
  "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"address\":\"1 Test St\",\"items\":[{\"product\":{\"name\":\"Test Tee\",\"price\":5},\"quantity\":2}],\"total\":10,\"currency\":\"USD\"}"
echo "        cod resp: $(head -c 220 "$BODY")"
t "POST /api/confirm-razorpay-payment (bad signature)" 400 POST /api/confirm-razorpay-payment \
  '{"razorpay_order_id":"order_x","razorpay_payment_id":"pay_x","razorpay_signature":"deadbeef","orderReference":"ORDER-1"}'

echo "==================== WEBHOOKS ===================="
t "POST /api/razorpay-webhook (no signature)" 400 POST /api/razorpay-webhook '{"event":"payment.captured"}'
t "POST /api/qikink-webhook (empty)" ANY POST /api/qikink-webhook '{}'
t "POST /api/printful-webhook (empty)" ANY POST /api/printful-webhook '{}'

echo "==================== 404 / ERROR HANDLING ===================="
t "GET /api/does-not-exist" 404 GET /api/does-not-exist
t "GET /no-such-page" ANY GET /no-such-page

echo
echo "======================================================="
echo "PASS=$PASS FAIL=$FAIL INFO=$INFO"
echo "======================================================="