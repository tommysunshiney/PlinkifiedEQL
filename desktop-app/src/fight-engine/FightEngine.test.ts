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


test('lingering incoming DOT after zoning does not reopen combat or arm AA warning', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is on.'),
    line(1, 'King Tranix slashes YOU for 120 points of damage.'),
    line(2, "You have entered Nagafen's Lair - Solo."),
    line(8, 'You have taken 20 damage from Dooming Darkness by King Tranix.'),
    line(14, 'You have taken 20 damage from Dooming Darkness by King Tranix.'),
    line(20, 'You have taken 20 damage from Dooming Darkness by King Tranix.')
  ])

  const snapshot = engine.snapshot(start + 30_000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].endReason, 'zone')
  assert.equal(snapshot.combatState.autoAttackWarning, false)
})

test('incoming DOT can extend an active fight without arming AA warning', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul for 20 points of damage.'),
    line(1, 'You have taken 12 damage from Choking by a ghoul.')
  ])

  const snapshot = engine.snapshot(start + 2_000)
  assert.equal(snapshot.currentFight?.target, 'a ghoul')
  assert.equal(snapshot.combatState.autoAttackWarning, false)
})

test('parses periodic incoming spell damage separately from direct attacks', () => {
  const event = parseCombatLine(
    line(0, 'You have taken 20 damage from Dooming Darkness by King Tranix.')
  )

  assert.equal(event?.kind, 'incoming-dot')
  if (event?.kind === 'incoming-dot') {
    assert.equal(event.attacker, 'King Tranix')
  }
})

test('recognizes pet kill line shape from live log', () => {
  const event = parseCombatLine(line(0, 'A zol ghoul knight has been slain by Zonartik!'))

  assert.equal(event?.kind, 'kill')
  if (event?.kind === 'kill') {
    assert.equal(event.target, 'A zol ghoul knight')
    assert.equal(event.killer, 'Zonartik')
  }
})


test('keeps the Aug 9 09:19 live spectre as one continuous encounter', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    '[Sun Aug 09 09:19:34 2026] A spectre tries to slash YOU, but misses!',
    '[Sun Aug 09 09:19:34 2026] A spectre cleaves YOU for 20 points of damage.',
    '[Sun Aug 09 09:19:34 2026] a spectre hit you for 36 points of magic damage by Specter Lifetap.',
    '[Sun Aug 09 09:19:35 2026] Auto attack is on.',
    '[Sun Aug 09 09:19:35 2026] You backstab a spectre for 153 points of damage.',
    '[Sun Aug 09 09:19:35 2026] You backstab a spectre for 702 points of damage.',
    '[Sun Aug 09 09:19:35 2026] You slash a spectre for 19 points of damage.',
    '[Sun Aug 09 09:19:37 2026] A spectre slashes YOU for 27 points of damage.',
    '[Sun Aug 09 09:19:37 2026] You slash a spectre for 48 points of damage.',
    '[Sun Aug 09 09:19:37 2026] You pierce a spectre for 87 points of damage.',
    '[Sun Aug 09 09:19:39 2026] You pierce a spectre for 84 points of damage.',
    '[Sun Aug 09 09:19:41 2026] A spectre slashes YOU for 10 points of damage.',
    '[Sun Aug 09 09:19:42 2026] You slash a spectre for 34 points of damage.',
    '[Sun Aug 09 09:19:42 2026] You pierce a spectre for 54 points of damage.',
    '[Sun Aug 09 09:19:43 2026] A spectre bashes YOU for 7 points of damage.',
    '[Sun Aug 09 09:19:43 2026] You backstab a spectre for 366 points of damage.',
    '[Sun Aug 09 09:19:44 2026] You pierce a spectre for 100 points of damage. (Critical)',
    '[Sun Aug 09 09:19:45 2026] A spectre slashes YOU for 48 points of damage.',
    '[Sun Aug 09 09:19:46 2026] You slash a spectre for 185 points of damage. (Finishing Blow)',
    '[Sun Aug 09 09:19:46 2026] You slash a spectre for 78 points of damage. (Finishing Blow)',
    '[Sun Aug 09 09:19:46 2026] You have slain a spectre!'
  ])

  const snapshot = engine.snapshot(Date.parse('Sun Aug 09 09:19:46 2026'))
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)

  const fight = snapshot.fights[0]
  assert.equal(fight.endReason, 'victory')
  assert.equal(fight.totalDamage, 1910)
  assert.equal(fight.startedAt, Date.parse('Sun Aug 09 09:19:34 2026'))
  assert.equal(fight.endedAt, Date.parse('Sun Aug 09 09:19:46 2026'))
})

