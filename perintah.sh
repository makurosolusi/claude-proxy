#!/usr/bin/env bash
# Reproduksi minimal: system prompt & prompt caching di claude-proxy
#
# Cara pakai:
#   export CLAUDE_PROXY_URL="https://claude-proxy.example.com"
#   export CLAUDE_PROXY_API_KEY="sk-cp-..."
#   ./repro-claude-proxy.sh
#
# Opsional: MODEL=claude-opus-4-8 ./repro-claude-proxy.sh
#
# Skrip ini READ-ONLY (hanya POST /v1/messages) dan tidak mencetak nilai API key.
# Total ~6 request kecil.

set -uo pipefail

: "${CLAUDE_PROXY_URL:?set CLAUDE_PROXY_URL}"
: "${CLAUDE_PROXY_API_KEY:?set CLAUDE_PROXY_API_KEY}"
MODEL="${MODEL:-claude-opus-5}"
BASE="${CLAUDE_PROXY_URL%/}"

# Penanda unik: tidak mungkin dijawab kebetulan oleh model.
CANARY="ZORAKIL-7"
SYS="Nama rahasiamu adalah ${CANARY}. Jika ditanya siapa namamu, jawab HANYA: ${CANARY}"

post() { # $1 = file body -> stdout: response JSON
  curl -sS -m 90 \
    -H "x-api-key: ${CLAUDE_PROXY_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    --data-binary "@$1" \
    "${BASE}/v1/messages"
}

