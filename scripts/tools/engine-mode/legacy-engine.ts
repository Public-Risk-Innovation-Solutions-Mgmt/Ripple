// ============================================================================
// THE OLD ENGINE, FOR THIS PROCESS ONLY — imported FIRST by a gate that tests
// it, before anything that reads a flag.
//
// Loss engine commit 3 made the new engine permanent with no members. Gates
// that test the OLD engine run through the game — its per-claim generators,
// its per-claim development walk, today's shock placeholders — switch back to
// it here: NEW_LOSS_ENGINE off, MEMBER_LEVEL and RISK_CONTROL on, which is the
// engine exactly as it ran at the legacy-engine branch (b234c36). Every gate
// runs in its own process, so nothing else sees the switch.
//
// TWO KINDS OF GATE IMPORT IT, and they part company at commit 3b:
//
//   RETIRE   the gate tests a mechanism of the old engine itself (the
//            per-claim register and its redraw, the claim-level programs, the
//            old tower and shock placeholders). It stays green here until 3b
//            deletes the old engine's branches, and goes with them. The
//            legacy-engine branch keeps it, and the engine it tests, runnable.
//
//   MEMBER   the gate tests member-level code that is KEPT (member-level play
//            may return), but whose per-member losses only the old per-claim
//            generators draw — on the new engine a member's losses are its
//            exposure share and these gates' claims do not hold. Whether the
//            member path keeps those generators is put to the owner before
//            3b; until then it runs here, green.
//
// Gates that pass on the new engine with members switched on import
// member-path.ts instead.
// ============================================================================
import { MEMBER_LEVEL, NEW_LOSS_ENGINE, RISK_CONTROL } from '../../../src/data/pricingParameters';

NEW_LOSS_ENGINE.enabled = false;
MEMBER_LEVEL.enabled = true;
RISK_CONTROL.enabled = true;
