#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:?work dir required}"
SHERPA="$WORK/sources/sherpa-onnx"
DL="$WORK/downloads"
GEN="$WORK/generated"
mkdir -p "$GEN"

build_one() {
  local kind="$1" out="$2"
  rm -rf "$SHERPA/wasm/vad-asr/assets" "$SHERPA/build-wasm-simd-vad-asr"
  mkdir -p "$SHERPA/wasm/vad-asr/assets"
  cp "$DL/silero_vad.onnx" "$SHERPA/wasm/vad-asr/assets/silero_vad.onnx"
  local tmp="$WORK/model-$kind"; rm -rf "$tmp"; mkdir -p "$tmp"
  if [[ "$kind" == primary ]]; then
    tar -xjf "$DL/sherpa-onnx-zipformer-ja-en-reazonspeech-2025-01-17.tar.bz2" -C "$tmp"
    cp "$(find "$tmp" -name 'encoder-*.int8.onnx' -print -quit)" "$SHERPA/wasm/vad-asr/assets/transducer-encoder.onnx"
    cp "$(find "$tmp" -name 'decoder-*.int8.onnx' -print -quit)" "$SHERPA/wasm/vad-asr/assets/transducer-decoder.onnx"
    cp "$(find "$tmp" -name 'joiner-*.int8.onnx' -print -quit)" "$SHERPA/wasm/vad-asr/assets/transducer-joiner.onnx"
    cp "$(find "$tmp" -name tokens.txt -print -quit)" "$SHERPA/wasm/vad-asr/assets/tokens.txt"
  else
    tar -xjf "$DL/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8.tar.bz2" -C "$tmp"
    cp "$(find "$tmp" -name model.int8.onnx -print -quit)" "$SHERPA/wasm/vad-asr/assets/nemo-ctc.onnx"
    cp "$(find "$tmp" -name tokens.txt -print -quit)" "$SHERPA/wasm/vad-asr/assets/tokens.txt"
  fi
  (cd "$SHERPA" && ./build-wasm-simd-vad-asr.sh)
  rm -rf "$out"; mkdir -p "$out"
  local src="$SHERPA/build-wasm-simd-vad-asr/install/bin/wasm/vad-asr"
  cp "$src/sherpa-onnx-asr.js" "$src/sherpa-onnx-vad.js" "$src/sherpa-onnx-wasm-main-vad-asr.js" "$src/sherpa-onnx-wasm-main-vad-asr.wasm" "$src/sherpa-onnx-wasm-main-vad-asr.data" "$out/"
}

build_one primary "$GEN/sherpa"
build_one pja "$GEN/sherpa-pja"
