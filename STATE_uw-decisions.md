# State — `feature/uw-decisions`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**. `STATE_member-satisfaction.md` came in with the base and describes that branch, not this one.

**Cut from:** `feature/risk-control` at `b0fd991` (2026-10-09). Pushed bare before anything landed on it.

---

## What this branch is for

Measurements, and probably a redesign, of **both underwriting controls**: New Business Appetite (who
gets in) and Renewal Underwriting (who stays). It exists so `feature/risk-control` stays deployable while
that work is in flight.

The first question it carries is whether New Business Appetite should select on **risk quality**
(a bar on what kind of applicant) instead of on the applicant's own loss run, and underneath that,
whether any underwriting setting can give growth a cost. As of the cut, growth costs nothing, so the
default appetite beats every stricter one.

## Merge back early

**This branch merges back into `feature/risk-control` early and often, not once at the end.**

The property branch diverged for three weeks and its merge took four hours. Take
`feature/risk-control` into this branch whenever it moves. Merge this one back as soon as each
measurement or control change is complete and both baselines are green, rather than holding a finished
piece of work for the whole redesign.

## Not this branch's to touch

`aws`, `demo-2026-09`, `demo-multiplayer-2026-09`, `demo-video`, `demo-video-2`.

## Remote

`origin` must read `Public-Risk-Innovation-Solutions-Mgmt/Ripple` for **both** fetch and push. It has
repeatedly reverted to `JanderAct/insurance-game-testingv2`. That URL redirects, so a fetch through it
succeeds and looks correct. Check `git remote -v` before any git operation.
