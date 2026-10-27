#!/usr/bin/env bash

# ChronoStream - Real-Time Broadcasting Engine Demo Script
# Make executable: chmod +x publisher-demo.sh

CHRONOSTREAM_URL="${CHRONOSTREAM_URL:-http://localhost:3000}"
SECRET_KEY="${PUBLISH_SECRET_KEY:-chronostream_dev_secret_key_change_in_production}"
CHANNEL="${1:-demo-stream}"

echo "=========================================================="
echo " ChronoStream Real-Time SSE Publisher Demo"
echo " Target URL: ${CHRONOSTREAM_URL}"
echo " Channel:    ${CHANNEL}"
echo "=========================================================="

echo ""
echo "[1/4] Checking Engine Health & Broker Stats..."
curl -s "${CHRONOSTREAM_URL}/health"
echo -e "\n"

echo "[2/4] Broadcasting a simple text message..."
curl -s -X POST "${CHRONOSTREAM_URL}/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -d "{
    \"channel\": \"${CHANNEL}\",
    \"data\": \"Welcome to ChronoStream! Real-time delivery via SSE.\"
  }"
echo -e "\n"

sleep 1

echo "[3/4] Broadcasting structured JSON with custom event name & ID..."
curl -s -X POST "${CHRONOSTREAM_URL}/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -d "{
    \"channel\": \"${CHANNEL}\",
    \"event\": \"order.created\",
    \"id\": \"evt_$(date +%s)\",
    \"retry\": 5000,
    \"data\": {
      \"orderId\": \"ord_10293\",
      \"customer\": \"Sarah Connor\",
      \"total\": 189.95,
      \"currency\": \"USD\",
      \"status\": \"processing\"
    }
  }"
echo -e "\n"

sleep 1

echo "[4/4] Broadcasting an urgent system alert event..."
curl -s -X POST "${CHRONOSTREAM_URL}/publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -d "{
    \"channel\": \"${CHANNEL}\",
    \"event\": \"system.alert\",
    \"id\": \"alert_$(date +%s)\",
    \"data\": {
      \"severity\": \"warning\",
      \"component\": \"storage_cluster\",
      \"message\": \"High disk utilization alert (87% threshold exceeded)\"
    }
  }"
echo -e "\n"

echo "=========================================================="
echo " Broadcast demo completed."
echo " To listen live via curl in terminal, run:"
echo " curl -N -H 'Accept: text/event-stream' '${CHRONOSTREAM_URL}/stream?channel=${CHANNEL}'"
echo "=========================================================="
