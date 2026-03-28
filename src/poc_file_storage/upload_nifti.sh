#!/usr/bin/env bash
set -euo pipefail

# -------- USER CONFIG --------
API="${API:-http://127.0.0.1:8000}"                # FastAPI base URL
STUDY_ID="${1:-}"                                  # REQUIRED: pass as arg1 or export STUDY_ID
FILE="${2:-test_cbct.nii.gz}"                      # pass as arg2, defaults to test_cbct.nii.gz in CWD
FILENAME_ON_SERVER="${FILENAME_ON_SERVER:-input.nii.gz}"
ROLE="original"
KIND="nifti"
CONTENT_TYPE="application/gzip"                    # .nii.gz
CHUNK_SIZE=$((16*1024*1024))                       # 16 MB
# ------------------------------

if [[ -z "${STUDY_ID}" ]]; then
  echo "Usage: $0 <STUDY_ID> [FILE]"
  echo "Example: $0 9a9573d0-c6f8-43dd-9960-5521ba95776b test_cbct.nii.gz"
  exit 64
fi

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: File not found: $FILE" >&2
  exit 66
fi

# file size (macOS vs Linux)
if stat -f%z "$FILE" >/dev/null 2>&1; then
  SIZE=$(stat -f%z "$FILE")       # macOS
else
  SIZE=$(stat -c%s "$FILE")       # Linux
fi

# optional sha256 (macOS vs Linux)
if command -v shasum >/dev/null 2>&1; then
  SHA256=$(shasum -a 256 "$FILE" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256=$(sha256sum "$FILE" | awk '{print $1}')
else
  SHA256=""
fi

echo "Uploading:"
echo "  STUDY_ID  = $STUDY_ID"
echo "  FILE      = $FILE"
echo "  SIZE      = $SIZE bytes"
echo "  FILENAME  = $FILENAME_ON_SERVER"
[[ -n "$SHA256" ]] && echo "  SHA256    = $SHA256"

# Build JSON safely with jq
if ! command -v jq >/dev/null 2>&1; then
  echo "Installing jq is recommended (brew install jq or apt-get install jq). Falling back to no SHA check."
  SHA256=""
fi

if [[ -n "$SHA256" ]] && command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n \
    --arg role "$ROLE" \
    --arg kind "$KIND" \
    --arg filename "$FILENAME_ON_SERVER" \
    --arg content_type "$CONTENT_TYPE" \
    --arg expected_sha256 "$SHA256" \
    --argjson expected_size "$SIZE" \
    '{role:$role,kind:$kind,filename:$filename,content_type:$content_type,expected_size:$expected_size,expected_sha256:$expected_sha256}')
else
  PAYLOAD=$(jq -n \
    --arg role "$ROLE" \
    --arg kind "$KIND" \
    --arg filename "$FILENAME_ON_SERVER" \
    --arg content_type "$CONTENT_TYPE" \
    --argjson expected_size "$SIZE" \
    '{role:$role,kind:$kind,filename:$filename,content_type:$content_type,expected_size:$expected_size}')
fi

# BEGIN
RESP=$(curl -sS -X POST "$API/storage/studies/$STUDY_ID/uploads:begin" \
  -H "Content-Type: application/json" -d "$PAYLOAD")

if command -v jq >/dev/null 2>&1; then
  UPLOAD_ID=$(echo "$RESP" | jq -r '.upload_id')
else
  UPLOAD_ID=$(echo "$RESP" | sed -n 's/.*"upload_id":"\([^"]*\)".*/\1/p')
fi

if [[ -z "${UPLOAD_ID:-}" || "$UPLOAD_ID" == "null" ]]; then
  echo "Begin failed. Server response:"
  echo "$RESP"
  exit 65
fi

echo "Begin OK. upload_id = $UPLOAD_ID"

# CHUNKS
TOTAL_PARTS=$(( (SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))
for ((i=0; i<TOTAL_PARTS; i++)); do
  dd if="$FILE" bs=$CHUNK_SIZE skip=$i count=1 2>/dev/null | \
    curl -sS -X PUT "$API/storage/uploads/$UPLOAD_ID/chunk?index=$i" \
      -F "chunk=@-;filename=part.bin" > /dev/null
  printf "Sent chunk %d/%d\r" "$i" "$((TOTAL_PARTS-1))"
done
echo

# FINALIZE
FINAL=$(curl -sS -X POST "$API/storage/uploads/$UPLOAD_ID:finalize")
echo "Finalize response:"
echo "$FINAL"
if command -v jq >/dev/null 2>&1; then
  echo "Parsed:"
  echo "  file_id : $(echo "$FINAL" | jq -r '.file_id')"
  echo "  rel_path: $(echo "$FINAL" | jq -r '.rel_path')"
  echo "  size    : $(echo "$FINAL" | jq -r '.size')"
  echo "  sha256  : $(echo "$FINAL" | jq -r '.sha256')"
fi

echo "Done. Check: data/studies/$STUDY_ID/raw/$FILENAME_ON_SERVER"
