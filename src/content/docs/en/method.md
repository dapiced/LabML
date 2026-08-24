---
slug: methode
kind: explanation
order: 2
title: The method choices, and why
summary: Why a baseline before anything else, why intervals instead of one figure, why seed 42 everywhere, and why everything runs locally.
---

This page does not say how to do something — it says why LabML does it this
way. If you are looking for a task, go to the
[how-to guides](/docs/scorer-un-lot) instead.

## Why a baseline before anything else

An absolute score means nothing. On titanic the majority class holds 62% of the
rows: a model that always answers « did not survive » scores **61.8%** without
having learned anything.

That is why the naive baseline is trained, ranked and displayed like the
others, on the last row. It is not decorative: it is the **yardstick**. A model
at 79.2% is not « 79% good », it is **17.4 points above what zero learning
costs**. That number is what says whether training was worth anything.

Without it, an imbalanced dataset produces flattering scores that get published
in good faith.

## Why intervals instead of a single figure

Titanic's test set is 178 rows. An accuracy of 0.792 over 178 rows is not
0.792: it is a draw. Another sample of 178 people would have given something
else.

So LabML resamples the test set 1,000 times and recomputes the metric each
time. The interval shown is where it lands 95 times out of 100.

**A wide interval is information, not a defect.** It says: over this few rows,
that figure is soft. Two models whose intervals overlap heavily are not
separated by their score difference — and the panel says so in plain words
rather than implying a hierarchy.

The draws are **paired** across models: the same resampling serves them all, so
comparisons are over the same rows.

One limit, stated rather than buried: these intervals measure sensitivity **to
the test draw**, not training variance. Retraining on another split would be a
different source of variation, which the panel does not measure.

## Why seed 42, everywhere

Everything that draws at random in LabML — the split, initialisation,
subsamples, hyperparameter search, the bootstrap, the isolation forest — starts
from the same fixed seed.

This is not a convenience detail. It is what makes everything else possible:

- **You get the documentation's numbers.** The tutorial announces 0.792 and a
  test checks it on every build. Without a fixed seed that sentence would be
  unverifiable.
- **Two runs are comparable.** The comparison page can attribute a gap to what
  you changed rather than to chance.
- **An exported model replays.** The recipe and the manifest are enough to
  reproduce the result.

The price is real and worth saying: a single draw is not a variance study. That
is exactly why the intervals exist, and why 5×2 ranking is offered when you
want to know whether the order holds.

## Why everything runs locally

Your file does not leave. This is not a privacy policy, it is a property of the
architecture: there is no server that could receive it.

The [/privacy](/privacy) page details what crosses the network and what does
not, with what you need to check it yourself in the Network tab — this page
does not repeat it, because two texts on the same subject diverge sooner or
later, and it is the forgotten one that survives.

What is worth saying here are the **consequences** of that choice, because they
show up throughout the product:

- Models are self-hosted and their weight is announced before any download —
  18.5 MB for vision, 355 MB for the language model, on explicit consent.
- The SQL engine is single-threaded: LabML does not serve the COOP/COEP headers
  that would unlock multi-threading, because they would break other things.
- A named memory guard stops reading an oversized file and says so, rather than
  killing the tab.
- The models are hand-written: nothing calls a remote library.

## Where to go next

- [What LabML does not do](/docs/limites) — the limits, and why.
- [Reading a learning curve](/docs/lire-une-courbe) — the method applied to one precise question.
- The [ML Lab reference](/docs/reference-ml) for the detail of each panel.
