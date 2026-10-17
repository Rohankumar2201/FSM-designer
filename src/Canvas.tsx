import { RefObject, useRef, useState } from 'react'
import { FSM, Sel, Tool, Trans } from './types'
import { isDefault, outVal, uid } from './core'

const R = 28
export interface View { x: number; y: number; k: number }
interface Props {
  f: FSM
  setF: (fn: (f: FSM) => FSM) => void
  sel: Sel
  setSel: (s: Sel) => void
  tool: Tool
  hl: string | null
  svgRef: RefObject<SVGSVGElement>
  view: View
  setView: (v: View) => void
  delS: (id: string) => void
  delT: (id: string) => void
}
const MONO = 'ui-monospace, Menlo, Consolas, monospace'

export default function Canvas({ f, setF, sel, setSel, tool, hl, svgRef, view, setView, delS, delT }: Props) {
  const drag = useRef<{ id?: string; x: number; y: number } | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const mealy = f.cfg.type === 'mealy'

  const world = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
  }
  const at = (id: string) => f.states.find(s => s.id === id)!

  const addState = (e: React.MouseEvent) => {
    const { x, y } = world(e)
    const id = uid()
    setF(f => {
      let i = f.states.length
      while (f.states.some(s => s.name === 'S' + i)) i++
      return { ...f, states: [...f.states, { id, name: 'S' + i, out: '0', x, y }], initial: f.initial || id }
    })
    setSel({ kind: 'state', id })
  }

  const geo = (t: Trans) => {
    const a = at(t.from), b = at(t.to)
    const i = f.trans.filter(u => u.from === t.from && u.to === t.to).indexOf(t)
    if (a === b) {
      const h = 70 + i * 28
      return { d: `M${a.x - 14} ${a.y - 24} C${a.x - 45} ${a.y - h - 20} ${a.x + 45} ${a.y - h - 20} ${a.x + 14} ${a.y - 24}`, x: a.x, y: a.y - 0.75 * h - 30 }
    }
    const rev = f.trans.some(u => u.from === t.to && u.to === t.from)
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
    const off = (rev ? 34 : 0) + i * 36
    const c = { x: (a.x + b.x) / 2 + (dy / len) * off * 2, y: (a.y + b.y) / 2 - (dx / len) * off * 2 }
    const toward = (p: { x: number; y: number }, r: number) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y) || 1
      return { x: p.x + ((c.x - p.x) / d) * r, y: p.y + ((c.y - p.y) / d) * r }
    }
    const p1 = toward(a, R), p2 = toward(b, R + 3)
    return {
      d: `M${p1.x} ${p1.y} Q${c.x} ${c.y} ${p2.x} ${p2.y}`,
      x: 0.25 * p1.x + 0.5 * c.x + 0.25 * p2.x + (dy / len) * 10,
      y: 0.25 * p1.y + 0.5 * c.y + 0.25 * p2.y - (dx / len) * 10,
    }
  }

  const onMove = (e: React.MouseEvent) => {
    if (src) setMouse(world(e))
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY
    if (d.id) setF(f => ({ ...f, states: f.states.map(s => (s.id === d.id ? { ...s, x: s.x + dx / view.k, y: s.y + dy / view.k } : s)) }))
    else setView({ ...view, x: view.x + dx, y: view.y + dy })
  }

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)))
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k })
  }

  const stateDown = (e: React.MouseEvent, id: string) => {
    if (tool === 'pan') return
    e.stopPropagation()
    if (tool === 'delete') return delS(id)
    if (tool === 'trans') {
      if (!src) return setSrc(id)
      const tid = uid()
      setF(f => ({ ...f, trans: [...f.trans, { id: tid, from: src, to: id, cond: '', out: '' }] }))
      setSel({ kind: 'trans', id: tid })
      return setSrc(null)
    }
    setSel({ kind: 'state', id })
    drag.current = { id, x: e.clientX, y: e.clientY }
  }

  const cursor = tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
  const mark = (id: string, color: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10z" fill={color} />
    </marker>
  )

  return (
    <svg ref={svgRef} className={`w-full h-full ${cursor}`} style={{ background: '#fafafa' }}
      onMouseDown={e => {
        if (tool === 'state') addState(e)
        else { setSel(null); setSrc(null); drag.current = { x: e.clientX, y: e.clientY } }
      }}
      onDoubleClick={e => tool !== 'state' && addState(e)}
      onMouseMove={onMove} onMouseUp={() => (drag.current = null)} onMouseLeave={() => (drag.current = null)} onWheel={onWheel}>
      <defs>{mark('ar', '#475569')}{mark('as', '#2563eb')}</defs>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {f.trans.map(t => {
          const g = geo(t)
          const on = sel?.kind === 'trans' && sel.id === t.id
          const label = (isDefault(t.cond) ? 'else' : t.cond) + (mealy && t.out.trim() ? ` / ${outVal(t.out)}` : '')
          const down = (e: React.MouseEvent) => { e.stopPropagation(); tool === 'delete' ? delT(t.id) : setSel({ kind: 'trans', id: t.id }) }
          return (
            <g key={t.id} onMouseDown={down} onDoubleClick={e => e.stopPropagation()} className="cursor-pointer">
              <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} />
              <path d={g.d} fill="none" stroke={on ? '#2563eb' : '#475569'} strokeWidth={on ? 2.5 : 1.5} markerEnd={`url(#${on ? 'as' : 'ar'})`} />
              <text x={g.x} y={g.y} textAnchor="middle" fontSize={12} fontFamily={MONO} fill={on ? '#2563eb' : '#1e293b'}
                stroke="#fafafa" strokeWidth={3} paintOrder="stroke">{label}</text>
            </g>
          )
        })}
        {src && <line x1={at(src).x} y1={at(src).y} x2={mouse.x} y2={mouse.y} stroke="#2563eb" strokeDasharray="4 3" />}
        {f.states.map(s => {
          const on = sel?.kind === 'state' && sel.id === s.id
          const init = f.initial === s.id
          return (
            <g key={s.id} onMouseDown={e => stateDown(e, s.id)} onDoubleClick={e => e.stopPropagation()} className="cursor-pointer">
              {init && <line x1={s.x - R - 36} y1={s.y} x2={s.x - R - 2} y2={s.y} stroke="#475569" strokeWidth={1.5} markerEnd="url(#ar)" />}
              <circle cx={s.x} cy={s.y} r={R} fill={hl === s.id ? '#fde68a' : '#fff'} stroke={on || src === s.id ? '#2563eb' : '#334155'} strokeWidth={on ? 3 : 1.5} />
              {init && <circle cx={s.x} cy={s.y} r={R - 4} fill="none" stroke="#334155" />}
              <text x={s.x} y={s.y + (mealy ? 4 : -1)} textAnchor="middle" fontSize={12} fontFamily={MONO} fontWeight={600} fill="#0f172a">{s.name}</text>
              {!mealy && <text x={s.x} y={s.y + 13} textAnchor="middle" fontSize={10} fontFamily={MONO} fill="#64748b">{outVal(s.out)}</text>}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
