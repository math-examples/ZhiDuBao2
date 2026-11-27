#!/usr/bin/env bash
# setup.sh — esbuild + SRI + CDN updater for 指读宝 (CI-safe, SRI-correct)
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

# Version resolution
if [ -n "${3:-}" ]; then
  VERSION="$3"
  [[ "$VERSION" == v* ]] || VERSION="v${VERSION}"
else
  # Hash-based version from built output (deterministic)
  FILE_LIST=()
  [ -d css ] && while IFS= read -r -d '' f; do FILE_LIST+=("$f"); done < <(find css -type f -name '*.css' -print0 | sort -z)
  [ -d js ] && while IFS= read -r -d '' f; do FILE_LIST+=("$f"); done < <(find js -type f -name '*.js' -print0 | sort -z)

  if [ ${#FILE_LIST[@]} -gt 0 ] && cat "${FILE_LIST[@]}" >/dev/null 2>&1; then
    RAW_HASH=$(cat "${FILE_LIST[@]}" | openssl dgst -sha256 | grep -o '[a-f0-9]\{64\}')
    if [ -n "$RAW_HASH" ] && [ "$RAW_HASH" != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
      VERSION="v${RAW_HASH:0:12}"
    fi
  fi
  [ -z "${VERSION:-}" ] && VERSION="v$(date -u +%Y%m%d%H%M%S)"
fi

echo "🔐 Owner:   ${OWNER}"
echo "🔐 Repo:    ${REPO}"
echo "🔐 Version: ${VERSION}"

# ============ INSTALL & BUILD ============
BUILD_DIR="dist"

if [ ! -f "package.json" ]; then
  echo "❌ package.json not found" >&2
  exit 1
fi

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

# Clean dist to prevent stale hash from old build
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/css"

echo "📦 Building with esbuild..."
npx esbuild js/main.js \
  --bundle \
  --minify \
  --sourcemap \
  --format=esm \
  --target=es2020 \
  --outfile="${BUILD_DIR}/main.js"

# ✅ Freshness check
if [ ! -f "${BUILD_DIR}/main.js" ]; then
  echo "❌ esbuild failed: ${BUILD_DIR}/main.js not produced" >&2
  exit 1
fi

BUILD_TIME=$(stat -c %Y "${BUILD_DIR}/main.js" 2>/dev/null || stat -f %m "${BUILD_DIR}/main.js")
SCRIPT_TIME=$(stat -c %Y "js/main.js" 2>/dev/null || stat -f %m "js/main.js")
if [ "$BUILD_TIME" -lt "$SCRIPT_TIME" ]; then
  echo "  ❌ dist/main.js is OLDER than js/main.js — build did not refresh!" >&2
  exit 1
fi

# ✅ Copy CSS AFTER build
if [ -f "css/app.css" ]; then
  cp css/app.css "${BUILD_DIR}/css/app.css"
elif [ -f "css/style.css" ]; then
  cp css/style.css "${BUILD_DIR}/css/app.css"
else
  echo "❌ No CSS source file found" >&2
  exit 1
fi

echo "  ✅ ${BUILD_DIR}/main.js"
echo "  ✅ ${BUILD_DIR}/css/app.css"

# ============ GENERATE SRI HASHES (FINAL FILES ONLY — no source files) ============
echo "🔐 Generating SRI hashes..."

SRI_MAIN=$(openssl dgst -sha384 -binary "${BUILD_DIR}/main.js" | openssl base64 -A)
SRI_CSS=$(openssl dgst -sha384 -binary "${BUILD_DIR}/css/app.css" | openssl base64 -A)

SRI_MAIN_FULL="sha384-${SRI_MAIN}"
SRI_CSS_FULL="sha384-${SRI_CSS}"

echo "  ✅ main.js → ${SRI_MAIN_FULL:0:30}..."
echo "  ✅ app.css → ${SRI_CSS_FULL:0:30}..."

# ============ UPDATE index.html ============
if [ ! -f index.html ]; then
  echo "❌ index.html not found" >&2
  exit 1
fi

cp index.html index.html.bak

if [[ "${OSTYPE:-}" == darwin* ]]; then
  sedi() { sed -i '' "$@"; }
else
  sedi() { sed -i "$@"; }
fi

# 1. Version in ALL URLs (catches @v1.0.0, @v1.0.1, @vHASH etc.)
sedi "s|@[vV][0-9a-fA-F.]*[0-9]*/|@${VERSION}/|g" index.html
sedi "s|@v[0-9a-fA-F]*[0-9]*/|@${VERSION}/|g" index.html

# 2. CDN base path (catches /gh/owner/repo@ patterns)
sedi "s|/gh/[a-zA-Z0-9_.-]*/[a-zA-Z0-9_.-]*@|/gh/${OWNER}/${REPO}@|g" index.html

# 3. Rewrite fallback CDN URLs inside onerror handlers
sedi "s|gcore\.jsdelivr\.net/gh/[^']*@[^/]*/|gcore.jsdelivr.net/gh/${OWNER}/${REPO}@${VERSION}/|g" index.html
sedi "s|fastly\.jsdelivr\.net/gh/[^']*@[^/]*/|fastly.jsdelivr.net/gh/${OWNER}/${REPO}@${VERSION}/|g" index.html

# 4. Inject SRI hashes (only into final served files)
sedi "/<link rel=\"stylesheet\"/,/crossorigin=/ s|integrity=\"[^\"]*\"|integrity=\"${SRI_CSS_FULL}\"|" index.html
sedi "/src=[^>]*main\.js/,/crossorigin=/ s|integrity=\"[^\"]*\"|integrity=\"${SRI_MAIN_FULL}\"|" index.html

# ============ VERIFY ============
echo ""
echo "🔍 Verifying SRI hashes match files..."
ACTUAL_MAIN=$(openssl dgst -sha384 -binary "${BUILD_DIR}/main.js" | openssl base64 -A)
ACTUAL_CSS=$(openssl dgst -sha384 -binary "${BUILD_DIR}/css/app.css" | openssl base64 -A)

if [ "sha384-${ACTUAL_MAIN}" = "${SRI_MAIN_FULL}" ] && [ "sha384-${ACTUAL_CSS}" = "${SRI_CSS_FULL}" ]; then
  echo "  ✅ SRI hashes verified"
else
  echo "  ❌ SRI hash mismatch!" >&2
  exit 1
fi

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