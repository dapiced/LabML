---
slug: reference-ai
kind: reference
order: 4
title: Reference — Vision and assistant
summary: The vision playground's three networks, the assistant's two interpreters, and what each refuses to do.
---

## Vision

:::try /ai/vision | Open the vision playground

Three self-hosted models, **18.5 MB in total**, executed by ONNX Runtime Web in
WebAssembly, single-threaded. The image never leaves the tab.

| Model                   | Size    | Role                                              |
| ----------------------- | ------- | ------------------------------------------------- |
| EfficientNet-Lite4 int8 | 13.6 MB | classification over the 1,000 ImageNet-1k classes |
| YOLOX-Nano              | 3.7 MB  | object detection over the 80 COCO classes         |
| UltraFace RFB-320       | 1.3 MB  | face location — never identification              |

Preparation: a 224² centre crop for the classifier, a gray 416² letterbox for
YOLOX (BGR order, raw 0–255 values), a 320×240 letterbox for UltraFace. The box
decoding — grids, IoU, non-maximum suppression — is hand-written and unit-tested.

Thresholds: **0.35** for objects, **0.90** for faces.

### The honest verdict

ImageNet-1k has 1,000 labels, 118 dog breeds, and **none for a human being**. A
softmax cannot abstain. The refusal therefore comes from outside the classifier,
through two rules:

1. **Human subject** — the object detector finds a person **and** the face
   detector finds a face. Requiring both is measured: YOLOX draws « person » on
   a wine bottle and on a sports car, and UltraFace finds no face on either.
2. **Confidence floor at 50%** — below it, the top classes are near-ties.

Rule 1 wins over rule 2. The label is never hidden, only framed.

## Data assistant

:::try /ai/chat | Open the assistant

Two interpreters, **in this order**: the deterministic one first, the language
model only on what it refuses.

### The deterministic interpreter

A lexicon-based FR/EN parser producing a typed query executed by the V6 engine.
It computes exactly: mean, median, min/max, sum, count under a condition, top N,
group-by, correlation, table shape.

**It checks its own coverage.** Every word of the question must be accounted for
by a lexicon phrase, a column the answer uses, a value it filters on, or one of
three closed lists (the table's own furniture, generic row nouns, grammatical
filler). A leftover word is a refusal.

That is what fixed the costliest defect measured: « how many women? » answered
891 instead of 314 — the grammar knew « how many », knew nothing about
« women », kept the count and dropped the condition. The trade is
one-directional: an unknown word can cost a refusal where an answer was
possible, never a wrong answer where a refusal was right.

### The local language model

Qwen3-0.6B-DQ q4f16, Apache-2.0, **355 MB**, downloaded on explicit consent with
the weight announced, split into < 25 MiB parts and reassembled in the browser
with an integrity check.

**The model is never allowed to compute.** It translates the question into a
query; every number comes from the deterministic engine.

Decoding is **constrained** by an automaton over the query grammar, masking at
every token everything that would leave it. It walks UTF-8 **bytes**, not
characters: the vocabulary is byte-level BPE and 1,457 of its 151,669 tokens are
fragments of a character — a character-level automaton would have made
« Île-de-France » unwritable as a filter value.

The grammar keeps `{"kind":"none"}` reachable: a shape whose only meaning is « I
cannot express this ». Without it, constraining the output turns refusals into
confident errors — measured: +7 wrong answers.

### What the bench measures

55 reference questions, French and English, replayed against the real weights.
The app went from **33 right / 15 wrong** to **42 right / 7 wrong**, for 0 MB. A
model four times larger (1.43 GB) measured **worse**: 40 right / 12 wrong.
