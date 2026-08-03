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