test('incoming attacks against a known pet refresh encounter activity', () => {
  const engine = new FightEngine({ fightTimeoutMs: 10_000 })

  engine.ingestLines([
    line(0, "Jann told you, 'Attacking a spectre Master.'"),
    line(1, 'You slash a spectre for 40 points of damage.'),
    line(9, 'A spectre slashes Jann for 10 points of damage.'),
    line(17, 'A spectre tries to bash Jann, but misses!'),
    line(18, 'You slash a spectre for 20 points of damage.'),
    line(19, 'You have slain a spectre!')
  ])

  const snapshot = engine.snapshot(start + 19_000)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].endReason, 'victory')
  assert.equal(snapshot.fights[0].totalDamage, 60)
})


test('recognizes Entrance and Entranced as crowd control', () => {
  const event = parseCombatLine(
    line(0, 'a dar ghoul knight has been entranced.')
  )

  assert.equal(event?.kind, 'crowd-control')
  if (event?.kind === 'crowd-control') {
    assert.equal(event.target, 'a dar ghoul knight')
    assert.equal(event.effect, 'mez')
  }
})

test('controlled room pull survives long prep silence and resumes as one encounter', () => {
  const engine = new FightEngine({ fightTimeoutMs: 30_000 })

  engine.ingestLines([
    line(0, 'Hoptor Thaggelum pet tries to punch YOU, but misses!'),
    line(1, 'Hoptor Thaggelum hits YOU for 100 points of damage.'),
    line(2, 'You begin casting Mesmerization VII.'),
    line(3, 'Hoptor Thaggelum pet has been mesmerized.'),
    line(3, 'Hoptor Thaggelum has been mesmerized.'),
    line(10, 'You have slain Hoptor Thaggelum pet!'),
    line(20, 'You begin casting Entrance VI.'),
    line(21, 'a dar ghoul knight has been entranced.'),
    line(55, 'Your Mesmerization spell has worn off of Hoptor Thaggelum.'),
    line(55, 'You slash Hoptor Thaggelum for 200 points of damage.'),
    line(70, 'You have slain Hoptor Thaggelum!'),
    line(71, 'A dar ghoul knight hits YOU for 20 points of damage.'),
    line(80, 'You have slain a dar ghoul knight!')
  ])

  const snapshot = engine.snapshot(start + 80_000)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].endReason, 'victory')
  assert.ok(snapshot.fights[0].targets.includes('Hoptor Thaggelum'))
  assert.ok(snapshot.fights[0].targets.includes('a dar ghoul knight'))
})

test('owner death retires an engaged NPC pet that vanishes without its own kill line', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'A wan ghoul knight hits YOU for 20 points of damage.'),
    line(1, 'A wan ghoul knight pet hits YOU for 10 points of damage.'),
    line(2, 'You have slain a wan ghoul knight!')
  ])

  const snapshot = engine.snapshot(start + 2_000)
  assert.equal(snapshot.currentFight, null)
  assert.equal(snapshot.fights.length, 1)
  assert.equal(snapshot.fights[0].endReason, 'victory')
})

