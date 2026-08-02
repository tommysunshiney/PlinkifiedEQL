#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as cheerio from 'cheerio'

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/, '').split('=')
    return [key, valueParts.join('=') || 'true']
  })
)

const API_URL = 'https://eqlwiki.com/api.php'
const WIKI_ROOT = 'https://eqlwiki.com'
const CATEGORY = String(
  args.category ?? process.env.PEQL_BOSS_CATEGORY ?? 'Category:Named Mobs'
)
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  String(args.output ?? process.env.PEQL_BOSS_OUTPUT ?? 'resources/bosses.seed.json')
)
const OVERRIDES_PATH = path.resolve(
  process.cwd(),
  String(
    args.overrides ??
      process.env.PEQL_BOSS_OVERRIDES ??
      'resources/boss-overrides.json'
  )
)
const REQUEST_DELAY_MS = Number(
  args.delay ?? process.env.PEQL_WIKI_DELAY_MS ?? 125
)
const LIMIT = Number(args.limit ?? process.env.PEQL_WIKI_LIMIT ?? 0)
const USER_AGENT =
  process.env.PEQL_WIKI_USER_AGENT ??
  'PlinkifiedEQL/0.1 named-mob importer (local development)'

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchJson(parameters) {
  const url = new URL(API_URL)
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`EQL Wiki request failed: ${response.status} ${url}`)
  }

  return response.json()
}

async function getCategoryMembers() {
  const pages = []
  let continuation = null

  do {
    const payload = await fetchJson({
      action: 'query',
      format: 'json',
      formatversion: 2,
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmnamespace: 0,
      cmlimit: 'max',
      ...(continuation ? { cmcontinue: continuation } : {})
    })

    pages.push(...(payload.query?.categorymembers ?? []))
    continuation = payload.continue?.cmcontinue ?? null
  } while (continuation)

  return LIMIT > 0 ? pages.slice(0, LIMIT) : pages
}

async function getParsedPage(title) {
  return fetchJson({
    action: 'parse',
    format: 'json',
    formatversion: 2,
    page: title,
    prop: 'text|categories|revid|displaytitle'
  })
}

function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function sectionAfterHeading($, headingText) {
  const heading = $('h2, h3').filter((_, element) =>
    cleanText($(element).text())
      .toLowerCase()
      .includes(headingText.toLowerCase())
  ).first()

  if (!heading.length) return $()

  const nodes = []
  let current = heading.next()
  while (current.length && !/^H[23]$/.test(current[0].tagName?.toUpperCase())) {
    nodes.push(current[0])
    current = current.next()
  }

  return $(nodes)
}

function extractZone($) {
  const statBlock = sectionAfterHeading($, 'Stat Block')
  const text = cleanText(statBlock.text())
  const zoneMatch = text.match(/(?:^|\s)Zone:\s*(.+?)(?=\s(?:Location|Stats|AC|HP|Level|Race|Class):|$)/i)
  if (zoneMatch) return cleanText(zoneMatch[1])

  const zoneLabel = $('body *').filter((_, element) =>
    /^Zone:\s*$/i.test(cleanText($(element).text()))
  ).first()
  if (zoneLabel.length) {
    const linked = zoneLabel.nextAll('a').first().text()
    if (linked) return cleanText(linked)
  }

  return null
}

function extractKnownDrops($) {
  const section = sectionAfterHeading($, 'Known Loot')
  const values = []

  section.find('li').each((_, element) => {
    const firstLink = $(element).find('a').first()
    const name = cleanText(firstLink.text())
    if (name && !/^(image|edit|upload image)$/i.test(name)) values.push(name)
  })

  return [...new Set(values)]
}

function titleFromPageName(pageTitle) {
  const match = pageTitle.match(/^(.+?)\s*\(([^)]+)\)$/)
  if (!match) return { npcName: pageTitle, title: null, aliases: [] }

  return {
    npcName: cleanText(match[1]),
    title: cleanText(match[2]),
    aliases: [pageTitle]
  }
}

async function loadOverrides() {
  try {
    const value = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8'))
    return value.records ?? {}
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    throw error
  }
}

async function main() {
  console.log(`Fetching ${CATEGORY} from ${WIKI_ROOT}...`)
  const members = await getCategoryMembers()
  const overrides = await loadOverrides()
  const records = []

  console.log(`Found ${members.length} boss pages.`)

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]
    const payload = await getParsedPage(member.title)
    const parsed = payload.parse

    if (!parsed?.text) {
      console.warn(`Skipping ${member.title}: page parse was empty.`)
      continue
    }

    const $ = cheerio.load(parsed.text)
    const inferred = titleFromPageName(member.title)
    const override = overrides[member.title] ?? {}
    const npcName = override.npcName ?? inferred.npcName
    const title = override.title ?? inferred.title
    const zone = override.zone ?? extractZone($)
    const knownDrops = override.knownDrops ?? extractKnownDrops($)
    const aliases = [
      ...inferred.aliases,
      ...(override.aliases ?? []),
      ...(title ? [title] : [])
    ]

    records.push({
      npcName,
      title,
      zone,
      aliases: [...new Set(aliases.filter(Boolean))],
      knownDrops: [...new Set(knownDrops.filter(Boolean))],
      wikiPageTitle: member.title,
      wikiUrl: `${WIKI_ROOT}/${encodeURIComponent(member.title.replace(/ /g, '_'))}`,
      sourceRevision: Number(parsed.revid) || null
    })

    console.log(
      `[${index + 1}/${members.length}] ${npcName}${title ? ` (${title})` : ''}${zone ? ` — ${zone}` : ''}`
    )

    if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS)
  }

  records.sort((left, right) =>
    (left.zone ?? '').localeCompare(right.zone ?? '') ||
    left.npcName.localeCompare(right.npcName)
  )

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(records, null, 2)}\n`)
  console.log(`Wrote ${records.length} boss records to ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
