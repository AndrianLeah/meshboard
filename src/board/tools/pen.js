// Pen: freehand strokes. Stays active until another tool is picked.
import { simplify } from '../../core/geometry.js'

const WIDTH = 3

export function createPenTool(ctx) {
  return {
    id: 'pen',
    cursor: 'crosshair',
    down(_e, start) {
      const points = [start]
      const color = ctx.colorFor('pen')
      const d = () => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
      const draw = () => ctx.overlay({ draft: { kind: 'stroke', d: d(), color, width: WIDTH } })
      draw()
      return {
        move(_e, p) {
          const last = points[points.length - 1]
          if (Math.hypot(p.x - last.x, p.y - last.y) < ctx.px(1.5)) return
          points.push(p)
          draw()
        },
        up() {
          ctx.overlay({ draft: null })
          if (points.length === 1) points.push({ x: start.x + 0.5, y: start.y + 0.5 }) // a dot
          const pts = simplify(points, ctx.px(0.75))
          const xs = pts.map((p) => p.x)
          const ys = pts.map((p) => p.y)
          const x = Math.min(...xs)
          const y = Math.min(...ys)
          const w = Math.max(1, Math.max(...xs) - x)
          const h = Math.max(1, Math.max(...ys) - y)
          const round = (n) => Math.round(n * 10) / 10
          ctx.store.stopCapturing()
          ctx.store.create({
            type: 'path',
            color,
            width: WIDTH,
            x: round(x),
            y: round(y),
            w: round(w),
            h: round(h),
            ow: round(w),
            oh: round(h),
            points: pts.flatMap((p) => [round(p.x - x), round(p.y - y)]),
          })
        },
        cancel: () => ctx.overlay({ draft: null }),
      }
    },
  }
}
