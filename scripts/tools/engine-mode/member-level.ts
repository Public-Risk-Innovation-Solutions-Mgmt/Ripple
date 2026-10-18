// ============================================================================
// THE MEMBER PATH, FOR THIS PROCESS ONLY — imported FIRST by a gate that tests
// member-level code, before anything that reads a switch.
//
// The game runs with no individual members (MEMBER_LEVEL off) and KEEPS the
// member code, because member-level play may return: the roster, the
// membership engine, member premium, the experience modifier, risk quality,
// rating groups, departure, per-member satisfaction, and the per-claim
// generators that give each member its own claims. RISK_CONTROL comes on with
// it, because risk control's programs act inside those generators. The member
// path runs with no shocks: the old shock placeholders were deleted at loss
// engine commit 3b.
//
// Every gate runs in its own process, so nothing else sees the switch. The old
// engine as a whole — its shocks included — is frozen on the legacy-engine
// branch (b234c36).
// ============================================================================
import { MEMBER_LEVEL, RISK_CONTROL } from '../../../src/data/pricingParameters';

MEMBER_LEVEL.enabled = true;
RISK_CONTROL.enabled = true;
