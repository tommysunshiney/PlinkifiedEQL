import { parseCombatLine } from './parseCombatLine.ts'
import type { CombatLogEvent } from './parseCombatLine.ts'
import {
  DEFAULT_AUTO_ATTACK_GRACE_MS,
  DEFAULT_CROWD_CONTROL_PAUSE_MS,
  DEFAULT_FIGHT_TIMEOUT_MS,
  DEFAULT_POST_KILL_DOT_IGNORE_MS,
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

type PendingActorEvent = Extract<CombatLogEvent, { kind: 'actor-damage' | 'actor-miss' }>

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function emptyCombatState(): CombatState {
  return {
    lastActivityAt: 0,
    lastIncomingAttackAt: 0,
    lastPlayerAttackAt: 0,
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
  private recentlyDefeatedTargets = new Map<string, number>()
  private knownPets = new Map<string, string>()
  private pendingActorEvents = new Map<string, PendingActorEvent[]>()

  constructor(options: FightEngineOptions = {}) {
    this.fightTimeoutMs = options.fightTimeoutMs ?? DEFAULT_FIGHT_TIMEOUT_MS
    this.rollingWindowMs = options.rollingWindowMs ?? DEFAULT_ROLLING_WINDOW_MS
    this.autoAttackGraceMs = options.autoAttackGraceMs ?? DEFAULT_AUTO_ATTACK_GRACE_MS
  }

  reset(): void {
    this.completedFights = []
    this.currentFight = null
    this.combatState = emptyCombatState()
    this.lastPlayerSpellCastAt = 0
    this.recentlyDefeatedTargets.clear()
    this.knownPets.clear()
    this.pendingActorEvents.clear()
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
    const warningStartedAt = this.combatState.autoAttackWarningStartedAt
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
        if (
          event.source === 'dot' &&
          !this.currentFight &&
          this.wasRecentlyDefeated(event.target, event.timestamp)
        ) {
          return
        }
        this.recordActivity(event.timestamp, event.target)
        this.currentFight?.damageEvents.push(event)
        this.combatState.feigned = false
        if (event.source === 'melee') {
          this.notePlayerAttackEvidence(event.timestamp)
        }
        return

      case 'player-miss':
        this.recordActivity(event.timestamp, event.target)
        this.combatState.feigned = false
        this.notePlayerAttackEvidence(event.timestamp)
        return

      case 'actor-damage':
      case 'actor-miss':
        this.acceptOrQueueActorEvent(event)
        return

      case 'pet-identity':
        this.confirmPet(event.pet)
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
        this.pauseAutoAttackWarning(event.timestamp + DEFAULT_SPELL_CAST_PAUSE_MS)
        return

      case 'crowd-control':
        if (
          event.timestamp - this.lastPlayerSpellCastAt <=
          DEFAULT_SPELL_CAST_PAUSE_MS
        ) {
          this.pauseAutoAttackWarning(event.timestamp + DEFAULT_CROWD_CONTROL_PAUSE_MS)
        }
        return

      case 'kill':
        if (
          event.killer === null ||
          /^you$/i.test(event.killer) ||
          this.isKnownPet(event.killer)
        ) {
          this.recordKill(event.timestamp, event.target)
        }
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

  private notePlayerAttackEvidence(timestamp: number): void {
    this.combatState.lastPlayerAttackAt = timestamp
    // Fresh swing/miss evidence means PEQL must not keep screaming based on an
    // older "Auto attack is off" line. If AA really is off, the next incoming
    // attack starts a new grace period and the horn can still fire.
    this.combatState.autoAttackWarningStartedAt = null
  }

  private acceptOrQueueActorEvent(event: PendingActorEvent): void {
    if (this.isKnownPet(event.actor)) {
      this.recordPetEvent(event)
      return
    }

    const key = normalizeName(event.actor)
    const queued = this.pendingActorEvents.get(key) ?? []
    queued.push(event)
    this.pendingActorEvents.set(
      key,
      queued.filter((item) => event.timestamp - item.timestamp <= 30_000)
    )
  }

  private confirmPet(pet: string): void {
    const key = normalizeName(pet)
    this.knownPets.set(key, pet)

    const pending = this.pendingActorEvents.get(key) ?? []
    for (const event of pending) this.recordPetEvent(event)
    this.pendingActorEvents.delete(key)
  }

  private isKnownPet(name: string): boolean {
    return this.knownPets.has(normalizeName(name))
  }

  private recordPetEvent(event: PendingActorEvent): void {
    this.recordActivity(event.timestamp, event.target)

    if (event.kind === 'actor-damage') {
      this.currentFight?.damageEvents.push({
        timestamp: event.timestamp,
        target: event.target,
        damage: event.damage,
        source: event.source,
        actor: this.knownPets.get(normalizeName(event.actor)) ?? event.actor,
        actorType: 'pet'
      })
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
        id: `${timestamp}-${normalizeName(target)}`,
        startedAt: timestamp,
        lastActivityAt: timestamp,
        endedAt: null,
        endReason: null,
        targets: new Map(),
        defeatedTargets: new Set(),
        damageEvents: []
      }
    }

    const normalizedTarget = normalizeName(target)
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    this.currentFight.lastActivityAt = Math.max(this.currentFight.lastActivityAt, timestamp)
    this.combatState.lastActivityAt = timestamp
  }

  private recordKill(timestamp: number, target: string): void {
    const normalizedTarget = normalizeName(target)
    this.recentlyDefeatedTargets.set(normalizedTarget, timestamp)

    if (!this.currentFight) return
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    this.currentFight.defeatedTargets.add(normalizedTarget)
    this.currentFight.lastActivityAt = Math.max(this.currentFight.lastActivityAt, timestamp)
    this.combatState.lastActivityAt = timestamp

    const everyKnownTargetDefeated = Array.from(this.currentFight.targets.keys()).every(
      (knownTarget) => this.currentFight?.defeatedTargets.has(knownTarget)
    )

    if (everyKnownTargetDefeated) this.finishCurrentFight(timestamp, 'victory')
  }

  private wasRecentlyDefeated(target: string, timestamp: number): boolean {
    const normalizedTarget = normalizeName(target)
    const defeatedAt = this.recentlyDefeatedTargets.get(normalizedTarget)

    if (defeatedAt === undefined) return false

    if (timestamp - defeatedAt > DEFAULT_POST_KILL_DOT_IGNORE_MS) {
      this.recentlyDefeatedTargets.delete(normalizedTarget)
      return false
    }

    return true
  }

  private closeTimedOutFight(clock: number): void {
    if (
      this.currentFight &&
      clock - this.currentFight.lastActivityAt > this.fightTimeoutMs
    ) {
      this.finishCurrentFight(this.currentFight.lastActivityAt, 'timeout')
    }
  }

  private finishCurrentFight(timestamp: number, reason: FightEndReason): void {
    if (this.currentFight) {
      this.currentFight.endedAt = Math.max(timestamp, this.currentFight.lastActivityAt)
      this.currentFight.endReason = reason
      this.completedFights.push(this.currentFight)
      this.currentFight = null
    }

    this.combatState.lastActivityAt = timestamp
    this.combatState.autoAttackWarningStartedAt = null
    this.combatState.autoAttack = 'unknown'
    this.combatState.feigned = false
  }

  private createSnapshot(fight: MutableFight, clock: number): FightSnapshot {
    const damageEvents = [...fight.damageEvents].sort((a, b) => a.timestamp - b.timestamp)
    const firstDamageAt = damageEvents[0]?.timestamp ?? null
    const lastDamageAt = damageEvents[damageEvents.length - 1]?.timestamp ?? null
    const dpsStartAt = firstDamageAt ?? fight.startedAt
    const effectiveEndAt = Math.max(dpsStartAt + 1000, clock)
    const durationSeconds = (effectiveEndAt - dpsStartAt) / 1000
    const totalDamage = damageEvents.reduce((total, event) => total + event.damage, 0)
    const playerDamage = damageEvents
      .filter((event) => event.actorType === 'player')
      .reduce((total, event) => total + event.damage, 0)
    const petDamage = damageEvents
      .filter((event) => event.actorType === 'pet')
      .reduce((total, event) => total + event.damage, 0)
    const rollingStart = clock - this.rollingWindowMs
    const rollingDamage = damageEvents
      .filter((event) => event.timestamp >= rollingStart)
      .reduce((total, event) => total + event.damage, 0)
    const rollingDps = rollingDamage / (this.rollingWindowMs / 1000)
    const targets = Array.from(fight.targets.values())
    const defeatedTargets = Array.from(fight.defeatedTargets).map(
      (target) => fight.targets.get(target) ?? target
    )
    const target = targets.length <= 1
      ? targets[0] ?? 'Unknown target'
      : `${targets[0]} + ${targets.length - 1} add${targets.length === 2 ? '' : 's'}`
    const fightDps = totalDamage / durationSeconds
    const active = fight.endedAt === null

    const combatantMap = new Map<string, { name: string; type: 'player' | 'pet'; damage: number; bestHit: number }>()
    for (const event of damageEvents) {
      const key = `${event.actorType}:${normalizeName(event.actor)}`
      const current = combatantMap.get(key) ?? {
        name: event.actor,
        type: event.actorType,
        damage: 0,
        bestHit: 0
      }
      current.damage += event.damage
      current.bestHit = Math.max(current.bestHit, event.damage)
      combatantMap.set(key, current)
    }

    const combatants = Array.from(combatantMap.values())
      .map((combatant) => ({
        ...combatant,
        dps: combatant.damage / durationSeconds
      }))
      .sort((a, b) => b.damage - a.damage)

    return {
      id: fight.id,
      target,
      targets,
      defeatedTargets,
      totalDamage,
      playerDamage,
      petDamage,
      combatants,
      fightDps,
      rollingDps,
      displayDps: active ? rollingDps : fightDps,
      bestHit: damageEvents.reduce((best, event) => Math.max(best, event.damage), 0),
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
