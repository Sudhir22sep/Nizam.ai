#!/bin/bash
# End-to-end wishlist flow test (mirrors the Angular WishlistService calls)
#
# Usage:
#   BASE=http://localhost:4000 bash scripts/wishlist-flow-test.sh
BASE="${BASE:-http://localhost:4103}"
BODY=/tmp/w-body.json
PASS=0; FAIL=0
EMAIL="wish.$(date +%s)@example.com"

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

chk() {
  if [ "$2" = "$3" ]; then printf 'PASS  %-52s %s\n' "$1" "$3"; PASS=$((PASS+1))
  else printf 'FAIL  %-52s got %s (expected %s)\n' "$1" "$3" "$2"; FAIL=$((FAIL+1)); printf '        %s\n' "$(head -c 200 "$BODY")"; fi
}

# setup: real user + token
req POST /api/auth/register "{\"firstName\":\"Wish\",\"lastName\":\"Test\",\"email\":\"$EMAIL\",\"password\":\"WishTest123!\"}" >/dev/null
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"WishTest123!\"}" >/dev/null
TOKEN=$(j token)

count_items() { python3 -c "
import json
try:
    d=json.load(open('/tmp/w-body.json'))
except Exception:
    print(-1); raise SystemExit
print(len(d.get('wishlist',{}).get('items',[])))
"; }

echo "=== wishlist flow (exactly what the Angular service sends) ==="
chk "POST /api/wishlist (create 'My Favorites')" 201 "$(req POST /api/wishlist '{"name":"My Favorites","isPublic":false}' "$TOKEN")"
WID=$(j wishlist._id)
echo "        wishlist id: $WID"

chk "POST /api/wishlist/:id/items (add product)" 200 "$(req POST "/api/wishlist/$WID/items" '{"productId":"507f1f77bcf86cd799439011","variantId":null,"notes":""}' "$TOKEN")"
req GET "/api/wishlist/$WID" '' "$TOKEN" >/dev/null
chk "items in wishlist after add == 1" "1" "$(count_items)"

chk "DELETE /api/wishlist/:id/items (REMOVE BUTTON - was 404)" 200 "$(req DELETE "/api/wishlist/$WID/items" '{"productId":"507f1f77bcf86cd799439011","variantId":null}' "$TOKEN")"
req GET "/api/wishlist/$WID" '' "$TOKEN" >/dev/null
chk "items in wishlist after remove == 0" "0" "$(count_items)"

chk "remove same item again -> 409 (branch now reachable)" 409 "$(req DELETE "/api/wishlist/$WID/items" '{"productId":"507f1f77bcf86cd799439011","variantId":null}' "$TOKEN")"
chk "legacy /:id/items/:itemId routes (409 not 404)" 409 "$(req DELETE "/api/wishlist/$WID/items/legacy" '{"productId":"507f1f77bcf86cd799439011"}' "$TOKEN")"

chk "DELETE /api/wishlist/:id (DELETE BUTTON - was 404)" 200 "$(req DELETE "/api/wishlist/$WID" '' "$TOKEN")"
chk "DELETE /api/wishlist/:id again -> 404" 404 "$(req DELETE "/api/wishlist/$WID" '' "$TOKEN")"

echo "=== guards ==="
chk "DELETE /api/wishlist/bad-id -> 400" 400 "$(req DELETE "/api/wishlist/notanid" '' "$TOKEN")"

echo
echo "====================== PASS=$PASS FAIL=$FAIL ======================"