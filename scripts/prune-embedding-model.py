#!/usr/bin/env python3
"""Build the Latin-script variant of the multilingual embedding model (ADR-200).

The upstream model's 250 002-piece vocabulary is most of what it costs in
memory: on an iPhone the full model added ~0.9–1 GB to Obsidian's web process
and got it killed at the ~2 GB per-process limit. About half of those pieces
are for scripts a Latin-script vault never uses (CJK, Arabic, Devanagari, Thai,
Cyrillic, Greek, …). This script drops them — from the tokenizer AND from the
model's embedding table — and writes a model that is a drop-in for Pythia's
`feature-extraction` pipeline (dtype `q8`, device `wasm`).

Why the result is EXACT for Latin-script text: a unigram tokenizer segments a
string into pieces of its vocabulary, and a Latin-script string can only ever be
segmented into Latin/common pieces — which are all kept. Same segmentation, same
ids after the remap, same rows in the table, same vector. Text in other scripts
falls back to single characters (kept) and degrades gracefully instead of
producing <unk>. `scripts/verify-pruned-model.mjs` checks the claim.

The rule is SCRIPT-based, not vault-based: pruning to the pieces one vault uses
was tried and is not exact (new Italian/Spanish sentences fell to cosine 0.44).

Usage:
  python3 scripts/prune-embedding-model.py [--out dist-models/latin] [--src <dir>]

Requires: pip install onnx numpy. Downloads the upstream files (Apache-2.0)
when --src is not given. Output: a folder ready to upload to Hugging Face —
config.json, tokenizer.json, tokenizer_config.json, special_tokens_map.json,
onnx/model_quantized.onnx, README.md (the model card).
"""
import argparse
import copy
import json
import os
import sys
import unicodedata
import urllib.request

import numpy as np
import onnx
from onnx import numpy_helper

UPSTREAM = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx"]
EMBEDDING_TENSOR = "embeddings.word_embeddings.weight_quantized"


def keep_piece(piece: str) -> bool:
    """A piece survives when every character is Latin, or script-neutral
    (digits, punctuation, symbols, whitespace, marks, the ▁ word boundary) —
    or when it is a single character of ANY script, so text the variant does
    not cover still segments to characters rather than to <unk>."""
    if len(piece.replace("\u2581", "")) <= 1:
        return True
    for ch in piece:
        if ch == "▁":
            continue
        cat = unicodedata.category(ch)
        if cat[0] in "PNSZC" or cat in ("Lm", "Mn"):
            continue
        if not unicodedata.name(ch, "").startswith("LATIN"):
            return False
    return True


def fetch(src: str, out: str) -> None:
    for f in FILES:
        dst = os.path.join(out, f)
        if os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        url = f"https://huggingface.co/{src}/resolve/main/{f}"
        print(f"  fetching {url}", file=sys.stderr)
        urllib.request.urlretrieve(url, dst)