test('parses enemy spell cast and explicit interrupt', () => {
  const cast = parseCombatLine(
    line(0, 'A frenzied ghoul begins casting Greater Healing.')
  )
  const interrupted = parseCombatLine(
    line(1, "a frenzied ghoul's Greater Healing spell is interrupted.")
  )

  assert.equal(cast?.kind, 'enemy-spell-cast')
  assert.equal(interrupted?.kind, 'enemy-spell-interrupt')
})


test('tracks per-mob burn DPS separately from total encounter duration', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'A dar ghoul knight hits YOU for 20 points of damage.'),
    line(1, 'You begin casting Mesmerization VII.'),
    line(2, 'a dar ghoul knight has been mesmerized.'),
    line(20, 'Hoptor Thaggelum hits YOU for 50 points of damage.'),
    line(21, 'Hoptor Thaggelum has been mesmerized.'),
    line(40, 'Your Mesmerization spell has worn off of Hoptor Thaggelum.'),
    line(41, 'You slash Hoptor Thaggelum for 100 points of damage.'),
    line(46, 'You slash Hoptor Thaggelum for 100 points of damage.'),
    line(51, 'You have slain Hoptor Thaggelum!'),
    line(52, 'Your Mesmerization spell has worn off of a dar ghoul knight.'),
    line(53, 'You slash a dar ghoul knight for 60 points of damage.'),
    line(58, 'You slash a dar ghoul knight for 60 points of damage.'),
    line(63, 'You have slain a dar ghoul knight!')
  ])

  const fight = engine.snapshot(start + 63_000).fights[0]
  assert.equal(fight.endReason, 'victory')

  const hoptor = fight.mobs.find((mob) => /Hoptor/i.test(mob.name))
  const dar = fight.mobs.find((mob) => /dar ghoul/i.test(mob.name))

  assert.ok(hoptor)
  assert.ok(dar)
  assert.equal(hoptor.totalDamage, 200)
  assert.equal(hoptor.burnDurationSeconds, 10)
  assert.equal(hoptor.activeDamage, 200)
  assert.equal(hoptor.dps, 20)
  assert.equal(dar.totalDamage, 120)
  assert.equal(dar.burnDurationSeconds, 10)
  assert.equal(dar.activeDamage, 120)
  assert.equal(dar.dps, 12)
})

test('marks a mob first observed later as joining the encounter later', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'A ghoul hits YOU for 10 points of damage.'),
    line(1, 'You slash a ghoul for 25 points of damage.'),
    line(12, 'A ghoul wizard hits YOU for 15 points of damage.'),
    line(13, 'You slash a ghoul wizard for 30 points of damage.'),
    line(14, 'You have slain a ghoul!'),
    line(15, 'You have slain a ghoul wizard!')
  ])

  const fight = engine.snapshot(start + 15_000).fights[0]
  const add = fight.mobs.find((mob) => /wizard/i.test(mob.name))

  assert.ok(add)
  assert.equal(add.joinedOffsetMs, 12_000)
  assert.equal(add.joinedLater, true)
})


test('does not overwrite an explicit pet death when the owner dies later', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'Hoptor Thaggelum pet hits YOU for 10 points of damage.'),
    line(1, 'You hit Hoptor Thaggelum pet for 100 points of damage.'),
    line(5, 'You have slain Hoptor Thaggelum pet!'),
    line(6, 'Hoptor Thaggelum hits YOU for 10 points of damage.'),
    line(7, 'You hit Hoptor Thaggelum for 100 points of damage.'),
    line(20, 'You have slain Hoptor Thaggelum!')
  ])

  const fight = engine.snapshot(start + 20_000).fights[0]
  const pet = fight.mobs.find((mob) => /Hoptor Thaggelum pet/i.test(mob.name))

  assert.ok(pet)
  assert.equal(pet.killedAt, start + 5_000)
})

