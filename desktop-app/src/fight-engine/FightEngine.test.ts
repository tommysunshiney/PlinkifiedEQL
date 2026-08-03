import assert from 'node:assert/strict'
import test from 'node:test'
import { FightEngine } from './FightEngine.ts'
import { getLogTimestamp, parseCombatLine } from './parseCombatLine.ts'

const start = Date.parse('2026-08-03T12:00:00.000Z')

function line(seconds: number, text: string): string {
  return `[${new Date(start + seconds * 1000).toISOString()}] ${text}`
}

test('parses the native EverQuest timestamp shape', () => {
  assert.equal(
    getLogTimestamp('[Sat Aug 01 18:37:52 2026] Auto attack is on.'),
    Date.parse('Sat Aug 01 18:37:52 2026')
  )
})

test('recognizes player damage sources used by the existing parser', () => {
  const melee = parseCombatLine(
    line(0, 'You backstab skeleton L`rodd for 76 points of damage.')
  )
  const dot = parseCombatLine(
    line(1, 'A skeletal excavator has taken 31 damage from your Stinging Swarm.')
  )
  const thorns = parseCombatLine(
    line(2, 'Skeleton L`rodd is pierced by YOUR thorns for 7 points of non-melee damage.')
  )

  assert.equal(melee?.kind, 'player-damage')
  assert.equal(dot?.kind, 'player-damage')
  assert.equal(thorns?.kind, 'player-damage')
})

test('starts on incoming combat and waits through the two-second alarm grace', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'a ghoul slashes YOU for 12 points of damage.')
  ])

  assert.equal(engine.snapshot(start + 1999).currentFight?.target, 'a ghoul')
  assert.equal(
    engine.snapshot(start + 1999).combatState.autoAttackWarning,
    false
  )
  assert.equal(
    engine.snapshot(start + 2000).combatState.autoAttackWarning,
    true
  )

  engine.ingestLines([line(3, 'Auto attack is on.')])
  assert.equal(
    engine.snapshot(start + 3000).combatState.autoAttackWarning,
    false
  )
})

test('recognizes native incoming melee, spell, thorns, and defended attack shapes', () => {
  const nativeLines = [
    'A hardened skeleton punches YOU for 12 points of damage.',
    'Soldier of V`Zher strikes YOU for 18 points of damage.',
    'You have taken 23 damage from Engulfing Darkness by a Teir`Dal shadowknight.',
    "YOU are pierced by a Teir`Dal ranger's thorns for 7 points of non-melee damage!",
    'A dar ghoul knight tries to hit YOU, but YOU parry!'
  ]

  const events = nativeLines.map((text, index) =>
    parseCombatLine(line(index, text))
  )

  assert.deepEqual(
    events.map((event) => event?.kind),
    [
      'incoming-damage',
      'incoming-damage',
      'incoming-damage',
      'incoming-damage',
      'incoming-miss'
    ]
  )
})

test('recognizes player attacks that the target dodges or parries as fight activity', () => {
  const dodged = parseCombatLine(
    line(0, 'You try to pierce Baron Telyx V`Zher, but Baron Telyx V`Zher dodges!')
  )
  const parried = parseCombatLine(
    line(1, 'You try to backstab a dar ghoul knight, but a dar ghoul knight parries!')
  )

  assert.equal(dodged?.kind, 'player-miss')
  assert.equal(parried?.kind, 'player-miss')
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
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].target, 'a ghoul + 1 add')
  assert.equal(snapshot.fights[0].totalDamage, 70)
  assert.equal(snapshot.fights[0].bestHit, 50)
  assert.equal(snapshot.fights[0].endReason, 'victory')
})

test('timeout closes at last activity and separates the next encounter', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 20 points of damage.'),
    line(12, 'You slash a mummy for 30 points of damage.')
  ])

  const snapshot = engine.snapshot(start + 12_000)
  assert.equal(snapshot.fights.length, 2)
  assert.equal(snapshot.fights[0].endReason, 'timeout')
  assert.equal(snapshot.fights[0].endedAt, start)
  assert.equal(snapshot.currentFight?.target, 'a mummy')
})

test('successful Feign Death cancels the pending auto-attack warning', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'a ghoul slashes YOU for 12 points of damage.'),
    line(1, 'Your enemies have forgotten you!')
  ])

  const snapshot = engine.snapshot(start + 3000)
  assert.equal(snapshot.combatState.feigned, true)
  assert.equal(snapshot.combatState.autoAttackWarning, false)
})

test('a completed fight resets the alarm for the next hostile pull', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is on.'),
    line(1, 'You slash a ghoul for 20 points of damage.'),
    line(2, 'You have slain a ghoul!'),
    line(3, 'a mummy hits YOU for 8 points of damage.')
  ])

  const snapshot = engine.snapshot(start + 5000)
  assert.equal(snapshot.currentFight?.target, 'a mummy')
  assert.equal(snapshot.combatState.autoAttack, 'unknown')
  assert.equal(snapshot.combatState.autoAttackWarning, true)
})
