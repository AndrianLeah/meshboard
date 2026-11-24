// The board's domain types, shared by every layer. Items are discriminated by `type`.

export type ColorKey = 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'blue' | 'green' | 'gray'
export type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'diamond'
export type BoxType = 'note' | ShapeType | 'text' | 'frame' | 'path'
export type ItemType = BoxType | 'arrow'
export type LineEnd = 'none' | 'arrow'

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

/** emoji → user id → when they reacted (ms since 1970; 1 for migrated votes) */
export type Reactions = Record<string, Record<string, number>>

interface ItemBase {
  id: string
  color: ColorKey
  /** stacking order among items of the same layer (frames are always below the rest) */
  z: number
  /** user id */
  author: string
  created: number
  locked: boolean
  /** group id, '' when not grouped */
  group: string
}

interface BoxBase extends ItemBase, Rect {}

export interface NoteItem extends BoxBase {
  type: 'note'
  text: string
  reactions: Reactions
}

export interface ShapeItem extends BoxBase {
  type: ShapeType
  text: string
}

export interface TextItem extends BoxBase {
  type: 'text'
  text: string
  fontSize: number
}

export interface FrameItem extends BoxBase {
  type: 'frame'
  /** the frame's title */
  text: string
}

export interface PathItem extends BoxBase {
  type: 'path'
  /** x, y pairs relative to the box, in the box it was drawn in (ow × oh) */
  points: number[]
  ow: number
  oh: number
  /** stroke width */
  width: number
}

export interface ArrowItem extends ItemBase {
  type: 'arrow'
  /** where the free ends are; an attached end follows its item */
  x1: number
  y1: number
  x2: number
  y2: number
  /** ids of the attached items, '' for a free end */
  from: string
  to: string
  start: LineEnd
  end: LineEnd
  dash: boolean
}

export type BoxItem = NoteItem | ShapeItem | TextItem | FrameItem | PathItem
export type Item = BoxItem | ArrowItem

/** `Omit` that keeps a union a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An item before it has an id: what `sanitizeItem` returns. */
export type ItemData = DistributiveOmit<Item, 'id'>

type Fields<T> = Omit<T, 'id' | 'type' | 'author' | 'created' | 'reactions'>

/** The fields `store.update` may change, on any kind of item. */
export type ItemPatch = Partial<Fields<NoteItem> & Fields<TextItem> & Fields<PathItem> & Fields<ArrowItem>>

/** What `store.create` takes: a type and any fields (the rest gets defaults). */
export type NewItem = { type: ItemType } & ItemPatch

/** Ends of a connector as drawn. */
export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface User {
  id: string
  name: string
}

/** A parsed invite: `<roomId>.<secret>`. */
export interface BoardToken {
  token: string
  roomId: string
  secret: string
}

/** Someone else on the board, as presence reports them. */
export interface Peer {
  uid: string
  name: string
  x: number | null
  y: number | null
}

/** A board file. `items` is untrusted until sanitised. */
export interface BoardExport {
  format: 'meshboard'
  version: number
  exportedAt?: string
  title?: string
  users?: Record<string, string>
  items: unknown[]
}

export const isArrow = (it: Item): it is ArrowItem => it.type === 'arrow'
export const isBox = (it: Item): it is BoxItem => it.type !== 'arrow'