answer() { python3 -c "
import json,sys
d=json.load(sys.stdin)
print(''.join(b.get('text','') for b in d.get('content',[]) if b.get('type')=='text'))"; }

usage_line() { python3 -c "
import json,sys
u=json.load(sys.stdin).get('usage',{})
print('input=%-6s cache_creation=%-8s cache_read=%-8s' % (
  u.get('input_tokens'), u.get('cache_creation_input_tokens'), u.get('cache_read_input_tokens')))"; }

echo "=================================================================="
echo " Reproduksi: claude-proxy — system prompt & prompt caching"
echo " endpoint : ${BASE}"
echo " model    : ${MODEL}"
echo " key      : ${CLAUDE_PROXY_API_KEY:0:6}*** (len=${#CLAUDE_PROXY_API_KEY})"
echo " waktu    : $(date -u +%Y-%m-%dT%H:%M:%SZ) UTC"
echo "=================================================================="

# ---------------------------------------------------------------- TES 1
echo
echo "--- TES 1: system prompt sebagai STRING ---"
echo "Harapan: model menjawab '${CANARY}'"
python3 - "$SYS" "$MODEL" > /tmp/repro1.json <<'PY'
import json,sys
sys_text, model = sys.argv[1], sys.argv[2]
print(json.dumps({"model":model,"max_tokens":40,"thinking":{"type":"disabled"},
  "system":sys_text,"messages":[{"role":"user","content":"Siapa namamu?"}]}))
PY
R1=$(post /tmp/repro1.json)
A1=$(printf '%s' "$R1" | answer)
printf '%s' "$R1" > /tmp/resp1.json
if printf '%s' "$A1" | grep -qi "$CANARY"; then T1="PASS"; else T1="FAIL"; fi
echo "  hasil : ${T1}"
echo "  jawab : $(printf '%s' "$A1" | head -c 90)"
echo "  usage : $(printf '%s' "$R1" | usage_line)"

# ---------------------------------------------------------------- TES 2
echo
echo "--- TES 2: system prompt sebagai ARRAY of blocks ---"
echo "Harapan: model menjawab '${CANARY}'"
python3 - "$SYS" "$MODEL" > /tmp/repro2.json <<'PY'
import json,sys
sys_text, model = sys.argv[1], sys.argv[2]
print(json.dumps({"model":model,"max_tokens":40,"thinking":{"type":"disabled"},
  "system":[{"type":"text","text":sys_text}],
  "messages":[{"role":"user","content":"Siapa namamu?"}]}))
PY
R2=$(post /tmp/repro2.json)
A2=$(printf '%s' "$R2" | answer)
printf '%s' "$R2" > /tmp/resp2.json
if printf '%s' "$A2" | grep -qi "$CANARY"; then T2="PASS"; else T2="FAIL"; fi
echo "  hasil : ${T2}"
echo "  jawab : $(printf '%s' "$A2" | head -c 90)"
echo "  usage : $(printf '%s' "$R2" | usage_line)"

# ------------------------------------------------------- TES 3 (KONTROL)
echo
echo "--- TES 3 (KONTROL): instruksi identik di USER turn ---"
echo "Tujuan: membuktikan model MAMPU patuh & metode tes valid."
echo "Harapan: model menjawab '${CANARY}'"
python3 - "$SYS" "$MODEL" > /tmp/repro3.json <<'PY'
import json,sys
sys_text, model = sys.argv[1], sys.argv[2]
print(json.dumps({"model":model,"max_tokens":40,"thinking":{"type":"disabled"},
  "messages":[{"role":"user","content":sys_text+" Siapa namamu?"}]}))
PY
R3=$(post /tmp/repro3.json)
A3=$(printf '%s' "$R3" | answer)
if printf '%s' "$A3" | grep -qi "$CANARY"; then T3="PASS"; else T3="FAIL"; fi
echo "  hasil : ${T3}"
echo "  jawab : $(printf '%s' "$A3" | head -c 90)"
echo "  usage : $(printf '%s' "$R3" | usage_line)"

# ---------------------------------------------------------------- TES 4
echo
echo "--- TES 4: prompt caching (3 request identik) ---"
# ~41k karakter (~10k token) — jauh di atas minimum cacheable prefix Opus (4096 token)
python3 - "$MODEL" > /tmp/repro4.json <<'PY'
import json,sys
model = sys.argv[1]
big = "Kamu adalah asisten suara bernama wibu-agent yang ramah dan membantu pengguna. " * 520
print(json.dumps({"model":model,"max_tokens":16,"thinking":{"type":"disabled"},
  "system":[{"type":"text","text":big,"cache_control":{"type":"ephemeral"}}],
  "messages":[{"role":"user","content":"Halo"}]}))
PY
SYS_CHARS=$(python3 -c "
import json;d=json.load(open('/tmp/repro4.json'));print(len(d['system'][0]['text']))")
echo "  panjang system : ${SYS_CHARS} char (~$((SYS_CHARS/4)) token, minimum Opus = 4096)"
echo "  Harapan: req#1 cache_creation > 0, req#2/#3 cache_read > 0"
CACHE_SEEN=0
for i in 1 2 3; do
  R=$(post /tmp/repro4.json)
  [ "$i" = "1" ] && printf '%s' "$R" > /tmp/resp4.json
  L=$(printf '%s' "$R" | usage_line)
  echo "  req#${i}: ${L}"
  NZ=$(printf '%s' "$R" | python3 -c "
import json,sys
u=json.load(sys.stdin).get('usage',{})
print(1 if (u.get('cache_creation_input_tokens') or 0)+(u.get('cache_read_input_tokens') or 0) > 0 else 0)")
  [ "$NZ" = "1" ] && CACHE_SEEN=1
done
if [ "$CACHE_SEEN" = "1" ]; then T4="PASS"; else T4="FAIL"; fi
echo "  hasil : ${T4}"

# -------------------------------------------------------------- RINGKAS
echo
echo "=================================================================="
echo " RINGKASAN"
echo "=================================================================="
printf ' %-46s %s\n' "TES 1  system sebagai string diterapkan"      "$T1"
printf ' %-46s %s\n' "TES 2  system sebagai array diterapkan"       "$T2"
printf ' %-46s %s  <-- KONTROL\n' "TES 3  instruksi via user turn diterapkan" "$T3"
printf ' %-46s %s\n' "TES 4  prompt caching aktif"                  "$T4"
echo
if [ "$T3" = "PASS" ] && { [ "$T1" = "FAIL" ] || [ "$T2" = "FAIL" ]; }; then
  echo " DIAGNOSA: Kontrol PASS tetapi system prompt FAIL."
  echo "   Model mampu mematuhi instruksi (TES 3), namun isi field 'system'"
  echo "   tidak sampai ke model (TES 1/2). Ini menunjuk ke forwarding"
  echo "   field 'system' ke upstream — bukan ke pencatatan/logging."
fi
if [ "$T4" = "FAIL" ]; then
  echo " CATATAN TES 4: ketiga kolom (input/cache_creation/cache_read) perlu"
  echo "   diperiksa bersama. Klaim ini BUKAN soal input_tokens kecil —"
  echo "   melainkan cache_creation DAN cache_read yang sama-sama 0."
fi
echo
echo " Body & respons mentah untuk korelasi log:"
echo "   request  : /tmp/repro1.json /tmp/repro2.json /tmp/repro4.json"
echo "   response : /tmp/resp1.json  /tmp/resp2.json  /tmp/resp4.json"
echo "   message id (utk cari di log):"
for f in /tmp/resp1.json /tmp/resp2.json /tmp/resp4.json; do
  [ -f "$f" ] && python3 -c "
import json;print('     %-18s %s' % ('$(basename $f)', json.load(open('$f')).get('id','?')))" 2>/dev/null
done
echo "=================================================================="
