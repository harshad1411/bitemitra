#!/usr/bin/env bash
# Give the server its Google Maps key (D-81, D-114), run by the owner so the key never leaves the server:
#   ssh -t root@<droplet-ip> /opt/jamzo/deploy/set-maps-key.sh
# Asks for the key (hidden), checks it with Google from this server — address of a spot (Geocoding API), place
# search (Places API (New)) and road distance (Routes API) — and saves it in deploy/.env.production only when all
# three answer. Then restarts the API. Google is used only after Jamzo Admin → Settings → "Maps provider" is GOOGLE.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Run first-setup.sh first."; exit 1; }

echo
echo "== Google Maps key (server) =="
while :; do
  read -r -s -p "Google Maps API key (hidden — paste with Cmd+V, then Enter): " KEY; echo
  KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
  case "$KEY" in AIza*) [ "${#KEY}" -ge 30 ] && { echo "  ✓ got a key of ${#KEY} characters"; break; } ;; esac
  echo "  ✗ That does not look like a Google API key (they start with AIza). Paste it again."
done

# Unjha, Gujarat — the same kind of questions the app asks.
fail() { echo "  ✗ $1"; echo "Nothing was saved. Fix it in Google Cloud Console and run this again."; exit 1; }
echo "Checking the key with Google …"

GEO="$(curl -s -G https://maps.googleapis.com/maps/api/geocode/json \
  --data-urlencode "latlng=23.8053,72.3935" --data-urlencode "key=$KEY")"
STATUS="$(printf '%s' "$GEO" | grep -o '"status" *: *"[A-Z_]*"' | head -1 | grep -o '[A-Z_]*"$' | tr -d '"')"
[ "$STATUS" = "OK" ] || fail "Geocoding API: ${STATUS:-no answer} $(printf '%s' "$GEO" | grep -o '"error_message" *: *"[^"]*"' | head -1)"
echo "  ✓ Address of a spot (Geocoding API)"

PLACES="$(curl -s -X POST https://places.googleapis.com/v1/places:autocomplete \
  -H "content-type: application/json" -H "x-goog-api-key: $KEY" \
  -d '{"input":"Umiya Mata temple Unjha","includedRegionCodes":["in"]}')"
printf '%s' "$PLACES" | grep -q '"suggestions"' ||
  fail "Places API (New): $(printf '%s' "$PLACES" | grep -o '"message" *: *"[^"]*"' | head -1)"
echo "  ✓ Place search (Places API (New))"

ROUTES="$(curl -s -X POST https://routes.googleapis.com/directions/v2:computeRoutes \
  -H "content-type: application/json" -H "x-goog-api-key: $KEY" -H "x-goog-fieldmask: routes.distanceMeters" \
  -d '{"origin":{"location":{"latLng":{"latitude":23.8053,"longitude":72.3935}}},"destination":{"location":{"latLng":{"latitude":23.8123,"longitude":72.4011}}},"travelMode":"TWO_WHEELER"}')"
printf '%s' "$ROUTES" | grep -q '"distanceMeters"' ||
  fail "Routes API: $(printf '%s' "$ROUTES" | grep -o '"message" *: *"[^"]*"' | head -1)"
echo "  ✓ Road distance (Routes API)"

sed -i -E '/^GOOGLE_MAPS_API_KEY=/d' "$ENV_FILE"
printf 'GOOGLE_MAPS_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset KEY

docker compose -f docker-compose.prod.yml up -d --force-recreate api >/dev/null
echo "✓ Saved, and the API was restarted."
echo "Last step: Jamzo Admin → Settings → Delivery → \"Maps provider\" → GOOGLE (with a reason)."
