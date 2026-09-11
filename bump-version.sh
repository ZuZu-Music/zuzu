#!/usr/bin/env bash
# Cache-bust the CSS/JS links before a deploy.
# GitHub Pages serves max-age=600 with no content hashing, so without a version
# query a push can take up to 10 minutes to reach people who already have the
# page cached. Run this before committing whenever styles.css or script.js change.
set -euo pipefail
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d%H%M)
sed -i '' -E "s|href=\"styles\.css(\?v=[0-9]+)?\"|href=\"styles.css?v=$V\"|" index.html
sed -i '' -E "s|src=\"script\.js(\?v=[0-9]+)?\"|src=\"script.js?v=$V\"|" index.html
echo "cache-bust version -> $V"
