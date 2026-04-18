#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
BASE_URL="${API_BASE:-http://localhost:3000/api}"
SNAP_DIR="${SNAP_DIR:-./regression-snapshots}"
LIFECYCLE_STAGE_VALUE="${LIFECYCLE_STAGE_VALUE:-onboarding}"
MONTHLY_FEE_STATUS_VALUE="${MONTHLY_FEE_STATUS_VALUE:-paid}"
REGRESSION_TOKEN="${REGRESSION_TOKEN:-}"

declare -a CASES=(
  "owner-beau|owner=Beau"
  "owner-yiyun|owner=Yiyun"
  "owner-empty|"
  "owner-beau-replied|owner=Beau&event=replied"
  "owner-beau-joined|owner=Beau&event=joined"
  "owner-beau-mixed-case|owner=BEAU"
  "owner-beau-lower|owner=beau"
  "all-lifecycle-stage-onboarding|lifecycle_stage=${LIFECYCLE_STAGE_VALUE}"
  "all-monthly-fee-paid|monthly_fee_status=${MONTHLY_FEE_STATUS_VALUE}"
)

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/regression/creators-owner-switch.sh baseline
  scripts/regression/creators-owner-switch.sh candidate
  scripts/regression/creators-owner-switch.sh diff

Environment:
  API_BASE=http://localhost:3000/api
  SNAP_DIR=./regression-snapshots
  REGRESSION_TOKEN=<token>            # sent as Authorization: Bearer <token>
  LIFECYCLE_STAGE_VALUE=onboarding
  MONTHLY_FEE_STATUS_VALUE=paid
EOF
}

log() {
  printf '[creators-owner-switch] %s\n' "$*" >&2
}

die() {
  log "$*"
  exit 1
}

