import { parseCombatLine } from './parseCombatLine.ts'
import type { CombatLogEvent } from './parseCombatLine.ts'
import {
  DEFAULT_AUTO_ATTACK_GRACE_MS,
  DEFAULT_CROWD_CONTROL_PAUSE_MS,
  DEFAULT_CONTROLLED_FIGHT_TIMEOUT_MS,
  DEFAULT_FIGHT_TIMEOUT_MS,
  DEFAULT_POST_KILL_COMBAT_IGNORE_MS,
  DEFAULT_POST_KILL_DOT_IGNORE_MS,
  DEFAULT_MOB_BURN_GAP_MS,
  DEFAULT_ROLLING_WINDOW_MS,
  DEFAULT_SPELL_CAST_PAUSE_MS
} from './types.ts'
import type {
  CombatState,
  FightAbilitySnapshot,
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
  targetJoinedAt: Map<string, number>
  targetKilledAt: Map<string, number>
  defeatedTargets: Set<string>
  damageEvents: FightDamageEvent[]
  controlledTargets: Set<string>
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
  private lastPlayerSpellName: string | null = null
  private charmedPets = new Map<string, { name: string; spell: string | null }>()
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
    this.lastPlayerSpellName = null
    this.charmedPets.clear()
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
          this.wasRecentlyDefeated(
            event.target,
            event.timestamp,
            DEFAULT_POST_KILL_DOT_IGNORE_MS
          )
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

      case 'charm':
        this.confirmCharm(
          event.target,
          event.timestamp - this.lastPlayerSpellCastAt <= 15_000
            ? this.lastPlayerSpellName
            : null
        )
        this.retireCharmedHostile(event.target, event.timestamp)
        this.combatState.autoAttackWarningStartedAt = null
        this.combatState.autoAttackWarning = false
        this.pauseAutoAttackWarning(
          event.timestamp + DEFAULT_CROWD_CONTROL_PAUSE_MS
        )
        return

      case 'player-effect-worn-off':
        if (this.charmEffectMatches(event.target, event.spell)) {
          this.releaseCharm(event.target)
        }
        return

      case 'incoming-dot':
        // Lingering DOTs can tick after Exodus, zoning, or a kill. They may
        // extend an encounter that is already active, but they cannot create
        // or reopen combat and they never arm the auto-attack warning.
        if (this.currentFight) {
          this.recordActivity(event.timestamp, event.attacker)
        }
        return

      case 'incoming-damage':
      case 'incoming-miss':
        if (this.isCharmedPet(event.attacker)) {
          this.releaseCharm(event.attacker)
        }

        if (
          this.wasRecentlyDefeated(
            event.attacker,
            event.timestamp,
            DEFAULT_POST_KILL_COMBAT_IGNORE_MS
          )
        ) {
          return
        }
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
        this.lastPlayerSpellName = event.spell
        this.pauseAutoAttackWarning(event.timestamp + DEFAULT_SPELL_CAST_PAUSE_MS)
        return

      case 'crowd-control':
        if (
          event.timestamp - this.lastPlayerSpellCastAt <=
          DEFAULT_SPELL_CAST_PAUSE_MS
        ) {
          this.recordActivity(event.timestamp, event.target)
          if (event.effect === 'mez') {
            this.currentFight?.controlledTargets.add(normalizeName(event.target))
          }
          this.pauseAutoAttackWarning(event.timestamp + DEFAULT_CROWD_CONTROL_PAUSE_MS)
        } else if (
          this.currentFight?.targets.has(normalizeName(event.target))
        ) {
          this.currentFight.lastActivityAt = Math.max(
            this.currentFight.lastActivityAt,
            event.timestamp
          )
        }
        return

      case 'crowd-control-end':
        if (this.currentFight) {
          const key = normalizeName(event.target)
          this.currentFight.controlledTargets.delete(key)
          if (this.currentFight.targets.has(key)) {
            this.currentFight.lastActivityAt = Math.max(
              this.currentFight.lastActivityAt,
              event.timestamp
            )
          }
        }
        return

      case 'enemy-spell-cast':
      case 'enemy-spell-interrupt':
        if (
          this.currentFight?.targets.has(normalizeName(event.caster))
        ) {
          this.currentFight.lastActivityAt = Math.max(
            this.currentFight.lastActivityAt,
            event.timestamp
          )
          this.combatState.lastActivityAt = event.timestamp
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
        this.charmedPets.clear()
        this.finishCurrentFight(event.timestamp, 'death')
        return

      case 'zone':
        this.charmedPets.clear()
        this.finishCurrentFight(event.timestamp, 'zone')
        this.combatState.autoAttack = 'unknown'
        this.combatState.feigned = false
        return
    }
  }

  private notePlayerAttackEvidence(timestamp: number): void {
    this.combatState.lastPlayerAttackAt = timestamp
    this.combatState.autoAttackWarningStartedAt = null
  }

  private acceptOrQueueActorEvent(event: PendingActorEvent): void {
    // If a temporary charm pet attacks our permanent pet, charm has ended
    // even if EQL omitted or delayed the explicit worn-off line.
    if (
      this.isCharmedPet(event.actor) &&
      this.isPermanentPet(event.target)
    ) {
      this.releaseCharm(event.actor)
      this.recordActivity(event.timestamp, event.actor)
      return
    }

    // A friendly permanent/charmed pet attacking an NPC is outgoing pet combat.
    if (this.isKnownPet(event.actor)) {
      this.recordPetEvent(event)
      return
    }

    // An NPC attacking a positively identified pet is equally valid evidence
    // that the encounter is still active. Do not count this as player/pet DPS,
    // but do refresh the NPC engagement timestamp.
    if (this.isKnownPet(event.target)) {
      this.recordActivity(event.timestamp, event.actor)
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

    // Charmed NPCs also use Master speech. Never promote them into the
    // permanent summoned-pet registry.
    if (!this.charmedPets.has(key)) {
      this.knownPets.set(key, pet)
    }

    const pending = this.pendingActorEvents.get(key) ?? []
    for (const event of pending) this.recordPetEvent(event)
    this.pendingActorEvents.delete(key)
  }

  private confirmCharm(target: string, spell: string | null): void {
    const key = normalizeName(target)
    this.charmedPets.set(key, { name: target, spell })

    const pending = this.pendingActorEvents.get(key) ?? []
    for (const event of pending) this.recordPetEvent(event)
    this.pendingActorEvents.delete(key)
  }

  private releaseCharm(target: string): void {
    this.charmedPets.delete(normalizeName(target))
  }

  private isCharmedPet(name: string): boolean {
    return this.charmedPets.has(normalizeName(name))
  }

  private isPermanentPet(name: string): boolean {
    return this.knownPets.has(normalizeName(name))
  }

  private isKnownPet(name: string): boolean {
    const key = normalizeName(name)
    return this.knownPets.has(key) || this.charmedPets.has(key)
  }

  private charmEffectMatches(target: string, spell: string): boolean {
    const charm = this.charmedPets.get(normalizeName(target))
    if (!charm) return false

    // When we captured the spell that produced the charm, require the worn
    // effect to match it. If the cast name was unavailable, the explicit
    // worn-off-on-a-currently-charmed-target line is still strong evidence.
    return (
      charm.spell === null ||
      normalizeName(charm.spell) === normalizeName(spell)
    )
  }

  private retireCharmedHostile(target: string, timestamp: number): void {
    if (!this.currentFight) return

    const key = normalizeName(target)
    if (!this.currentFight.targets.has(key)) return

    this.currentFight.targets.delete(key)
    this.currentFight.targetJoinedAt.delete(key)
    this.currentFight.targetKilledAt.delete(key)
    this.currentFight.defeatedTargets.delete(key)
    this.currentFight.controlledTargets.delete(key)

    // If charming the pulled mob removed the only hostile from the encounter,
    // an incoming-only setup pull is not useful combat history. Discard that
    // empty shell instead of persisting a zero-damage "charm" encounter.
    //
    // If the player/pet had already dealt real damage before charm landed,
    // preserve that partial encounter explicitly.
    if (this.currentFight.targets.size === 0) {
      if (this.currentFight.damageEvents.length === 0) {
        this.currentFight = null
        this.combatState.lastActivityAt = timestamp
        this.combatState.autoAttackWarningStartedAt = null
        this.combatState.autoAttack = 'unknown'
      } else {
        this.finishCurrentFight(timestamp, 'charm')
      }
    }
  }

  private recordPetEvent(event: PendingActorEvent): void {
    if (
      this.wasRecentlyDefeated(
        event.target,
        event.timestamp,
        DEFAULT_POST_KILL_COMBAT_IGNORE_MS
      )
    ) {
      return
    }

    this.recordActivity(event.timestamp, event.target)

    if (event.kind === 'actor-damage') {
      this.currentFight?.damageEvents.push({
        timestamp: event.timestamp,
        target: event.target,
        damage: event.damage,
        source: event.source,
        ability: event.ability,
        critical: event.critical,
        modifier: event.modifier,
        actor:
          this.knownPets.get(normalizeName(event.actor)) ??
          this.charmedPets.get(normalizeName(event.actor))?.name ??
          event.actor,
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
    if (/^(?:you|whittler)$/i.test(target.trim())) return

    if (!this.currentFight) {
      this.currentFight = {
        id: `${timestamp}-${normalizeName(target)}`,
        startedAt: timestamp,
        lastActivityAt: timestamp,
        endedAt: null,
        endReason: null,
        targets: new Map(),
        targetJoinedAt: new Map(),
        targetKilledAt: new Map(),
        defeatedTargets: new Set(),
        damageEvents: [],
        controlledTargets: new Set()
      }
    }

    const normalizedTarget = normalizeName(target)
    const isNewTarget = !this.currentFight.targets.has(normalizedTarget)
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    if (isNewTarget) {
      this.currentFight.targetJoinedAt.set(normalizedTarget, timestamp)
    }
    this.currentFight.lastActivityAt = Math.max(this.currentFight.lastActivityAt, timestamp)
    this.combatState.lastActivityAt = timestamp
  }

  private recordKill(timestamp: number, target: string): void {
    const normalizedTarget = normalizeName(target)
    this.charmedPets.delete(normalizedTarget)
    this.recentlyDefeatedTargets.set(normalizedTarget, timestamp)

    if (!this.currentFight) return
    const isNewTarget = !this.currentFight.targets.has(normalizedTarget)
    this.currentFight.targets.set(
      normalizedTarget,
      this.currentFight.targets.get(normalizedTarget) ?? target
    )
    if (isNewTarget) {
      this.currentFight.targetJoinedAt.set(normalizedTarget, timestamp)
    }
    this.currentFight.targetKilledAt.set(normalizedTarget, timestamp)
    this.currentFight.defeatedTargets.add(normalizedTarget)
    this.currentFight.controlledTargets.delete(normalizedTarget)

    // EQL NPC pets commonly vanish when their owner dies without emitting
    // their own slain line. If "<owner> pet" is already part of this
    // encounter, retire it with the owner so the room can end in victory
    // instead of hanging until timeout.
    const ownedPet = `${normalizedTarget} pet`
    if (this.currentFight.targets.has(ownedPet)) {
      this.currentFight.defeatedTargets.add(ownedPet)
      if (!this.currentFight.targetKilledAt.has(ownedPet)) {
        this.currentFight.targetKilledAt.set(ownedPet, timestamp)
      }
      this.currentFight.controlledTargets.delete(ownedPet)
    }

    this.currentFight.lastActivityAt = Math.max(this.currentFight.lastActivityAt, timestamp)
    this.combatState.lastActivityAt = timestamp

    const everyKnownTargetDefeated = Array.from(this.currentFight.targets.keys()).every(
      (knownTarget) => this.currentFight?.defeatedTargets.has(knownTarget)
    )

    if (everyKnownTargetDefeated) this.finishCurrentFight(timestamp, 'victory')
  }

  private wasRecentlyDefeated(
    target: string,
    timestamp: number,
    windowMs: number
  ): boolean {
    const normalizedTarget = normalizeName(target)
    const defeatedAt = this.recentlyDefeatedTargets.get(normalizedTarget)

    if (defeatedAt === undefined) return false

    if (timestamp - defeatedAt > DEFAULT_POST_KILL_DOT_IGNORE_MS) {
      this.recentlyDefeatedTargets.delete(normalizedTarget)
      return false
    }

    return timestamp - defeatedAt <= windowMs
  }

  private closeTimedOutFight(clock: number): void {
    if (!this.currentFight) return

    const timeoutMs =
      this.currentFight.controlledTargets.size > 0
        ? Math.max(this.fightTimeoutMs, DEFAULT_CONTROLLED_FIGHT_TIMEOUT_MS)
        : this.fightTimeoutMs

    if (clock - this.currentFight.lastActivityAt > timeoutMs) {
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
    const abilityMap = new Map<string, FightAbilitySnapshot>()

    for (const event of damageEvents) {
      const ability = event.ability ?? event.source
      const key = [
        event.actorType,
        normalizeName(event.actor),
        event.source,
        normalizeName(ability)
      ].join('|')

      const current = abilityMap.get(key)
      if (current) {
        current.damage += event.damage
        current.hits += 1
        current.bestHit = Math.max(current.bestHit, event.damage)
        if (event.critical) current.criticalHits += 1
        if (event.modifier) {
          current.modifiers[event.modifier] =
            (current.modifiers[event.modifier] ?? 0) + 1
          current.modifierDamage[event.modifier] =
            (current.modifierDamage[event.modifier] ?? 0) + event.damage
        }
      } else {
        abilityMap.set(key, {
          ability,
          source: event.source,
          actor: event.actor,
          actorType: event.actorType,
          damage: event.damage,
          hits: 1,
          criticalHits: event.critical ? 1 : 0,
          bestHit: event.damage,
          modifiers: event.modifier ? { [event.modifier]: 1 } : {},
          modifierDamage: event.modifier ? { [event.modifier]: event.damage } : {}
        })
      }
    }

    const abilities = [...abilityMap.values()].sort(
      (a, b) => b.damage - a.damage
    )
    const rollingStart = clock - this.rollingWindowMs
    const rollingDamage = damageEvents
      .filter((event) => event.timestamp >= rollingStart)
      .reduce((total, event) => total + event.damage, 0)
    const rollingDps = rollingDamage / (this.rollingWindowMs / 1000)
    const targets = Array.from(fight.targets.values())
    const defeatedTargets = Array.from(fight.defeatedTargets).map(
      (target) => fight.targets.get(target) ?? target
    )
    const primaryTarget =
      targets.find((candidate) => !/\spet$/i.test(candidate)) ??
      targets[0] ??
      'Unknown target'
    const target = targets.length <= 1
      ? primaryTarget
      : `${primaryTarget} + ${targets.length - 1} add${targets.length === 2 ? '' : 's'}`
    const fightDps = totalDamage / durationSeconds
    const active = fight.endedAt === null

    const mobs = targets.map((mobName) => {
      const key = normalizeName(mobName)
      const joinedAt = fight.targetJoinedAt.get(key) ?? fight.startedAt
      const killedAt = fight.targetKilledAt.get(key) ?? null
      const mobDamageEvents = damageEvents.filter(
        (event) => normalizeName(event.target) === key
      )
      const mobFirstDamageAt = mobDamageEvents[0]?.timestamp ?? null
      const mobLastDamageAt =
        mobDamageEvents[mobDamageEvents.length - 1]?.timestamp ?? null

      // Passive damage shields count toward encounter damage, but do not
      // prove that this mob is the target the player deliberately started
      // working.
      const deliberateDamageEvents = mobDamageEvents.filter(
        (event) => event.source !== 'damage-shield'
      )

      // A target can be worked, parked/CC'd, then worked again. Split long
      // target-specific damage gaps into active burn segments instead of
      // charging parked time to target DPS.
      const rawBurnGroups: typeof deliberateDamageEvents[] = []
      for (const event of deliberateDamageEvents) {
        const currentGroup = rawBurnGroups[rawBurnGroups.length - 1]
        const previous = currentGroup?.[currentGroup.length - 1]

        if (
          !currentGroup ||
          !previous ||
          event.timestamp - previous.timestamp > DEFAULT_MOB_BURN_GAP_MS
        ) {
          rawBurnGroups.push([event])
        } else {
          currentGroup.push(event)
        }
      }

      const burnSegments = rawBurnGroups.map((group, index) => {
        const startedAt = group[0].timestamp
        const lastDeliberateAt = group[group.length - 1].timestamp
        const isLastSegment = index === rawBurnGroups.length - 1
        const nearbyKillAt =
          isLastSegment &&
          killedAt !== null &&
          killedAt >= lastDeliberateAt &&
          killedAt - lastDeliberateAt <= DEFAULT_MOB_BURN_GAP_MS
            ? killedAt
            : null
        const endedAt = Math.max(
          startedAt + 1000,
          nearbyKillAt ?? lastDeliberateAt + 1000
        )
        const damage = mobDamageEvents
          .filter(
            (event) =>
              event.timestamp >= startedAt &&
              event.timestamp <= endedAt
          )
          .reduce((total, event) => total + event.damage, 0)

        return {
          startedAt,
          endedAt,
          durationSeconds: (endedAt - startedAt) / 1000,
          damage
        }
      })

      const burnStartedAt = burnSegments[0]?.startedAt ?? null
      const burnEndedAt =
        burnSegments[burnSegments.length - 1]?.endedAt ?? null
      const burnDurationSeconds = burnSegments.reduce(
        (total, segment) => total + segment.durationSeconds,
        0
      )
      const activeDamage = burnSegments.reduce(
        (total, segment) => total + segment.damage,
        0
      )
      const elapsedTtkSeconds =
        burnStartedAt === null
          ? 0
          : Math.max(
              0,
              ((killedAt ?? mobLastDamageAt ?? burnStartedAt) -
                burnStartedAt) /
                1000
            )

      const mobTotalDamage = mobDamageEvents.reduce(
        (total, event) => total + event.damage,
        0
      )
      const mobPlayerDamage = mobDamageEvents
        .filter((event) => event.actorType === 'player')
        .reduce((total, event) => total + event.damage, 0)
      const mobPetDamage = mobDamageEvents
        .filter((event) => event.actorType === 'pet')
        .reduce((total, event) => total + event.damage, 0)

      return {
        name: mobName,
        joinedAt,
        joinedOffsetMs: Math.max(0, joinedAt - fight.startedAt),
        firstDamageAt: mobFirstDamageAt,
        lastDamageAt: mobLastDamageAt,
        killedAt,
        burnStartedAt,
        burnEndedAt,
        burnDurationSeconds,
        burnSegments,
        activeDamage,
        elapsedTtkSeconds,
        totalDamage: mobTotalDamage,
        playerDamage: mobPlayerDamage,
        petDamage: mobPetDamage,
        dps: burnDurationSeconds > 0
          ? activeDamage / burnDurationSeconds
          : 0,
        bestHit: mobDamageEvents.reduce(
          (best, event) => Math.max(best, event.damage),
          0
        ),
        defeated: fight.defeatedTargets.has(key),
        joinedLater: joinedAt - fight.startedAt >= 5000
      }
    })

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
      abilities,
      mobs,
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