test('damage shield damage does not start a target burn', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'Hoptor Thaggelum hits YOU for 10 points of damage.'),
    line(1, 'Hoptor Thaggelum is pierced by YOUR thorns for 25 points of non-melee damage.'),
    line(20, 'You hit Hoptor Thaggelum for 100 points of damage.'),
    line(25, 'You hit Hoptor Thaggelum for 100 points of damage.'),
    line(30, 'You have slain Hoptor Thaggelum!')
  ])

  const fight = engine.snapshot(start + 30_000).fights[0]
  const hoptor = fight.mobs.find((mob) => /Hoptor/i.test(mob.name))

  assert.ok(hoptor)
  assert.equal(hoptor.totalDamage, 225)
  assert.equal(hoptor.activeDamage, 200)
  assert.equal(hoptor.burnStartedAt, start + 20_000)
  assert.equal(hoptor.burnDurationSeconds, 10)
  assert.equal(hoptor.dps, 20)
})

test('splits per-mob active DPS across long parked gaps', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'A dar ghoul knight hits YOU for 10 points of damage.'),
    line(1, 'You hit a dar ghoul knight for 100 points of damage.'),
    line(5, 'You hit a dar ghoul knight for 100 points of damage.'),
    line(6, 'You begin casting Mesmerization VII.'),
    line(7, 'a dar ghoul knight has been mesmerized.'),
    line(90, 'Your Mesmerization spell has worn off of a dar ghoul knight.'),
    line(91, 'You hit a dar ghoul knight for 100 points of damage.'),
    line(95, 'You hit a dar ghoul knight for 100 points of damage.'),
    line(100, 'You have slain a dar ghoul knight!')
  ])

  const fight = engine.snapshot(start + 100_000).fights[0]
  const dar = fight.mobs.find((mob) => /dar ghoul knight/i.test(mob.name))

  assert.ok(dar)
  assert.equal(dar.burnSegments.length, 2)
  assert.equal(dar.burnDurationSeconds, 14)
  assert.equal(dar.activeDamage, 400)
  assert.equal(dar.elapsedTtkSeconds, 99)
  assert.ok(Math.abs(dar.dps - 400 / 14) < 0.001)
})

test('prefers a real NPC over its pet for the encounter title', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'Hoptor Thaggelum pet hits YOU for 10 points of damage.'),
    line(1, 'Hoptor Thaggelum hits YOU for 10 points of damage.'),
    line(2, 'You hit Hoptor Thaggelum pet for 100 points of damage.'),
    line(3, 'You have slain Hoptor Thaggelum pet!'),
    line(4, 'You hit Hoptor Thaggelum for 100 points of damage.'),
    line(5, 'You have slain Hoptor Thaggelum!')
  ])

  const fight = engine.snapshot(start + 5_000).fights[0]
  assert.match(fight.target, /^Hoptor Thaggelum \+/)
})


test('classifies named direct spell damage before generic melee hit', () => {
  const event = parseCombatLine(
    line(0, 'You hit a ghoul for 147 points of magic damage by Smiting Strike.')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.source, 'spell')
    assert.equal(event.ability, 'Smiting Strike')
    assert.equal(event.damage, 147)
  }
})

test('preserves player melee ability and critical type', () => {
  const event = parseCombatLine(
    line(0, 'You pierce a ghoul for 100 points of damage. (Critical)')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.source, 'melee')
    assert.equal(event.ability, 'Pierce')
    assert.equal(event.critical, 'critical')
  }
})

test('recognizes expanded melee verbs', () => {
  const smash = parseCombatLine(
    line(0, 'You smash a ghoul for 81 points of damage.')
  )
  const gore = parseCombatLine(
    line(1, 'You gore a ghoul for 92 points of damage.')
  )

  assert.equal(smash?.kind, 'player-damage')
  assert.equal(gore?.kind, 'player-damage')
})

test('preserves player DOT spell name', () => {
  const event = parseCombatLine(
    line(0, 'A ghoul has taken 53 damage from your Immolate.')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.source, 'dot')
    assert.equal(event.ability, 'Immolate')
  }
})

