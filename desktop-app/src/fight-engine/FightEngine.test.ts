import assert from 'node:assert/strict'
import test from 'node:test'
import { FightEngine } from './FightEngine.ts'
import { getLogTimestamp, parseCombatLine } from './parseCombatLine.ts'

const start = Date.parse('2026-08-03T12:00:00.000Z')

function line(seconds: number, text: string): string {
  return `[${new Date(start + seconds * 1000).toISOString()}] ${text}`
}

test('parses native EverQuest timestamps', () => {
  assert.equal(
    getLogTimestamp('[Sat Aug 01 18:37:52 2026] Auto attack is on.'),
    Date.parse('Sat Aug 01 18:37:52 2026')
  )
})

test('tracks player melee, dots, and damage shield', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 20 points of damage.'),
    line(1, 'A ghoul has taken 31 damage from your Stinging Swarm.'),
    line(2, 'A ghoul is pierced by YOUR thorns for 7 points of non-melee damage.'),
    line(3, 'You have slain a ghoul!')
  ])

  const fight = engine.snapshot(start + 3000).fights[0]
  assert.equal(fight.totalDamage, 58)
  assert.equal(fight.playerDamage, 58)
  assert.equal(fight.petDamage, 0)
})

test('fresh player swings cancel a stale mid-fight AA warning', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is on.'),
    line(1, 'You slash a ghoul for 20 points of damage.'),
    line(2, 'Auto attack is off.'),
    line(3, 'a ghoul hits YOU for 8 points of damage.'),
    line(5, 'You slash a ghoul for 18 points of damage.'),
    line(7, 'a ghoul hits YOU for 9 points of damage.'),
    line(9, 'You pierce a ghoul for 22 points of damage.')
  ])

  assert.equal(
    engine.snapshot(start + 10_000).combatState.autoAttackWarning,
    false
  )
})

test('still warns when incoming attacks continue and the player stops swinging', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is off.'),
    line(1, 'a ghoul hits YOU for 8 points of damage.')
  ])

  assert.equal(engine.snapshot(start + 5_999).combatState.autoAttackWarning, false)
  assert.equal(engine.snapshot(start + 6_000).combatState.autoAttackWarning, true)
})

test('identifies pet from Master speech and counts pet damage in total DPS', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 40 points of damage.'),
    line(1, 'Jaraner slashes a ghoul for 20 points of damage.'),
    line(2, "Jaraner told you, 'Attacking a ghoul Master.'"),
    line(3, 'Jaraner bashes a ghoul for 10 points of damage.'),
    line(4, 'A ghoul has been slain by Jaraner!')
  ])

  const fight = engine.snapshot(start + 4000).fights[0]
  assert.equal(fight.totalDamage, 70)
  assert.equal(fight.playerDamage, 40)
  assert.equal(fight.petDamage, 30)
  assert.equal(fight.combatants.find((c) => c.type === 'pet')?.name, 'Jaraner')
  assert.equal(fight.endReason, 'victory')
})

test('does not count unrelated NPC or player combat as pet damage', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 40 points of damage.'),
    line(1, 'Guard Munden punches an orc centurion for 52 points of damage.'),
    line(2, 'You have slain a ghoul!')
  ])

  const fight = engine.snapshot(start + 2000).fights[0]
  assert.equal(fight.totalDamage, 40)
  assert.equal(fight.petDamage, 0)
})

test('keeps known adds in one fight and completes when all are slain', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 20 points of damage.'),
    line(1, 'a mummy hits YOU for 8 points of damage.'),
    line(2, 'You backstab a mummy for 50 points of damage.'),
    line(3, 'You have slain a ghoul!'),
    line(4, 'You have slain a mummy!')
  ])

  const snapshot = engine.snapshot(start + 4000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights[0].target, 'a ghoul + 1 add')
  assert.equal(snapshot.fights[0].totalDamage, 70)
})

test('ignores lingering DOT ticks after a slain target closes the fight', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You pierce a ghoul for 40 points of damage.'),
    line(1, 'You have slain a ghoul!'),
    line(2, 'A ghoul has taken 53 damage from your Immolate.')
  ])

  const snapshot = engine.snapshot(start + 2000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].totalDamage, 40)
})

test('ignores immediate corpse melee after the kill line', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is on.'),
    line(1, 'You pierce an elemental harvester for 94 points of damage.'),
    line(2, 'You have slain an elemental harvester!'),
    line(2, 'An elemental harvester hits YOU for 19 points of damage.')
  ])

  const snapshot = engine.snapshot(start + 8_000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.combatState.autoAttackWarning, false)
})

test('ignores immediate pet follow-through on a slain target', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, "Gabaner told you, 'Attacking a ghoul Master.'"),
    line(1, 'You slash a ghoul for 40 points of damage.'),
    line(2, 'You have slain a ghoul!'),
    line(3, 'Gabaner slashes a ghoul for 20 points of damage.')
  ])

  const snapshot = engine.snapshot(start + 8_000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].petDamage, 0)
})

test('allows clear player melee evidence to start a same-named new target immediately', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 40 points of damage.'),
    line(1, 'You have slain a ghoul!'),
    line(2, 'You slash a ghoul for 30 points of damage.')
  ])

  const snapshot = engine.snapshot(start + 2_000)
  assert.equal(snapshot.fights.length, 2)
  assert.equal(snapshot.currentFight?.target, 'a ghoul')
  assert.equal(snapshot.currentFight?.totalDamage, 30)
})

test('recognizes pet kill line shape from live log', () => {
  const event = parseCombatLine(line(0, 'A zol ghoul knight has been slain by Zonartik!'))

  assert.equal(event?.kind, 'kill')
  if (event?.kind === 'kill') {
    assert.equal(event.target, 'A zol ghoul knight')
    assert.equal(event.killer, 'Zonartik')
  }
})
