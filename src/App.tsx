import { ReactNode, useEffect, useRef, useState } from 'react'
import Canvas, { View } from './Canvas'
import { Config, FSM, Sel, State, Tool, Trans } from './types'
import { inputsOf, outWidth, parseFSM, removeState, simulate, stateName, stateTable, validate } from './core'
import { generate } from './generator'
import { blank, templates } from './templates'

const KEY = 'fsm-designer'
const clone = (f: FSM): FSM => structuredClone(f)
const inp = 'w-full border border-slate-300 px-1.5 py-1 text-xs font-mono bg-white'
const btn = 'border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40'
const th = 'text-left font-medium px-2 py-1 border-b border-slate-300 bg-slate-100 sticky top-0'
const td = 'px-2 py-0.5 border-b border-slate-100'

function download(name: string, data: string | Blob, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }))
  a.download = name
  a.click()
}
const Field = ({ l, children }: { l: string; children: ReactNode }) => (
  <label className="block mb-2"><span className="block text-[11px] text-slate-500 mb-0.5">{l}</span>{children}</label>
)

export default function App() {
  const [f, setF] = useState<FSM>(() => clone(templates[0].fsm))
  const [sel, setSel] = useState<Sel>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [tab, setTab] = useState<'table' | 'sim' | 'rtl' | 'warn'>('table')
  const [seq, setSeq] = useState('10110110')
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(600)
  const svgRef = useRef<SVGSVGElement>(null)

  const ins = inputsOf(f)
  const warns = validate(f)
  const table = stateTable(f)
  const sim = simulate(f, seq)
  const rows = sim.rows
  const ok = f.states.some(s => s.id === f.initial) && !warns.some(w => w.startsWith('✖'))
  const code = ok ? generate(f) : '// Fix the errors listed under Warnings to generate RTL.'
  const p = Math.min(pos, rows.length)
  const hl = tab === 'sim' && f.states.length ? (p === 0 ? f.initial : rows[p - 1].next) : null
  const nm = (id: string) => stateName(f, id)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setPos(x => (x >= rows.length ? (setPlaying(false), x) : x + 1)), speed)
    return () => clearInterval(id)
  }, [playing, speed, rows.length])

  const setS = (id: string, v: Partial<State>) => setF(f => ({ ...f, states: f.states.map(s => (s.id === id ? { ...s, ...v } : s)) }))
  const setT = (id: string, v: Partial<Trans>) => setF(f => ({ ...f, trans: f.trans.map(t => (t.id === id ? { ...t, ...v } : t)) }))
  const setC = (v: Partial<Config>) => setF(f => ({ ...f, cfg: { ...f.cfg, ...v } }))
  const delS = (id: string) => { setF(f => removeState(f, id)); setSel(null) }
  const delT = (id: string) => { setF(f => ({ ...f, trans: f.trans.filter(t => t.id !== id) })); setSel(null) }
  const load = (next: FSM) => { setF(next); setSel(null); setPos(0); setPlaying(false); setView({ x: 0, y: 0, k: 1 }) }

  const svgText = () => {
    const el = svgRef.current!, r = el.getBoundingClientRect()
    const s = el.cloneNode(true) as SVGSVGElement
    s.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    s.setAttribute('width', String(r.width)); s.setAttribute('height', String(r.height))
    s.insertAdjacentHTML('afterbegin', '<rect width="100%" height="100%" fill="#fafafa"/>')
    return new XMLSerializer().serializeToString(s)
  }
  const exportPng = () => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width * 2; c.height = img.height * 2
      const g = c.getContext('2d')!
      g.scale(2, 2); g.drawImage(img, 0, 0)
      c.toBlob(b => b && download('fsm.png', b))
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText())
  }
  const exportCsv = () => download('state_table.csv',
    [['present_state', ins.join('/') || 'input', 'next_state', 'output'], ...table.map(r => [r.from, r.input, r.next, r.out])].map(r => r.join(',')).join('\n'), 'text/csv')

  const s = sel?.kind === 'state' ? f.states.find(x => x.id === sel.id) : undefined
  const t = sel?.kind === 'trans' ? f.trans.find(x => x.id === sel.id) : undefined
  const tools: [Tool, string][] = [['select', 'Select'], ['state', 'Add State'], ['trans', 'Add Transition'], ['delete', 'Delete'], ['pan', 'Pan']]
  const tabs: ['table' | 'sim' | 'rtl' | 'warn', string][] = [['table', 'State Table'], ['sim', 'Simulation'], ['rtl', 'RTL'], ['warn', `Warnings (${warns.length})`]]

  return (
    <div className="h-full flex flex-col text-sm">
      <header className="flex items-center gap-2 px-3 h-10 border-b border-slate-300 bg-slate-50">
        <b className="mr-3">FSM Designer</b>
        <select className={btn} value="" onChange={e => e.target.value && load(clone(templates[+e.target.value].fsm))}>
          <option value="">Load example…</option>
          {templates.map((x, i) => <option key={x.name} value={i}>{x.name}</option>)}
        </select>
        <button className={btn} onClick={() => load(blank())}>New</button>
        <button className={btn} onClick={() => localStorage.setItem(KEY, JSON.stringify(f))}>Save</button>
        <button className={btn} onClick={() => {
          const v = localStorage.getItem(KEY)
          if (!v) return alert('Nothing saved yet')
          try { load(parseFSM(JSON.parse(v))) } catch (e) { alert(`Saved FSM could not be loaded: ${(e as Error).message}`) }
        }}>Load</button>
        <button className={btn} onClick={() => load(clone(templates[0].fsm))}>Reset</button>
        <span className="flex-1" />
        <span className="text-xs text-slate-500">Diagram</span>
        <button className={btn} onClick={() => download('fsm.svg', svgText(), 'image/svg+xml')}>SVG</button>
        <button className={btn} onClick={exportPng}>PNG</button>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-32 border-r border-slate-300 bg-slate-50 p-2 flex flex-col gap-1">
          {tools.map(([k, label]) => (
            <button key={k} onClick={() => setTool(k)} className={`${btn} text-left ${tool === k ? '!bg-blue-600 !text-white !border-blue-600' : ''}`}>{label}</button>
          ))}
          <button className={btn} onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset View</button>
          <p className="text-[11px] text-slate-500 mt-2">Double-click the canvas to add a state. Scroll to zoom, drag the background to pan.</p>
        </nav>

        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 min-h-0">
            <Canvas {...{ f, setF, sel, setSel, tool, hl, svgRef, view, setView, delS, delT }} />
          </main>
          <section className="h-72 border-t border-slate-300 flex flex-col">
            <div className="flex border-b border-slate-300 bg-slate-50">
              {tabs.map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-xs ${tab === k ? 'bg-white border-b-2 border-blue-600 font-medium' : 'text-slate-600'}`}>{label}</button>
              ))}
            </div>
            <div className="flex-1 overflow-auto text-xs font-mono">
              {tab === 'table' && (
                <div>
                  <div className="p-1.5 bg-white sticky top-0 z-10"><button className={btn} onClick={exportCsv}>Export CSV</button></div>
                  <table className="w-full"><thead><tr>
                    {['Present State', ins.join('/') || 'Input', 'Next State', f.cfg.outName].map(h => <th key={h} className={th}>{h}</th>)}
                  </tr></thead><tbody>
                    {table.map((r, i) => <tr key={i}><td className={td}>{r.from}</td><td className={td}>{r.input}</td><td className={td}>{r.next}</td><td className={td}>{r.out}</td></tr>)}
                  </tbody></table>
                </div>
              )}
              {tab === 'sim' && (
                <div>
                  <div className="p-1.5 flex items-center gap-2 bg-white sticky top-0 z-10 font-sans">
                    <input className={`${inp} !w-44`} value={seq} onChange={e => { setSeq(e.target.value); setPos(0); setPlaying(false) }}
                      placeholder={ins.length > 1 ? 'e.g. 01 10 11 (one token per cycle)' : 'e.g. 10110110'} />
                    <button className={btn} onClick={() => { if (p >= rows.length) setPos(0); setPlaying(!playing) }}>{playing ? 'Pause' : 'Play'}</button>
                    <button className={btn} onClick={() => setPos(Math.min(p + 1, rows.length))}>Step</button>
                    <button className={btn} onClick={() => { setPos(0); setPlaying(false) }}>Reset</button>
                    <label className="text-xs text-slate-500 flex items-center gap-1">Slow
                      <input type="range" min={100} max={1500} step={100} value={1600 - speed} onChange={e => setSpeed(1600 - +e.target.value)} />Fast</label>
                    {ins.length > 1 && <span className="text-xs text-slate-500">inputs: {ins.join(', ')}</span>}
                  </div>
                  {sim.error && <div className="px-3 py-1 text-red-700 font-sans">{sim.error}</div>}
                  <table className="w-full"><thead><tr>
                    {['Cycle', 'Input', 'Current State', 'Next State', 'Output'].map(h => <th key={h} className={th}>{h}</th>)}
                  </tr></thead><tbody>
                    {rows.slice(0, p).map((r, i) => (
                      <tr key={i} className={i === p - 1 ? 'bg-amber-50' : ''}>
                        <td className={td}>{r.cycle}</td><td className={td}>{r.input}</td><td className={td}>{nm(r.cur)}</td><td className={td}>{nm(r.next)}</td><td className={td}>{r.out}</td>
                      </tr>))}
                  </tbody></table>
                </div>
              )}
              {tab === 'rtl' && (
                <div>
                  <div className="p-1.5 flex gap-2 bg-white sticky top-0 z-10 font-sans">
                    <button className={btn} disabled={!ok} onClick={() => navigator.clipboard.writeText(code)}>Copy</button>
                    <button className={btn} disabled={!ok} onClick={() => download('fsm.v', code)}>Download .v</button>
                    <button className={btn} disabled={!ok} onClick={() => download('fsm.sv', code)}>Download .sv</button>
                    <span className="text-slate-500 self-center">Showing {f.cfg.hdl === 'sv' ? 'SystemVerilog' : 'Verilog'}</span>
                  </div>
                  <pre className="px-3 pb-3">{code}</pre>
                </div>
              )}
              {tab === 'warn' && (
                <ul className="p-2 space-y-1">
                  {warns.length ? warns.map((w, i) => <li key={i} className={w.startsWith('✖') ? 'text-red-700' : 'text-amber-700'}>{w}</li>) : <li className="text-green-700">No problems found.</li>}
                </ul>
              )}
            </div>
          </section>
        </div>

        <aside className="w-64 border-l border-slate-300 bg-slate-50 p-3 overflow-auto">
          <h3 className="font-semibold mb-2">{s ? 'State' : t ? 'Transition' : 'FSM'}</h3>
          {s && (<>
            <Field l="Name"><input key={s.id + s.name} className={inp} defaultValue={s.name}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={e => {
                const v = e.target.value.trim()
                if (v && f.states.some(o => o.id !== s.id && o.name === v)) { alert(`A state named ${v} already exists`); e.target.value = s.name }
                else if (v) setS(s.id, { name: v })
              }} /></Field>
            {f.cfg.type === 'moore' && <Field l={`Output (${f.cfg.outName}, binary)`}><input className={inp} value={s.out} onChange={e => setS(s.id, { out: e.target.value })} /></Field>}
            <label className="flex items-center gap-2 mb-3 text-xs"><input type="checkbox" checked={f.initial === s.id} onChange={() => setF(f => ({ ...f, initial: s.id }))} />Initial state</label>
            <button className={btn} onClick={() => delS(s.id)}>Delete state</button>
          </>)}
          {t && (<>
            {(['from', 'to'] as const).map(k => (
              <Field key={k} l={k === 'from' ? 'Source state' : 'Destination state'}>
                <select className={inp} value={t[k]} onChange={e => setT(t.id, { [k]: e.target.value })}>
                  {f.states.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>))}
            <Field l="Input condition (blank = else)"><input className={inp} value={t.cond} placeholder="start == 1" onChange={e => setT(t.id, { cond: e.target.value })} /></Field>
            {f.cfg.type === 'mealy' && <Field l={`Output (${f.cfg.outName} = …)`}><input className={inp} value={t.out} placeholder={`${f.cfg.outName} = 1`} onChange={e => setT(t.id, { out: e.target.value })} /></Field>}
            <button className={btn} onClick={() => delT(t.id)}>Delete transition</button>
          </>)}
          {!s && !t && (
            <dl className="text-xs grid grid-cols-2 gap-y-1 mb-2">
              <dt className="text-slate-500">Type</dt><dd>{f.cfg.type === 'moore' ? 'Moore' : 'Mealy'}</dd>
              <dt className="text-slate-500">States</dt><dd>{f.states.length}</dd>
              <dt className="text-slate-500">Transitions</dt><dd>{f.trans.length}</dd>
              <dt className="text-slate-500">Inputs</dt><dd className="font-mono">{ins.join(', ') || '–'}</dd>
              <dt className="text-slate-500">Outputs</dt><dd className="font-mono">{f.cfg.outName}[{outWidth(f) - 1}:0]</dd>
            </dl>
          )}

          <h3 className="font-semibold mt-5 mb-2 pt-3 border-t border-slate-300">Configuration</h3>
          <Field l="FSM type"><select className={inp} value={f.cfg.type} onChange={e => setC({ type: e.target.value as Config['type'] })}><option value="moore">Moore</option><option value="mealy">Mealy</option></select></Field>
          <Field l="HDL"><select className={inp} value={f.cfg.hdl} onChange={e => setC({ hdl: e.target.value as Config['hdl'] })}><option value="verilog">Verilog</option><option value="sv">SystemVerilog</option></select></Field>
          <Field l="Clock name"><input className={inp} value={f.cfg.clk} onChange={e => setC({ clk: e.target.value })} /></Field>
          <Field l="Reset name"><input className={inp} value={f.cfg.rst} onChange={e => setC({ rst: e.target.value })} /></Field>
          <Field l="Reset polarity"><select className={inp} value={String(f.cfg.activeLow)} onChange={e => setC({ activeLow: e.target.value === 'true' })}><option value="false">Active high</option><option value="true">Active low</option></select></Field>
          <Field l="Reset type"><select className={inp} value={String(f.cfg.async)} onChange={e => setC({ async: e.target.value === 'true' })}><option value="true">Asynchronous</option><option value="false">Synchronous</option></select></Field>
          <Field l="Output signal name"><input className={inp} value={f.cfg.outName} onChange={e => setC({ outName: e.target.value })} /></Field>
        </aside>
      </div>
    </div>
  )
}
