// Where joining a board stands, for a board that's still empty in this browser: its content lives
// with the teammates who have it, so until one of them connects there's nothing to show.

export type JoinState =
  /** looking for teammates who have the board */
  | 'searching'
  /** nobody who has the board turned up */
  | 'alone'
  /** a teammate is there, but the networks wouldn't connect */
  | 'blocked'
  /** none of the relays that introduce peers could be reached */
  | 'offline'
  /** a teammate is connected */
  | 'connected'

export interface JoinFacts {
  /** peers connected right now */
  peers: number
  /** a peer was found but no connection could be made */
  connectFailed: boolean
  /** every relay failed */
  relaysFailed: boolean
  /** the first seconds have gone by without anyone turning up */
  waited: boolean
}

/** How long to look for teammates before saying nobody is there. */
export const SEARCH_MS = 12_000

export function joinState({ peers, connectFailed, relaysFailed, waited }: JoinFacts): JoinState {
  if (peers > 0) return 'connected'
  if (connectFailed) return 'blocked'
  if (relaysFailed) return 'offline'
  return waited ? 'alone' : 'searching'
}
