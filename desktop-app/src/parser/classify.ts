  import { EventType, ParsedEvent } from "./types"
  
  function classifyLogLine(line: string): EventType {
      const lower = line.toLowerCase()
   
  if (
    lower.includes('experience') ||
    lower.includes('you gain') ||
    lower.includes('you have gained')
  ) {
    return 'xp'
  }

  if (
    lower.includes('you receive') ||
    lower.includes('you have looted') ||
    lower.includes('you loot') ||
    lower.includes('has been added to your inventory')
  ) {
    return 'loot'
  }

  if (
    lower.includes('you have slain') ||
    lower.includes('you have killed') ||
    lower.includes('has been slain by you')
  ) {
    return 'kill'
  }

  if (
    lower.includes('you have been slain') ||
    lower.includes('you died') ||
    lower.includes('you have died')
  ) {
    return 'death'
  }

  if (
    lower.includes('begins to cast') ||
    lower.includes('you begin casting') ||
    lower.includes('you cast') ||
    lower.includes('spell') ||
    lower.includes('your spell')
  ) {
    return 'spell'
  }

  if (
    lower.includes(' tells you,') ||
    lower.includes(' you tell ') ||
    lower.includes('told you,')
  ) {
    return 'tell'
  }

  if (
    lower.includes(' hits ') ||
    lower.includes(' misses ') ||
    lower.includes(' crushes ') ||
    lower.includes(' slashes ') ||
    lower.includes(' pierces ') ||
    lower.includes(' backstabs ') ||
    lower.includes(' damage')
  ) {
    return 'combat'
  }

  if (
    lower.includes('you have entered') ||
    lower.includes('loading') ||
    lower.includes('error') ||
    lower.includes('server') ||
    lower.includes('system')
  ) {
    return 'system'
  }

  return 'other'
}
     export function parseLine(line: string): ParsedEvent {
    return {
        type: classifyLogLine(line),
        text: line
    }
} 

