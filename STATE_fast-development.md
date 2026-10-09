# State — `feature/fast-development`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**.

**Cut from:** `feature/risk-control` at `b0fd991` (2026-10-09), its head when cut.
**Repository:** `Public-Risk-Innovation-Solutions-Mgmt/Ripple`. If `git remote -v` reads
`JanderAct/insurance-game-testingv2` on fetch or push, set both to Ripple before anything else — the old
URL redirects, so a fetch through it succeeds and looks right.

---

## What this branch is for

**Compressing claim development so a five-year game can see it.** Workers' Comp from about ten years to
five, General Liability to three or four, Property to two.

⚠ **A PLAYABILITY CHOICE, NOT A REALISM ONE.** Real WC develops for decades. The point is that a five-year
session cannot show ten-year development — everything that matters happens after the game ends. Anything
built here should say so at its constants, so nobody later "corrects" the development back to realism
without knowing why it was compressed.

## Status

**MEASUREMENT ONLY. Nothing on this branch changes the engine yet.** The first round reads what
"development" means per line today, measures a compressed game against today's in a scratch copy, and
works out what compression would break. Findings are recorded below as they land.

## The two pieces of work this pulls on, in opposite directions

- **Underwriting (`feature/uw-decisions`).** Pricing catches up slowly — about 55% on WC by year ten —
  because the pricing triangle takes ten years to mature. Faster development should mean faster
  experience.
- **Risk control (`feature/risk-control`).** The programmes give their saving back as lower premium once
  the pricing window learns the lower cost — 7% at three years, 42% at ten. Faster development means it
  learns sooner, so more is given back.

The balance between the two is part of what this branch is to establish.

## Do not touch

`aws`, `feature/uw-decisions`, `demo-2026-09`, `demo-multiplayer-2026-09`, `demo-video-2`.

---

## Findings

*(none yet — the first measurement round is in progress)*
