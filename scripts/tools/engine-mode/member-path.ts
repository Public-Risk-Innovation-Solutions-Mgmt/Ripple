// ============================================================================
// THE MEMBER PATH, FOR THIS PROCESS ONLY — imported FIRST by a gate that tests
// member-level code, before anything that reads a flag.
//
// Loss engine commit 3 runs the game with no individual members, and KEEPS the
// member code — the roster, the membership engine, member premium, the
// experience modifier, risk quality, rating groups, departure and per-member
// satisfaction — because member-level play may return. The gates that test it
// switch MEMBER_LEVEL on here, on the new loss engine, so the code keeps
// compiling and stays correct instead of rotting. Every gate runs in its own
// process, so nothing else sees the switch.
// ============================================================================
import { MEMBER_LEVEL } from '../../../src/data/pricingParameters';

MEMBER_LEVEL.enabled = true;