test('attributes known pet DOT damage', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, "Jann told you, 'Attacking a ghoul Master.'"),
    line(1, 'A ghoul has taken 44 damage from Burning Affliction by Jann.'),
    line(2, 'You have slain a ghoul!')
  ])

  const fight = engine.snapshot(start + 2_000).fights[0]
  assert.equal(fight.petDamage, 44)

  const ability = fight.abilities.find(
    (item) => item.actor === 'Jann' && item.ability === 'Burning Affliction'
  )
  assert.ok(ability)
  assert.equal(ability.source, 'dot')
  assert.equal(ability.damage, 44)
})

test('builds per-ability damage breakdown for loadout analysis', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'You backstab a ghoul for 200 points of damage.'),
    line(1, 'You backstab a ghoul for 300 points of damage. (Critical)'),
    line(2, 'You hit a ghoul for 100 points of magic damage by Smiting Strike.'),
    line(3, 'You have slain a ghoul!')
  ])

  const fight = engine.snapshot(start + 3_000).fights[0]
  const backstab = fight.abilities.find(
    (item) => item.actorType === 'player' && item.ability === 'Backstab'
  )
  const proc = fight.abilities.find(
    (item) => item.actorType === 'player' && item.ability === 'Smiting Strike'
  )

  assert.ok(backstab)
  assert.equal(backstab.damage, 500)
  assert.equal(backstab.hits, 2)
  assert.equal(backstab.criticalHits, 1)
  assert.equal(backstab.bestHit, 300)

  assert.ok(proc)
  assert.equal(proc.source, 'spell')
  assert.equal(proc.damage, 100)
})


test('parses Slay Undead damage without dropping the hit', () => {
  const event = parseCombatLine(
    line(0, 'You backstab a yun ghoul wizard for 1159 points of damage. (Slay Undead)')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.source, 'melee')
    assert.equal(event.ability, 'Backstab')
    assert.equal(event.damage, 1159)
    assert.equal(event.modifier, 'Slay Undead')
    assert.equal(event.critical, null)
  }
})

test('parses Riposte-tagged outgoing damage without dropping the hit', () => {
  const event = parseCombatLine(
    line(0, 'You slash a dar ghoul knight for 28 points of damage. (Riposte)')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.source, 'melee')
    assert.equal(event.ability, 'Slash')
    assert.equal(event.damage, 28)
    assert.equal(event.modifier, 'Riposte')
    assert.equal(event.critical, null)
  }
})

test('preserves an unknown future damage modifier instead of dropping damage', () => {
  const event = parseCombatLine(
    line(0, 'You pierce a ghoul for 222 points of damage. (Some Future EQL Modifier)')
  )

  assert.equal(event?.kind, 'player-damage')
  if (event?.kind === 'player-damage') {
    assert.equal(event.damage, 222)
    assert.equal(event.ability, 'Pierce')
    assert.equal(event.modifier, 'Some Future EQL Modifier')
    assert.equal(event.critical, null)
  }
})

test('ability breakdown counts modifiers independently from crits', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'You backstab a ghoul for 100 points of damage. (Critical)'),
    line(1, 'You backstab a ghoul for 500 points of damage. (Slay Undead)'),
    line(2, 'You backstab a ghoul for 80 points of damage. (Riposte)'),
    line(3, 'You have slain a ghoul!')
  ])

  const fight = engine.snapshot(start + 3_000).fights[0]
  const backstab = fight.abilities.find(
    (item) => item.actorType === 'player' && item.ability === 'Backstab'
  )

  assert.ok(backstab)
  assert.equal(backstab.damage, 680)
  assert.equal(backstab.hits, 3)
  assert.equal(backstab.criticalHits, 1)
  assert.equal(backstab.bestHit, 500)
  assert.equal(backstab.modifiers['Critical'], 1)
  assert.equal(backstab.modifiers['Slay Undead'], 1)
  assert.equal(backstab.modifiers['Riposte'], 1)
})


