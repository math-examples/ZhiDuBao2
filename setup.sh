#!/usr/bin/env bash
# setup.sh — esbuild + SRI + CDN updater for 指读宝 (CI-safe)
set -euo pipefail

# ============ REPOSITORY ============
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO_ROOT" ]; then
  echo "❌ Not inside a git repo" >&2
  exit 1
fi
cd "$REPO_ROOT"

# --- Owner / repo / version resolution ---
if [ -n "${1:-}" ]; then
  OWNER="$1"
else
  OWNER="${GITHUB_OWNER:-$(git remote get-url origin 2>/dev/null \
    | sed -n 's|.*[:/]\([^/]*\)/\([^./]*\).*|\1|p' \
    | head -1)}"
  [ -n "$OWNER" ] || OWNER="math-examples"
fi

if [ -n "${2:-}" ]; then
  REPO="$2"
else
  REPO="${GITHUB_REPO:-$(basename "$REPO_ROOT")}"
fi

# ★ FIX #1: Accept explicit version as $3, otherwise auto-generate
if [ -n "${3:-}" ]; then
  VERSION="$3"
  [[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
else
  # Safe file list construction (no glob failures)
  FILE_LIST=()
  if [ -d css ]; then
    while IFS= read -r -d '' f; do
      FILE_LIST+=("$f")
    done < <(find css -type f -name '*.css' -print0 | sort -z)
  fi
  if [ -d js ]; then
    while IFS= read -r -d '' f; do
      FILE_LIST+=("$f")
    done < <(find js -type f -name '*.js' -print0 | sort -z)
  fi

  if [ ${#FILE_LIST[@]} -gt 0 ] && cat "${FILE_LIST[@]}" >/dev/null 2>&1; then
    RAW_HASH=$(cat "${FILE_LIST[@]}" | openssl dgst -sha256 | grep -o '[a-f0-9]\{64\}')
    # Reject hash-of-nothing (empty stdin)
    if [ -n "$RAW_HASH" ] && [ "$RAW_HASH" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      VERSION="v${RAW_HASH:0:12}"
    fi
  fi

  if [ -z "${VERSION:-}" ]; then
    VERSION="v$(date -u +%Y%m%d%H%M%S)"
  fi
fi

echo "🔐 Owner:   ${OWNER}"
echo "🔐 Repo:    ${REPO}"
echo "🔐 Version: ${VERSION}"

# ============ INSTALL & BUILD (FAIL FAST) ============
BUILD_DIR="dist"
BUILD_OK=false

if [ ! -f "package.json" ]; then
  echo "❌ package.json not found" >&2
  exit 1
fi

# ★ FIX #2: npm must succeed — no || masking
echo "📦 Installing dependencies..."
if [ -f "package-lock.json" ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "📦 Building with esbuild..."
mkdir -p "${BUILD_DIR}/css"

if [ ! -f "js/main.js" ]; then
  echo "❌ js/main.js not found" >&2
  exit 1
fi

# ★ FIX #2: esbuild must succeed — no || swallow
npx esbuild js/main.js \
  --bundle \
  --minify \
  --sourcemap \
  --outfile="${BUILD_DIR}/main.js"

# ★ FIX #2: verify output exists
if [ ! -f "${BUILD_DIR}/main.js" ]; then
  echo "❌ esbuild failed: ${BUILD_DIR}/main.js not produced" >&2
  exit 1
fi

# Copy CSS
if [ -f "css/app.css" ]; then
  cp css/app.css "${BUILD_DIR}/css/app.css"
elif [ -f "css/style.css" ]; then
  cp css/style.css "${BUILD_DIR}/css/app.css"
else
  echo "❌ No CSS source file found (css/app.css or css/style.css)" >&2
  exit 1
fi

if [ ! -f "${BUILD_DIR}/css/app.css" ]; then
  echo "❌ CSS copy failed" >&2
  exit 1
fi

BUILD_OK=true
echo "  ✅ ${BUILD_DIR}/main.js"
echo "  ✅ ${BUILD_DIR}/css/app.css"

# ============ DISCOVER FILES FOR SRI ============
SRI_FILES=()
if [ "$BUILD_OK" = true ] && [ -f "${BUILD_DIR}/main.js" ]; then
  SRI_FILES+=("${BUILD_DIR}/main.js")
fi
if [ "$BUILD_OK" = true ] && [ -f "${BUILD_DIR}/css/app.css" ]; then
  SRI_FILES+=("${BUILD_DIR}/css/app.css")
fi
# Always include source files as fallback
for f in js/*.js css/*.css; do
  [ -f "$f" ] || continue
  if [[ ! " ${SRI_FILES[@]} " =~ " ${f} " ]]; then
    SRI_FILES+=("$f")
  fi
done

# ============ GENERATE SRI HASHES ============
declare -A SRI
for f in "${SRI_FILES[@]}"; do
  if [ -f "$f" ]; then
    hash=$(openssl dgst -sha384 -binary "$f" | openssl base64 -A)
    SRI[$f]="sha384-${hash}"
    echo "  ✅ ${f} → sha384-${hash:0:20}..."
  else
    SRI[$f]=""
    echo "  ⚠️ ${f} not found; skipping"
  fi
done

# ============ UPDATE index.html ============
if [ ! -f index.html ]; then
  echo "❌ index.html not found" >&2
  exit 1
fi

cp index.html index.html.bak

# --- Portable in-place sed ---
if [[ "${OSTYPE:-}" == darwin* ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

# 1. App config version
sedi "s|version: '[^']*'|version: '${VERSION}'|g" index.html

# 2. CDN base path
sedi "s|/gh/[a-zA-Z0-9_.-]*/[a-zA-Z0-9_.-]*@|/gh/${OWNER}/${REPO}@|g" index.html

# 3. ★ FIX: Literal @VERSION placeholder (from unprocessed HTML template)
sedi "s|@VERSION|@${VERSION}|g" index.html

# 4. Version in URLs (catches @v1.0.0, @v80a996660568, @v1.0.1 etc.)
sedi "s|@[vV]*[0-9a-fA-F.]*[0-9]*/|@${VERSION}/|g" index.html

# 5. Integrity attributes
for f in "${!SRI[@]}"; do
  sri="${SRI[$f]:-}"
  [ -n "$sri" ] || continue
  fname=$(basename "$f")
  if [[ "$f" == *.css ]]; then
    # CSS: match on the <link rel="stylesheet"> line range
    sedi "/<link rel=\"stylesheet\"/,/crossorigin=/ s|integrity=\"[^\"]*\"|integrity=\"${sri}\"|" index.html
  elif [[ "$f" == *.js ]]; then
    # ★ FIX: JS uses src= line as range start (not <script line)
    sedi "/src=[^>]*${fname}/,/crossorigin=/ s|integrity=\"[^\"]*\"|integrity=\"${sri}\"|" index.html
  fi
done


# 6. sriHashes inside __APP_CONFIG__
for f in "${!SRI[@]}"; do
  sri="${SRI[$f]:-}"
  [ -n "$sri" ] || continue
  fname=$(basename "$f")
  sedi "/'${fname}':/ s|'sha384-[^']*'|'${sri}'|g" index.html
done

# 7. Fallbacks
sedi "s|gcore\.jsdelivr\.net/gh/[^@]*@[^/]*|gcore.jsdelivr.net/gh/${OWNER}/${REPO}@${VERSION}|g" index.html
sedi "s|fastly\.jsdelivr\.net/gh/[^@]*@[^/]*|fastly.jsdelivr.net/gh/${OWNER}/${REPO}@${VERSION}|g" index.html


# ============ DIFF SUMMARY ============
echo ""
echo "📝 Changes:"
echo "─────────────────────────────────────────────"
diff -u index.html.bak index.html \
  | grep '^[+-]' \
  | grep -v '^---\|^+++' \
  | head -60 || true
echo "─────────────────────────────────────────────"
rm -f index.html.bak

echo ""
echo "✅ Built & updated → ${OWNER}/${REPO}@${VERSION}"
echo ""
echo "SRI_OWNER=${OWNER}"
echo "SRI_REPO=${REPO}"
echo "SRI_VERSION=${VERSION}"