# Plinkified EQL Command Center

## Official Development Log

Current Version: v0.8a

Status: Active Development

Last Updated: 2026-07-26

# Development Session 002
Date: 2026-07-26

## Completed

- Installed Node.js and npm
- Configured Electron development environment
- Created Electron + React + TypeScript project
- Successfully launched the first desktop application
- Removed Vite starter UI
- Created the initial Plinkified EQL desktop screen
- Removed default template CSS

## Milestone

The project now exists as a native Electron desktop application.

## Next Session

- Rename project metadata
- Remove remaining template assets
- Organize project folder structure
- Create reusable React component architecture
- Begin rebuilding the HTML prototype as React components

## v0.9 Development Progress

Implemented:
- Shared PEQL session architecture
- Adventure Journal framework
- Adventure Journal live session data
- Fight history navigation
- Session-aware statistics
- OH SHIT marker button
- Live DPS improvements
- Session line tracking

Design Notes:
- Dashboard evolving into Combat page
- Adventure Journal now consumes shared session state
- Future overlay will read from the same shared session

# Development Session 003
Date: 2026-08-03

## Fight Engine foundation

- Extracted combat parsing and encounter state from `DashboardPage` into a
  standalone, testable Fight Engine.
- Moved Fight Engine ownership into the shared PEQL session provider.
- Changed live processing to ingest only newly appended log lines instead of
  rebuilding all fight history on every Dashboard render.
- Added incoming-attack and miss based fight starts.
- Added explicit victory, death, zone, and inactivity fight endings.
- Preserved multi-target/add encounters and stable completed fight snapshots.
- Preserved melee, spell, damage-over-time, and damage-shield player damage.
- Restored the two-second auto-attack warning grace period.
- Feign Death, auto attack on, and fight completion cancel pending warnings.
- Added focused automated tests for timestamps, damage recognition, alarm grace,
  adds, victory, timeout splitting, and Feign Death.

## Next validation pass

- Replay the 2026-08-02 gameplay log through the Fight Engine.
- Capture exact Enchanter mez/control-state log lines before adding control-aware
  alarm suppression.
- Compare recorded fight totals against in-game observations and add every new
  real line shape as a regression test.

2026-08-02 — PEQL imported its first complete snapshot of the EverQuest Legends Wiki (6,518 NPC records), establishing the foundation of the PEQL Knowledge Base.

# Development Session 004
Date: 2026-08-04

## Enchanter-aware auto-attack warning and monitor polish

- Replayed the 64,543-line August 3 Rogue/Druid/Enchanter log.
- Added a short warning pause when the player begins casting while under attack.
- Added a renewable control pause after the player's mez successfully lands.
- Kept unrelated players' mez results from suppressing Whittler's warning.
- Preserved the original two-second warning grace and automatic warning return
  when casting/control activity stops while auto attack remains off.
- Added a persistent audio-file selector for the auto-attack alarm.
- Replaced the oversized selected-log box with one compact filename/status row.
- Expanded the Fight Engine regression suite to 12 passing tests.

## August 4 morning validation

- Replayed Whittler's 13,058-line morning Neriak log.
- Fixed successful Enthrall casts not being recognized as crowd control.
- Increased the initial warning grace from two to three seconds.
- Increased casting suppression from three to five seconds and confirmed-mez
  suppression from five to seven seconds.
- Added a regression test using the native `has been enthralled` log shape.
- Added one timestamped `==FART==` marker to the selected EQL log whenever a
  new auto-attack warning begins, making future false alarms directly replayable.