test('normalizes inflected pet cleave as Cleave', () => {
  const event = parseCombatLine(
    line(0, 'Keker cleaves a zol ghoul knight for 56 points of damage.')
  )

  assert.equal(event?.kind, 'actor-damage')
  if (event?.kind === 'actor-damage') {
    assert.equal(event.ability, 'Cleave')
  }
})

test('recognizes successful charm and clears a stale AA warning', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'Auto attack is off.'),
    line(1, 'ice boned skeleton punches YOU for 6 points of damage.')
  ])

  assert.equal(
    engine.snapshot(start + 6_000).combatState.autoAttackWarning,
    true
  )

  engine.ingestLines([
    line(7, 'ice boned skeleton has been charmed.')
  ])

  assert.equal(
    engine.snapshot(start + 7_000).combatState.autoAttackWarning,
    false
  )
})

test('successful charm immediately enables pet damage attribution', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'ice boned skeleton hits YOU for 6 points of damage.'),
    line(1, 'ice boned skeleton has been charmed.'),
    line(2, 'ice boned skeleton slashes a necro theurgist for 40 points of damage.'),
    line(3, 'A necro theurgist has been slain by ice boned skeleton!')
  ])

  const fight = engine
    .snapshot(start + 3_000)
    .fights.find((candidate) => candidate.petDamage === 40)

  assert.ok(fight)
  assert.equal(fight.petDamage, 40)
})


test('player spell cast preserves spell name for charm ownership tracking', () => {
  const event = parseCombatLine(line(0, 'You begin casting Cajoling Whispers.'))
  assert.equal(event?.kind, 'player-spell-cast')
  if (event?.kind === 'player-spell-cast') {
    assert.equal(event.spell, 'Cajoling Whispers')
  }
})

test('generic worn-off line preserves spell and target', () => {
  const event = parseCombatLine(
    line(0, 'Your Cajoling Whispers spell has worn off of a dar ghoul knight.')
  )
  assert.equal(event?.kind, 'player-effect-worn-off')
  if (event?.kind === 'player-effect-worn-off') {
    assert.equal(event.spell, 'Cajoling Whispers')
    assert.equal(event.target, 'a dar ghoul knight')
  }
})

test('charm break returns pet to hostile state without ever targeting You', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'You begin casting Cajoling Whispers.'),
    line(1, 'a dar ghoul knight has been charmed.'),
    line(2, "A dar ghoul knight told you, 'Attacking a ghoul scribe Master.'"),
    line(3, 'A dar ghoul knight slashes a ghoul scribe for 40 points of damage.'),
    line(4, 'A ghoul scribe has been slain by A dar ghoul knight!'),
    line(5, 'Your Cajoling Whispers spell has worn off of a dar ghoul knight.'),
    line(6, 'A dar ghoul knight pierces YOU for 33 points of damage.'),
    line(7, 'You slash a dar ghoul knight for 80 points of damage.'),
    line(8, 'You have slain a dar ghoul knight!')
  ])

  const snapshot = engine.snapshot(start + 8_000)
  const finalFight = snapshot.fights[snapshot.fights.length - 1]

  assert.equal(finalFight.endReason, 'victory')
  assert.equal(finalFight.targets.some((target) => /^you$/i.test(target)), false)
  assert.equal(finalFight.petDamage, 0)
})

test('charm can break and be re-established on the same NPC', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'You begin casting Charm.'),
    line(1, 'ice boned skeleton has been charmed.'),
    line(2, 'ice boned skeleton slashes a necro theurgist for 20 points of damage.'),
    line(3, 'Your Charm spell has worn off of ice boned skeleton.'),
    line(4, 'Ice boned skeleton punches YOU for 6 points of damage.'),
    line(5, 'You begin casting Charm.'),
    line(6, 'ice boned skeleton has been charmed.'),
    line(7, 'ice boned skeleton slashes a necro theurgist for 30 points of damage.'),
    line(8, 'A necro theurgist has been slain by ice boned skeleton!')
  ])

  const fights = engine.snapshot(start + 8_000).fights
  const petDamage = fights.reduce((total, fight) => total + fight.petDamage, 0)
  assert.equal(petDamage, 50)
})