def remap_post_processor(pp, remap):
    if not pp:
        return
    if pp.get("type") == "Sequence":
        for x in pp["processors"]:
            remap_post_processor(x, remap)
    for v in (pp.get("special_tokens") or {}).values():
        v["ids"] = [remap[i] for i in v["ids"]]
    for k in ("cls", "sep"):
        if k in pp:
            pp[k] = [pp[k][0], remap[pp[k][1]]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dist-models/latin")
    ap.add_argument("--src", help="folder holding the upstream files (downloaded when omitted)")
    args = ap.parse_args()

    src = args.src or os.path.join("dist-models", "upstream")
    if not args.src:
        os.makedirs(src, exist_ok=True)
        fetch(UPSTREAM, src)

    tok = json.load(open(os.path.join(src, "tokenizer.json"), encoding="utf-8"))
    vocab = tok["model"]["vocab"]
    keep = sorted({i for i, (piece, _) in enumerate(vocab) if keep_piece(piece)}
                  | {a["id"] for a in tok["added_tokens"]}
                  | {tok["model"]["unk_id"]})
    remap = {old: new for new, old in enumerate(keep)}

    out_tok = copy.deepcopy(tok)
    out_tok["model"]["vocab"] = [vocab[o] for o in keep]
    out_tok["model"]["unk_id"] = remap[tok["model"]["unk_id"]]
    for a in out_tok["added_tokens"]:
        a["id"] = remap[a["id"]]
    remap_post_processor(out_tok.get("post_processor"), remap)

    os.makedirs(os.path.join(args.out, "onnx"), exist_ok=True)
    with open(os.path.join(args.out, "tokenizer.json"), "w", encoding="utf-8") as f:
        json.dump(out_tok, f, ensure_ascii=False)
    for name in ("tokenizer_config.json", "special_tokens_map.json"):
        with open(os.path.join(src, name), encoding="utf-8") as i, open(os.path.join(args.out, name), "w", encoding="utf-8") as o:
            o.write(i.read())
    cfg = json.load(open(os.path.join(src, "config.json"), encoding="utf-8"))
    cfg["vocab_size"] = len(keep)
    json.dump(cfg, open(os.path.join(args.out, "config.json"), "w"), indent=2)

    model = onnx.load(os.path.join(src, "onnx", "model_quantized.onnx"))
    hit = False
    for i, init in enumerate(model.graph.initializer):
        if init.name == EMBEDDING_TENSOR:
            table = numpy_helper.to_array(init)
            if table.shape[0] < len(vocab):
                print(f"embedding table has {table.shape[0]} rows, vocab {len(vocab)}", file=sys.stderr)
                return 1
            # Per-tensor quantization (one scale, one zero point): slicing rows
            # changes no value. Assert it, so a future per-channel export fails
            # loudly instead of producing a model that is quietly wrong.
            scales = [x for x in model.graph.initializer if x.name == "embeddings.word_embeddings.weight_scale"]
            if scales and numpy_helper.to_array(scales[0]).size != 1:
                print("embedding table is not per-tensor quantized; row slicing would be wrong", file=sys.stderr)
                return 1
            model.graph.initializer[i].CopyFrom(numpy_helper.from_array(np.ascontiguousarray(table[keep]), init.name))
            hit = True
    if not hit:
        print(f"tensor {EMBEDDING_TENSOR} not found", file=sys.stderr)
        return 1
    onnx.save(model, os.path.join(args.out, "onnx", "model_quantized.onnx"))

    with open(os.path.join(args.out, "README.md"), "w", encoding="utf-8") as f:
        f.write(MODEL_CARD.format(kept=len(keep), total=len(vocab)))

    size = os.path.getsize(os.path.join(args.out, "onnx", "model_quantized.onnx")) / 1e6
    print(json.dumps({"kept": len(keep), "of": len(vocab), "onnxMB": round(size, 1), "out": args.out}))
    return 0


MODEL_CARD = """---
license: apache-2.0
base_model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
library_name: transformers.js
pipeline_tag: feature-extraction
tags: [sentence-similarity, onnx, latin-script, mobile]
---

# paraphrase-multilingual-MiniLM-L12-v2 — Latin-script vocabulary

[Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
(the ONNX export of
[sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2))
with its vocabulary cut from {total} to {kept} pieces: every piece written in Latin
script or script-neutral characters is kept; pieces containing CJK, Arabic,
Devanagari, Thai, Cyrillic, Greek and other scripts are removed, from the
tokenizer and from the model's embedding table alike. Nothing else changes —
the transformer layers are byte-identical.

**For text in any Latin-script language the output vectors are identical to the
full model's** (same segmentation, same rows), verified at cosine 1.0000 over
408 German, English, Italian, Spanish and French texts. Text in other scripts
segments to single characters and degrades gracefully.

Why: the full model's 250k-piece vocabulary costs ~1 GB of memory in a mobile
WebView (measured: an iPhone killed the host process at its 2 GB limit). This
variant loads in ~370–400 MB. Built for the Obsidian plugin
[Pythia](https://github.com/smsag/pythia) by
[`scripts/prune-embedding-model.py`](https://github.com/smsag/pythia/blob/main/scripts/prune-embedding-model.py),
which reproduces it from the upstream files. Only the `q8` (`model_quantized.onnx`)
weights are published.

Licensed Apache-2.0 like the original; the original authors' work, credited above,
is unchanged by this pruning.
"""

if __name__ == "__main__":
    sys.exit(main())
