# Fight Engine parser notes

Last updated: 2026-08-03

## Current encounter rules

- An encounter starts on recognized incoming or outgoing hostile activity.
- Player melee, spell, damage-over-time, and damage-shield damage count toward
  player damage and DPS.
- Misses and incoming attacks can start or keep an encounter alive without
  adding damage.
- Targets observed during continuous combat are retained as adds in the same
  encounter.
- A fight completes when all known targets are slain, the player dies, the
  player zones, or ten seconds pass without recognized combat activity.
- Timeout fights end at the last real combat activity; the ten-second detection
  window is not added to the displayed duration or used to lower final DPS.
- Completed snapshots retain targets, defeated targets, total damage, best hit,
  duration, DPS, timestamps, and the end reason.

## Auto-attack reminder

- A fresh incoming hostile action starts a two-second grace window when auto
  attack is not known to be on.
- Turning auto attack on, successfully Feigning Death, or completing the fight
  cancels the pending warning.
- Outgoing spell or ability damage alone does not trigger the warning.

## August 2 real-log replay

- Replayed all 63,221 lines from Whittler's Neriak session.
- Native `punches YOU` and `strikes YOU` melee lines now count as incoming
  hostile activity.
- Enemy spell and damage-over-time lines in the `You have taken ... by ...`
  shape now start or maintain encounters and the auto-attack reminder.
- Incoming thorns/flames damage now counts as hostile activity.
- Player swings that are dodged, parried, or blocked and incoming swings that
  the player dodges, parries, ripostes, or blocks now maintain the fight.
- The replay currently yields 358 encounters: 262 victories, 94 timeouts, and
  2 player deaths. Ninety-one encounters contain multiple tracked targets.

## Real-log validation still needed

The Enchanter control-state rules must be driven by captured EQL lines. Add the
exact mez success, mez break, resist, root, charm, and target-wake messages here
before teaching the Fight Engine to suppress warnings for controlled mobs. Do
not guess these strings from classic EverQuest logs.
