# Fight Engine parser notes

Last updated: 2026-08-04

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

- A fresh incoming hostile action starts a three-second grace window when auto
  attack is not known to be on.
- Turning auto attack on, successfully Feigning Death, or completing the fight
  cancels the pending warning.
- Outgoing spell or ability damage alone does not trigger the warning.
- Beginning a player spell cast pauses an already-pending warning for five
  seconds so intentional casting is not treated as forgotten auto attack.
- A confirmed player mez extends that pause to seven seconds. Continued casting
  or mezzing renews it; the warning returns if hostile combat continues after
  control activity stops and auto attack remains off.
- A mez result from another player does not suppress the warning.

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

## August 3 Enchanter log replay

- Replayed all 64,543 lines from Whittler's Rogue/Druid/Enchanter session.
- Captured native player cast (`You begin casting ...`) and successful mez
  (`<target> has been mesmerized.`) shapes.
- Also captured mez interruption, wear-off, and overwrite shapes for future
  per-target control tracking.
- The replay yields 373 encounters: 284 victories, 88 timeouts, and 1 zone
  ending. Fifty-eight encounters contain multiple tracked targets.
- Cast and control events affect warning suppression only; they do not create
  encounters or alter DPS calculations.

## August 4 morning log replay

- Replayed all 13,058 lines from Whittler's morning Neriak session.
- Captured `has been enthralled` as a second native successful-mez result shape;
  the previous detector recognized only `has been mesmerized`.
- Tashani commonly landed within one second and Tepid Deeds commonly began
  about three seconds later, so the generic casting pause was extended to five
  seconds to cover the normal debuff sequence without silencing the reminder.
- Extended the initial warning grace to three seconds and the confirmed-control
  pause to seven seconds to remove brief alarm chirps during target setup.
- Each new warning now appends a timestamped `==FART==` diagnostic marker to
  the selected log. The marker is ignored by combat parsing and written only
  once per continuous warning, even though the alarm audio loops.