write_pretty_json() {
  local input_path="$1"
  local output_path="$2"

  node - "$input_path" "$output_path" <<'NODE'
const fs = require('node:fs');

const [, , inputPath, outputPath] = process.argv;

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortDeep(value[key]);
      return acc;
    }, {});
  }
  return value;
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  console.error(`[creators-owner-switch] invalid JSON: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(parsed)) {
  console.error('[creators-owner-switch] expected /api/creators response to be a JSON array');
  process.exit(1);
}

fs.writeFileSync(outputPath, `${JSON.stringify(sortDeep(parsed), null, 2)}\n`);
NODE
}

fetch_case() {
  local mode="$1"
  local key="$2"
  local query="$3"
  local output_dir="${SNAP_DIR}/${mode}"
  local output_path="${output_dir}/${key}.json"
  local tmp_body
  local http_code
  local endpoint="${BASE_URL%/}/creators"
  local -a curl_args

  mkdir -p "$output_dir"
  tmp_body="$(mktemp "${TMPDIR:-/tmp}/creators-owner-switch.XXXXXX")"
  curl_args=(-sS -o "$tmp_body" -w '%{http_code}' --get)
  curl_args+=(--data-urlencode "fields=wa_phone")

  if [[ -n "$REGRESSION_TOKEN" ]]; then
    curl_args+=(-H "Authorization: Bearer ${REGRESSION_TOKEN}")
  fi

  if [[ -n "$query" ]]; then
    local -a parts
    IFS='&' read -r -a parts <<< "$query"
    for part in "${parts[@]}"; do
      [[ -n "$part" ]] || continue
      curl_args+=(--data-urlencode "$part")
    done
  fi

  http_code="$(curl "${curl_args[@]}" "$endpoint")" || {
    rm -f "$tmp_body"
    die "curl failed for ${key}"
  }

  if [[ ! "$http_code" =~ ^2 ]]; then
    local body_excerpt
    body_excerpt="$(head -c 400 "$tmp_body" 2>/dev/null || true)"
    rm -f "$tmp_body"
    die "HTTP ${http_code} for ${key}: ${body_excerpt}"
  fi

  write_pretty_json "$tmp_body" "$output_path"
  rm -f "$tmp_body"
  log "saved ${mode}/${key}.json"
}

capture_mode() {
  local mode="$1"
  local entry

  if [[ -z "$REGRESSION_TOKEN" ]]; then
    log "warning: REGRESSION_TOKEN is empty; requests will run anonymously"
  fi

  for entry in "${CASES[@]}"; do
    local key query
    IFS='|' read -r key query <<< "$entry"
    fetch_case "$mode" "$key" "$query"
  done

  log "capture complete: ${SNAP_DIR}/${mode}"
}

run_diff() {
  local -a keys=()
  local entry

  for entry in "${CASES[@]}"; do
    local key query
    IFS='|' read -r key query <<< "$entry"
    keys+=("$key")
  done

  node - "$SNAP_DIR" "${keys[@]}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [, , snapDir, ...keys] = process.argv;
const forbiddenKeys = [
  'last_user_ts',
  'last_me_ts',
  'first_user_ts',
  'user_message_count',
  'nonblank_user_message_count',
];

let hasDiff = false;

function stableSerialize(value) {
  if (value === undefined) return '__undefined__';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeBinaryInt(value) {
  if (value === 0 || value === 1) return value;
  if (value === '0' || value === '1') return Number(value);
  return null;
}

function asCreatorId(item, index, side, key) {
  if (!item || (typeof item !== 'object')) {
    console.log(`DIFF ${key}: ${side}[${index}] is not an object`);
    hasDiff = true;
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(item, 'id')) {
    console.log(`DIFF ${key}: ${side}[${index}] is missing creator.id`);
    hasDiff = true;
    return null;
  }
  return String(item.id);
}

function readSnapshot(filePath, side, key) {
  if (!fs.existsSync(filePath)) {
    console.log(`DIFF ${key}: missing ${side} snapshot ${filePath}`);
    hasDiff = true;
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.log(`DIFF ${key}: invalid JSON in ${side} snapshot: ${error.message}`);
    hasDiff = true;
    return null;
  }

  if (!Array.isArray(parsed)) {
    console.log(`DIFF ${key}: ${side} snapshot is not a JSON array`);
    hasDiff = true;
    return null;
  }

  return parsed;
}

function summarizeList(values, limit = 10) {
  const slice = values.slice(0, limit);
  const suffix = values.length > limit ? ` ... (+${values.length - limit} more)` : '';
  return slice.join(', ') + suffix;
}

for (const key of keys) {
  const baselinePath = path.join(snapDir, 'baseline', `${key}.json`);
  const candidatePath = path.join(snapDir, 'candidate', `${key}.json`);
  const baseline = readSnapshot(baselinePath, 'baseline', key);
  const candidate = readSnapshot(candidatePath, 'candidate', key);

  if (!baseline || !candidate) {
    continue;
  }

  const baselineIds = [];
  const candidateIds = [];
  const baselineMap = new Map();
  const candidateMap = new Map();
  const baselineDuplicateIds = [];
  const candidateDuplicateIds = [];

  baseline.forEach((item, index) => {
    const id = asCreatorId(item, index, 'baseline', key);
    if (id === null) return;
    baselineIds.push(id);
    if (baselineMap.has(id)) baselineDuplicateIds.push(id);
    baselineMap.set(id, item);
  });

  candidate.forEach((item, index) => {
    const id = asCreatorId(item, index, 'candidate', key);
    if (id === null) return;
    candidateIds.push(id);
    if (candidateMap.has(id)) candidateDuplicateIds.push(id);
    candidateMap.set(id, item);
  });

  if (baselineDuplicateIds.length > 0) {
    console.log(`DIFF ${key}: baseline contains duplicate ids: ${summarizeList([...new Set(baselineDuplicateIds)])}`);
    hasDiff = true;
  }
  if (candidateDuplicateIds.length > 0) {
    console.log(`DIFF ${key}: candidate contains duplicate ids: ${summarizeList([...new Set(candidateDuplicateIds)])}`);
    hasDiff = true;
  }

  const baselineIdSet = [...new Set(baselineIds)].sort();
  const candidateIdSet = [...new Set(candidateIds)].sort();
  const baselineOnly = baselineIdSet.filter((id) => !candidateMap.has(id));
  const candidateOnly = candidateIdSet.filter((id) => !baselineMap.has(id));

  if (baselineOnly.length > 0 || candidateOnly.length > 0) {
    if (baselineOnly.length > 0) {
      console.log(`DIFF ${key}: ids missing from candidate: ${summarizeList(baselineOnly)}`);
    }
    if (candidateOnly.length > 0) {
      console.log(`DIFF ${key}: extra ids in candidate: ${summarizeList(candidateOnly)}`);
    }
    hasDiff = true;
  }

  if (baselineIds.length !== candidateIds.length) {
    console.log(`DIFF ${key}: array length differs baseline=${baselineIds.length} candidate=${candidateIds.length}`);
    hasDiff = true;
  }

  if (baselineOnly.length === 0 && candidateOnly.length === 0 && baselineIds.length === candidateIds.length) {
    const orderDiffs = [];
    for (let index = 0; index < baselineIds.length; index += 1) {
      if (baselineIds[index] !== candidateIds[index]) {
        orderDiffs.push(`#${index + 1}: baseline=${baselineIds[index]} candidate=${candidateIds[index]}`);
      }
      if (orderDiffs.length >= 10) break;
    }
    if (orderDiffs.length > 0) {
      console.log(`WARN ${key}: creator id order differs (counts as regression)`);
      orderDiffs.forEach((line) => console.log(`  ${line}`));
      hasDiff = true;
    }
  }

  const candidateLeaks = [];
  candidate.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const leaked = forbiddenKeys.filter((field) => Object.prototype.hasOwnProperty.call(item, field));
    if (leaked.length === 0) return;
    const id = Object.prototype.hasOwnProperty.call(item, 'id') ? String(item.id) : `index:${index}`;
    candidateLeaks.push(`creator=${id} keys=${leaked.join(',')}`);
  });
  if (candidateLeaks.length > 0) {
    console.log(`DIFF ${key}: candidate leaks internal keys`);
    candidateLeaks.slice(0, 10).forEach((line) => console.log(`  ${line}`));
    if (candidateLeaks.length > 10) {
      console.log(`  ... (+${candidateLeaks.length - 10} more)`);
    }
    hasDiff = true;
  }

  const commonIds = baselineIdSet.filter((id) => candidateMap.has(id));
  const fieldDiffs = [];

  for (const id of commonIds) {
    const before = baselineMap.get(id) || {};
    const after = candidateMap.get(id) || {};

    const beforeReply = normalizeBinaryInt(before.ev_replied);
    const afterReply = normalizeBinaryInt(after.ev_replied);
    if (beforeReply === null || afterReply === null || beforeReply !== afterReply) {
      fieldDiffs.push(`creator=${id} ev_replied baseline=${String(before.ev_replied)} candidate=${String(after.ev_replied)}`);
    }

    const beforeFacts = stableSerialize(before.message_facts);
    const afterFacts = stableSerialize(after.message_facts);
    if (beforeFacts !== afterFacts) {
      fieldDiffs.push(`creator=${id} message_facts differ`);
    }

    const beforeStage = before?.lifecycle?.stage_key;
    const afterStage = after?.lifecycle?.stage_key;
    if (beforeStage !== afterStage) {
      fieldDiffs.push(`creator=${id} lifecycle.stage_key baseline=${String(beforeStage)} candidate=${String(afterStage)}`);
    }

    const beforeFlags = stableSerialize(before?.lifecycle?.flags);
    const afterFlags = stableSerialize(after?.lifecycle?.flags);
    if (beforeFlags !== afterFlags) {
      fieldDiffs.push(`creator=${id} lifecycle.flags differ`);
    }
  }

  if (fieldDiffs.length > 0) {
    console.log(`DIFF ${key}: field-level regressions`);
    fieldDiffs.slice(0, 20).forEach((line) => console.log(`  ${line}`));
    if (fieldDiffs.length > 20) {
      console.log(`  ... (+${fieldDiffs.length - 20} more)`);
    }
    hasDiff = true;
  }

  if (
    baselineOnly.length === 0
    && candidateOnly.length === 0
    && baselineIds.length === candidateIds.length
    && candidateLeaks.length === 0
    && fieldDiffs.length === 0
  ) {
    const inSameOrder = baselineIds.every((id, index) => id === candidateIds[index]);
    if (inSameOrder) {
      console.log(`OK ${key}: no contract drift`);
    }
  }
}

if (hasDiff) {
  process.exit(1);
}

console.log(`OK all snapshots: ${keys.length} query variants matched`);
NODE
}

case "$MODE" in
  baseline)
    capture_mode "baseline"
    ;;
  candidate)
    capture_mode "candidate"
    ;;
  diff)
    run_diff
    ;;
  *)
    usage
    exit 1
    ;;
esac