test('Riposte Critical is both preserved and counted as a critical', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul sentinel for 157 points of damage. (Riposte Critical)'),
    line(1, 'You have slain a ghoul sentinel!')
  ])

  const slash = engine.snapshot(start + 1000).fights[0].abilities.find(
    (ability) => ability.ability === 'Slash'
  )

  assert.ok(slash)
  assert.equal(slash.criticalHits, 1)
  assert.equal(slash.modifiers['Riposte Critical'], 1)
  assert.equal(slash.modifierDamage['Riposte Critical'], 157)
})

test('Finishing Blow remains a special modifier but is not counted as a crit', () => {
  const engine = new FightEngine()
  engine.ingestLines([
    line(0, 'You slash a ghoul sentinel for 194 points of damage. (Finishing Blow)'),
    line(1, 'You have slain a ghoul sentinel!')
  ])

  const slash = engine.snapshot(start + 1000).fights[0].abilities.find(
    (ability) => ability.ability === 'Slash'
  )

  assert.ok(slash)
  assert.equal(slash.criticalHits, 0)
  assert.equal(slash.modifiers['Finishing Blow'], 1)
})


test('casting resets an armed AA warning inactivity clock', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'Auto attack is off.'),
    line(1, 'an elemental warrior hits YOU for 40 points of damage.')
  ])

  assert.equal(
    engine.snapshot(start + 6_000).combatState.autoAttackWarning,
    true
  )

  engine.ingestLines([
    line(7, 'You begin casting Tashania.')
  ])

  assert.equal(
    engine.snapshot(start + 11_000).combatState.autoAttackWarning,
    false
  )

  assert.equal(
    engine.snapshot(start + 15_100).combatState.autoAttackWarning,
    true
  )
})

test('repeated casting keeps AA warning quiet during active recovery', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, 'Auto attack is off.'),
    line(1, 'an elemental warrior hits YOU for 40 points of damage.'),
    line(4, 'You begin casting Tashania.'),
    line(6, 'an elemental warrior hits YOU for 35 points of damage.'),
    line(8, 'You begin casting Cajoling Whispers.'),
    line(10, 'an elemental warrior hits YOU for 30 points of damage.'),
    line(12, 'You begin casting Cajoling Whispers.')
  ])

  assert.equal(
    engine.snapshot(start + 16_000).combatState.autoAttackWarning,
    false
  )

  assert.equal(
    engine.snapshot(start + 20_100).combatState.autoAttackWarning,
    true
  )
})


test('incoming attacks against known pet arm inactivity warning', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, "Kasn told you, 'Attacking a rock golem Master.'"),
    line(1, 'A rock golem hits Kasn for 40 points of damage.')
  ])

  assert.equal(
    engine.snapshot(start + 5_900).combatState.autoAttackWarning,
    false
  )

  assert.equal(
    engine.snapshot(start + 6_100).combatState.autoAttackWarning,
    true
  )
})

test('casting activity suppresses pet-under-attack warning during recovery', () => {
  const engine = new FightEngine()

  engine.ingestLines([
    line(0, "Kasn told you, 'Attacking a rock golem Master.'"),
    line(1, 'A rock golem hits Kasn for 40 points of damage.'),
    line(4, 'You begin casting Greater Healing.')
  ])

  assert.equal(
    engine.snapshot(start + 11_900).combatState.autoAttackWarning,
    false
  )

  assert.equal(
    engine.snapshot(start + 12_100).combatState.autoAttackWarning,
    true
  )
})
