// THE ROOM MARKET SHARE WITH A TEAM THAT STOPS — room-market-share.cjs, with
// Tri-County locking in year 1 and nothing after. A team that does not lock in
// a year counts as stopped: nobody waits for it, and its last reported figures
// stay in the totals until the game ends.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/room-market-share-stop.cjs
process.env.ROOM_SHARE_STOP = '1';
require('./room-market-share.cjs');
