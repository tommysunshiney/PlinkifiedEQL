import { parseCombatLine } from './parseCombatLine.ts'
import type { CombatLogEvent } from './parseCombatLine.ts'
import {
  DEFAULT_AUTO_ATTACK_GRACE_MS,
  DEFAULT_CROWD_CONTROL_PAUSE_MS,
  DEFAULT_FIGHT_TIMEOUT_MS,
  DEFAULT_ROLLING_WINDOW_MS,
  DEFAULT_SPELL_CAST_PAUSE_MS
} from './types.ts'
import type {
  CombatState,
  FightDamageEvent,
  FightEndReason,
  FightEngineOptions,
  FightEngineSnapshot,
  FightSnapshot
} from './types.ts'

type MutableFight = {
  id: string
  startedAt: number
  lastActivityAt: number
  endedAt: number | null
  endReason: FightEndReason | null
  targets: Map<string, string>
  defeatedTargets: Set<string>
  damageEvents: FightDamageEvent[]
}

function normalizeTarget(target: string): string {
  return target.trim().toLocaleLowerCase()
}

function emptyCombatState(): CombatState {
  return {
    lastActivityAt: 0,
    lastIncomingAttackAt: 0,
    autoAttack: 'unknown',
    feigned: false,
    autoAttackWarningStartedAt: null,
    autoAttackWarning: false,
    autoAttackWarningPausedUntil: 0
  }
}

export class FightEngine {
  private readonly fightTimeoutMs: number
  private readonly rollingWindowMs: number
  private readonly autoAttackGraceMs: number
  private completedFights: MutableFight[] = []
  private currentFight: MutableFight | null = null
  private combatState: CombatState = emptyCombatState()
  private lastPlayerSpellCastAt = 0

  constructor(options: FightEngineOptions = {}) {
    this.fightTimeoutMs =
      options.fightTimeoutMs ?? DEFAULT_FIGHT_TIMEOUT_MS
    this.rollingWindowMs =
      options.rollingWindowMs ?? DEFAULT_ROLLING_WINDOW_MS
    this.autoAttackGraceMs =
      options.autoAttackGraceMs ?? DEFAULT_AUTO_ATTACK_GRACE_MS
  }

  reset(): void {
    this.completedFights = []
    this.currentFight = null
    this.combatState = emptyCombatState()
    this.lastPlayerSpellCastAt = 0
  }

  ingestLines(lines: string[]): void {
    for (const line of lines) {
      const event = parseCombatLine(line)
      if (event) this.ingestEvent(event)
    }
  }

  snapshot(clock = Date.now()): FightEngineSnapshot {
    this.closeTimedOutFight(clock)

    const completed = this.completedFights.map((fight) =>
      this.createSnapshot(fight, fight.endedAt ?? fight.lastActivityAt)
    )
    const active = this.currentFight
      ? this.createSnapshot(this.currentFight, clock)
      : null
    const warningStartedAt =
      this.combatState.autoAttackWarningStartedAt
    const autoAttackWarning = Boolean(
      active &&
      warningStartedAt !== null &&
      clock - warningStartedAt >= this.autoAttackGraceMs &&
      !this.combatState.feigned &&
      this.combatState.autoAttack !== 'on' &&
      clock >= this.combatState.autoAttackWarningPausedUntil
    )

    return {
      fights: active ? [...completed, active] : completed,
      currentFight: active,
      combatState: {
        ...this.combatState,
        autoAttackWarning
      }
    }
  }

  private ingestEvent(event: CombatLogEvent): void {
    this.closeTimedOutFight(event.timestamp)

    switch (event.kind) {
      case 'player-damage':
        this.recordActivity(event.timestamp, event.target)
        this.currentFight?.damageEvents.push(event)
        this.combatState.feigned = false
        return

      case 'player-miss':
        this.recordActivity(event.timestamp, event.target)
        this.combatState.feigned = false
        return

      case 'incoming-damage':
      case 'incoming-miss':
        this.recordActivity(event.timestamp, event.attacker)
        this.combatState.lastIncomingAttackAt = event.timestamp
        if (
          !this.combatState.feigned &&
          this.combatState.autoAttack !== 'on' &&
          this.combatState.autoAttackWarningStartedAt === null
        ) {
          this.combatState.autoAttackWarningStartedAt = event.timestamp
        }
        return

      case 'auto-attack':
        this.combatState.autoAttack = event.enabled ? 'on' : 'off'
        if (event.enabled) {
          this.combatState.feigned = false
          this.combatState.autoAttackWarningStartedAt = null
        }
        return

      case 'feign':
        this.combatState.feigned = event.successful
        if (event.successful) {
          this.combatState.autoAttackWarningStartedAt = null
        }
        return

      case 'player-spell-cast':
        this.lastPlayerSpellCastAt = event.timestamp
        this.pauseAutoAttackWarning(
          event.timestamp + DEFAULT_SPELL_CAST_PAUSE_MS
        )
        return

      case 'crowd-control':
        if (
          event.timestamp - this.lastPlayerSpellCastAt <=
          DEFAULT_SPELL_CAST_PAUSE_MS
        ) {
          this.pauseAutoAttackWarning(
            event.timestamp + DEFAULT_CROWD_CONTROL_PAUSE_MS
          )
        }
        return

      case 'kill':
        this.recordKill(event.timestamp, event.target)
        return

      case 'death':
        this.finishCurrentFight(event.timestamp, 'death')
        return

      case 'zone':
        this.finishCurrentFight(event.timestamp, 'zone')
        this.combatState.autoAttack = 'unknown'
        this.combatState.feigned = false
        return
    }
  }

