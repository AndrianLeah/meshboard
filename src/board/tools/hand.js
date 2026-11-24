// Hand: drag to pan.
export function createHandTool(ctx) {
  return { id: 'hand', cursor: 'grab', down: (e) => ctx.pan(e) }
}
