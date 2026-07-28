export type EventType =
  | "xp"
  | "loot"
  | "kill"
  | "death"
  | "spell"
  | "combat"
  | "system"
  | "tell"
  | "other"

export interface ParsedEvent {
  type: EventType
  text: string
  timestamp?: string
}