  private pauseAutoAttackWarning(until: number): void {
    this.combatState.autoAttackWarningPausedUntil = Math.max(
      this.combatState.autoAttackWarningPausedUntil,
      until
    )
  }

  private recordActivity(timestamp: number, target: string): void {
    if (!this.currentFight) {
      this.currentFight = {
        id: `${timestamp}-${normalizeTarget(target)}`,
        startedAt: timestamp,
        lastActivityAt: timestamp,
        endedAt: null,
        endReason: null,
        targets: new Map(),
        defeatedTargets: new Set(),
        damageEvents: []
      }
    }

    const normalizedTarget = normalizeTarget(target)
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    this.currentFight.lastActivityAt = Math.max(
      this.currentFight.lastActivityAt,
      timestamp
    )
    this.combatState.lastActivityAt = timestamp
  }

  private recordKill(timestamp: number, target: string): void {
    if (!this.currentFight) return

    const normalizedTarget = normalizeTarget(target)
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    this.currentFight.defeatedTargets.add(normalizedTarget)
    this.currentFight.lastActivityAt = Math.max(
      this.currentFight.lastActivityAt,
      timestamp
    )
    this.combatState.lastActivityAt = timestamp

    const everyKnownTargetDefeated = Array.from(
      this.currentFight.targets.keys()
    ).every((knownTarget) =>
      this.currentFight?.defeatedTargets.has(knownTarget)
    )

    if (everyKnownTargetDefeated) {
      this.finishCurrentFight(timestamp, 'victory')
    }
  }

  private closeTimedOutFight(clock: number): void {
    if (
      this.currentFight &&
      clock - this.currentFight.lastActivityAt > this.fightTimeoutMs
    ) {
      this.finishCurrentFight(
        this.currentFight.lastActivityAt,
        'timeout'
      )
    }
  }

  private finishCurrentFight(
    timestamp: number,
    reason: FightEndReason
  ): void {
    if (this.currentFight) {
      this.currentFight.endedAt = Math.max(
        timestamp,
        this.currentFight.lastActivityAt
      )
      this.currentFight.endReason = reason
      this.completedFights.push(this.currentFight)
      this.currentFight = null
    }

    this.combatState.lastActivityAt = timestamp
    this.combatState.autoAttackWarningStartedAt = null
    this.combatState.autoAttack = 'unknown'
    this.combatState.feigned = false
  }

  private createSnapshot(
    fight: MutableFight,
    clock: number
  ): FightSnapshot {
    const firstDamageAt = fight.damageEvents[0]?.timestamp ?? null
    const lastDamageAt =
      fight.damageEvents[fight.damageEvents.length - 1]?.timestamp ?? null
    const dpsStartAt = firstDamageAt ?? fight.startedAt
    const effectiveEndAt = Math.max(dpsStartAt + 1000, clock)
    const durationSeconds = (effectiveEndAt - dpsStartAt) / 1000
    const totalDamage = fight.damageEvents.reduce(
      (total, event) => total + event.damage,
      0
    )
    const rollingStart = clock - this.rollingWindowMs
    const rollingDamage = fight.damageEvents
      .filter((event) => event.timestamp >= rollingStart)
      .reduce((total, event) => total + event.damage, 0)
    const rollingDps = rollingDamage / (this.rollingWindowMs / 1000)
    const targets = Array.from(fight.targets.values())
    const defeatedTargets = Array.from(fight.defeatedTargets)
      .map((target) => fight.targets.get(target) ?? target)
    const target = targets.length <= 1
      ? targets[0] ?? 'Unknown target'
      : `${targets[0]} + ${targets.length - 1} add${targets.length === 2 ? '' : 's'}`
    const fightDps = totalDamage / durationSeconds
    const active = fight.endedAt === null

    return {
      id: fight.id,
      target,
      targets,
      defeatedTargets,
      totalDamage,
      fightDps,
      rollingDps,
      displayDps: active ? rollingDps : fightDps,
      bestHit: fight.damageEvents.reduce(
        (best, event) => Math.max(best, event.damage),
        0
      ),
      durationSeconds,
      startedAt: fight.startedAt,
      firstDamageAt,
      lastDamageAt,
      lastActivityAt: fight.lastActivityAt,
      endedAt: fight.endedAt,
      endReason: fight.endReason,
      active
    }
  }
}
