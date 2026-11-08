#!/usr/bin/env bash
# 没有 Xcode 也能跑：用 swiftc 把 DuskCore 和冒烟测试编译成一个小程序执行。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/.build/corecheck"
mkdir -p "$BUILD/tmp" "$BUILD/modulecache"

export TMPDIR="$BUILD/tmp"
export CLANG_MODULE_CACHE_PATH="$BUILD/modulecache"

swiftc \
  -module-cache-path "$BUILD/modulecache" \
  -o "$BUILD/corecheck" \
  "$ROOT"/Packages/DuskCore/Sources/DuskCore/*.swift \
  "$ROOT"/Scripts/CoreCheck/main.swift

"$BUILD/corecheck"
