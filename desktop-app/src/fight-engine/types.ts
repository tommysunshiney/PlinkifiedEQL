export const DEFAULT_FIGHT_TIMEOUT_MS = 10_000
export const DEFAULT_ROLLING_WINDOW_MS = 10_000
export const DEFAULT_AUTO_ATTACK_GRACE_MS = 5_000
export const DEFAULT_SPELL_CAST_PAUSE_MS = 5_000
export const DEFAULT_CROWD_CONTROL_PAUSE_MS = 7_000
export const DEFAULT_POST_KILL_DOT_IGNORE_MS = 12_000

export type FightEndReason =
  | 'victory'
  | 'death'
  | 'zone'
  | 'timeout'

export type AutoAttackState = 'on' | 'off' | 'unknown'

export type DamageSource =
  | 'melee'
  | 'spell'
  | 'dot'
  | 'damage-shield'

export type FightDamageEvent = {
  timestamp: number
  damage: number
  target: string
  source: DamageSource
}

export type FightSnapshot = {
  id: string
  target: string
  targets: string[]
  defeatedTargets: string[]
  totalDamage: number
  fightDps: number
  rollingDps: number
  displayDps: number
  bestHit: number
  durationSeconds: number
  startedAt: number
  firstDamageAt: number | null
  lastDamageAt: number | null
  lastActivityAt: number
  endedAt: number | null
  endReason: FightEndReason | null
  active: boolean
}

export type CombatState = {
  lastActivityAt: number
  lastIncomingAttackAt: number
  autoAttack: AutoAttackState
  feigned: boolean
  autoAttackWarningStartedAt: number | null
  autoAttackWarning: boolean
  autoAttackWarningPausedUntil: number
}

export type FightEngineSnapshot = {
  fights: FightSnapshot[]
  currentFight: FightSnapshot | null
  combatState: CombatState
}

export type FightEngineOptions = {
  fightTimeoutMs?: number
  rollingWindowMs?: number
  autoAttackGraceMs?: number
}
