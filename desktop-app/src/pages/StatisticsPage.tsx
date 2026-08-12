import { useEffect, useMemo, useState } from 'react'
import type { EncounterAbilityBreakdown, EncounterRecord } from '../types/database'
import '../App.css'

const triggered = new Set([
  'ykesha','blood siphon strike','blood draw strike','asp venom strike',
  'cobra venom strike','weakening strike','hobbling strike',
  'befuddling strike','concussive strike','clumsiness strike','banishing strike'
])
const special = new Set([
  'backstab','bash','kick','reave','slam','frenzy','gore','smash',
  'rend','sting','maul','bite','claw'
])
const norm = (value: string) => value.trim().toLowerCase()

function category(a: EncounterAbilityBreakdown) {
  const n = norm(a.ability)
  if (a.actorType === 'pet') return 'Pet'
  if (triggered.has(n)) return 'Triggered Effects'
  if (a.source === 'melee' && special.has(n)) return 'Special Attacks'
  if (a.source === 'melee') return 'Melee'
  if (a.source === 'dot') return 'DoTs'
  if (a.source === 'damage-shield') return 'Damage Shield'
  return 'Spells / Effects'
}

function dur(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export default function StatisticsPage() {
  const [rows, setRows] = useState<EncounterRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let dead = false
    window.electronAPI.listEncounters(5000)
      .then((records) => { if (!dead) setRows(records) })
      .catch((e) => {
        console.error(e)
        if (!dead) setError('Unable to load combat analytics.')
      })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [])

  const a = useMemo(() => {
    const fights = rows.filter((x) => x.outcome === 'victory')
    const covered = fights.filter((x) => x.abilities.length)
    const total = fights.reduce((n, x) => n + x.totalDamage, 0)
    const time = fights.reduce((n, x) => n + x.durationMs, 0)
    const kills = fights.reduce((n, x) => n + x.mobKillCount, 0)
    const player = fights.reduce((n, x) => n + x.playerDamage, 0)
    const pet = fights.reduce((n, x) => n + x.petDamage, 0)
    const best = Math.max(0, ...fights.map((x) => x.dps))
    const bestHit = Math.max(0, ...fights.map((x) => x.bestHit))
    const suspiciousSelfTargets = rows.filter((x) =>
      (x.targetNames ?? []).some((name) => /^(?:you|whittler)$/i.test(name.trim()))
    ).length
    const zeroDamageTimeouts = rows.filter(
      (x) => x.endReason === 'timeout' && x.totalDamage === 0
    ).length
    const timeoutFights = rows.filter((x) => x.endReason === 'timeout').length

    const map = new Map<string, {
      ability: string
      cat: string
      actorType: string
      damage: number
      hits: number
      crits: number
      best: number
    }>()
    const cats = new Map<string, number>()
    const modifiers = new Map<string, { count: number; damage: number }>()

    for (const fight of covered) {
      for (const x of fight.abilities) {
        const cat = category(x)
        const key = [x.actorType, norm(x.actor), norm(x.ability), cat].join('|')
        const current = map.get(key)
        if (current) {
          current.damage += x.damage
          current.hits += x.hits
          current.crits += x.criticalHits
          current.best = Math.max(current.best, x.bestHit)
        } else {
          map.set(key, {
            ability: x.ability,
            cat,
            actorType: x.actorType,
            damage: x.damage,
            hits: x.hits,
            crits: x.criticalHits,
            best: x.bestHit
          })
        }
        cats.set(cat, (cats.get(cat) ?? 0) + x.damage)

        for (const [name, count] of Object.entries(x.modifiers ?? {})) {
          const item = modifiers.get(name) ?? { count: 0, damage: 0 }
          item.count += count
          item.damage += x.modifierDamage?.[name] ?? 0
          modifiers.set(name, item)
        }
      }
    }

    const abilities = [...map.values()].sort((x, y) => y.damage - x.damage)
    const categories = [...cats]
      .map(([name, damage]) => ({ name, damage }))
      .sort((x, y) => y.damage - x.damage)
    const modifierRows = [...modifiers]
      .map(([name, value]) => ({ name, ...value }))
      .sort((x, y) => y.damage - x.damage || y.count - x.count)

    const targets = new Map<string, { name: string; fights: number; damage: number; time: number }>()
    for (const x of fights) {
      const key = norm(x.primaryNpcName)
      const current = targets.get(key)
      if (current) {
        current.fights += 1
        current.damage += x.totalDamage
        current.time += x.durationMs
      } else {
        targets.set(key, {
          name: x.primaryNpcName,
          fights: 1,
          damage: x.totalDamage,
          time: x.durationMs
        })
      }
    }

    return {
      fights, covered, total, time, kills, player, pet, best, bestHit,
      dps: time ? total / (time / 1000) : 0,
      abilities, categories, modifierRows,
      suspiciousSelfTargets, zeroDamageTimeouts, timeoutFights,
      targets: [...targets.values()]
        .sort((x, y) => y.fights - x.fights)
        .slice(0, 10)
    }
  }, [rows])

  if (loading) {
    return <div className="analytics-page"><h2>Combat Analytics</h2><p>Loading persisted fights...</p></div>
  }

  return (
    <div className="analytics-page">
      <div className="analytics-heading">
        <div>
          <span className="analytics-kicker">PLINKIFIED EQL</span>
          <h2>Combat Analytics</h2>
          <p>Persistent combat performance across saved encounters.</p>
        </div>
        <span className="analytics-version">1.0 RC</span>
      </div>

      {error && <div className="connection-warning">{error}</div>}

      <div className="analytics-coverage">
        <strong>Ability detail:</strong> {a.covered.length} of {a.fights.length} completed fights.
        Older fights still count in totals; modifiers populate as fights are saved/replayed with v1.1.
      </div>

      <div className="analytics-summary-grid">
        {[
          ['Fights', a.fights.length],
          ['Kills', a.kills],
          ['Combat Time', dur(a.time)],
          ['Weighted DPS', a.dps.toFixed(1)],
          ['Total Damage', a.total.toLocaleString()],
          ['Your Damage', a.player.toLocaleString()],
          ['Pet Damage', a.pet.toLocaleString()],
          ['Best Fight DPS', a.best.toFixed(1)],
          ['Best Hit', a.bestHit.toLocaleString()]
        ].map(([k, v]) => (
          <div className="analytics-stat" key={String(k)}>
            <span>{k}</span><strong>{v}</strong>
          </div>
        ))}
      </div>

      <div className="analytics-columns">
        <section className="analytics-card">
          <h3>Damage Sources</h3>
          <div className="analytics-source-list">
            {a.categories.map((x) => (
              <div className="analytics-source-row" key={x.name}>
                <strong>{x.name}</strong><strong>{x.damage.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-card">
          <h3>Combat Modifiers</h3>
          {a.modifierRows.length === 0 ? (
            <p style={{ opacity: 0.72 }}>No persisted modifier detail yet. Fresh/replayed fights will populate this section.</p>
          ) : (
            <div className="analytics-source-list">
              {a.modifierRows.map((x) => (
                <div className="analytics-source-row" key={x.name}>
                  <div>
                    <strong>{x.name}</strong>
                    <div style={{ opacity: 0.7, fontSize: '0.82em' }}>{x.count} occurrence{x.count === 1 ? '' : 's'}</div>
                  </div>
                  <strong>{x.damage.toLocaleString()} dmg</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="analytics-columns">
        <section className="analytics-card">
          <h3>Top Targets</h3>
          <div className="analytics-target-list">
            {a.targets.map((x) => (
              <div className="analytics-target-row" key={x.name}>
                <div><strong>{x.name}</strong><span>{x.fights} fights</span></div>
                <strong>{(x.time ? x.damage / (x.time / 1000) : 0).toFixed(1)} DPS</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-card">
          <h3>Data Health</h3>
          <div className="analytics-source-list">
            <div className="analytics-source-row"><span>Victories with ability detail</span><strong>{a.covered.length}</strong></div>
            <div className="analytics-source-row"><span>Historical victories</span><strong>{a.fights.length}</strong></div>
            <div className="analytics-source-row"><span>Modifier types observed</span><strong>{a.modifierRows.length}</strong></div>
            <div className="analytics-source-row"><span>Timeout encounters</span><strong>{a.timeoutFights}</strong></div>
            <div className="analytics-source-row"><span>Zero-damage timeouts</span><strong>{a.zeroDamageTimeouts}</strong></div>
            <div className="analytics-source-row"><span>Impossible self-target fights</span><strong>{a.suspiciousSelfTargets}</strong></div>
          </div>
        </section>
      </div>

      <section className="analytics-card">
        <h3>Abilities & Triggered Effects</h3>
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Ability / Effect</th><th>Type</th><th>Damage</th>
                <th>Hits / Triggers</th><th>Crits</th><th>Best</th>
              </tr>
            </thead>
            <tbody>
              {a.abilities.slice(0, 50).map((x, i) => (
                <tr key={i}>
                  <td>
                    <strong>{x.ability}</strong>
                    {x.actorType === 'pet' && <span className="analytics-pet-tag">PET</span>}
                  </td>
                  <td>{x.cat}</td>
                  <td>{x.damage.toLocaleString()}</td>
                  <td>{x.hits}</td>
                  <td>{x.crits}</td>
                  <td>{x.best.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
