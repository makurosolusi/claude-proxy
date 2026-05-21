#!/bin/bash
# Usage: ./test-token.sh <token> [base_url]
# Example: ./test-token.sh sk-cp-abc123
#          ./test-token.sh sk-cp-abc123 https://claude-proxy.wibudev.com

API_KEY="${1:?Usage: $0 <token> [base_url]}"
BASE="https://claude-proxy.wibudev.com"

# Auto-detect model pertama dari /v1/models
MODEL=$(curl -s "$BASE/v1/models" -H "x-api-key: $API_KEY" | jq -r '.data[0].id // "claude-haiku-4-5-20251001"')
echo "Model : $MODEL"

RESP=$(curl -s -X POST "$BASE/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 1500,
    \"messages\": [{\"role\": \"user\", \"content\": \"hallo jawab y/n saja\"}]
  }")

# Ambil teks (skip thinking block), fallback ke error message
ANSWER=$(echo "$RESP" | jq -r '(.content[] | select(.type=="text") | .text) // .error.message // "no response"' 2>/dev/null | head -1)
STATUS=$(echo "$RESP" | jq -r '.stop_reason // "error"' 2>/dev/null)

echo "Answer: $ANSWER"
echo "Stop  : $STATUS"
