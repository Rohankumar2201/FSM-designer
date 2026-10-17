import { FSM, State, Trans } from './types'

export const uid = () => Math.random().toString(36).slice(2, 8)
const RESERVED = new Set(('always and assign automatic begin buf case casex casez default define disable else end endcase endfunction endmodule endtask event for force forever fork function if initial inout input integer join localparam module nand negedge nor not or output parameter posedge real reg release repeat signed supply0 supply1 table task time tri unsigned wait while wire xnor xor ' +
  'always_comb always_ff always_latch bit break byte class const continue do endclass endinterface endpackage enum export extern final foreach generate genvar import interface int logic longint modport package priority return shortint static string struct typedef union unique var virtual void iff inside ref type').split(' '))
export const badIdent = (n: string) => !/^[A-Za-z_]\w*$/.test(n) || RESERVED.has(n)
const INTERNAL = ['fsm', 'current_state', 'next_state', 'state_t']

export const isDefault = (c: string) => !c.trim() || c.trim() === 'else'
export const outVal = (s: string) => (s.includes('=') ? s.split('=')[1] : s).trim()
export const stateName = (f: FSM, id: string) => f.states.find(s => s.id === id)?.name ?? '?'

export const inputsOf = (f: FSM) => {
  const names: string[] = []
  for (const t of f.trans) {
    if (isDefault(t.cond)) continue
    for (const n of t.cond.match(/[A-Za-z_]\w*/g) ?? []) if (!names.includes(n)) names.push(n)
  }
  return names
}

export const outWidth = (f: FSM) =>
  Math.max(1, ...f.states.map(s => outVal(s.out).length), ...f.trans.map(t => outVal(t.out).length))
export const outBits = (f: FSM, v: string) => outVal(v).padStart(outWidth(f), '0')

const compile = (cond: string, names: string[]) => {
  if (!/^[\w\s=!&|()<>]*$/.test(cond) || /(^|[^=!<>])=($|[^=])/.test(cond)) throw new Error('bad condition')
  return new Function(...names, `return !!(${cond})`) as (...v: number[]) => boolean
}
export const condOk = (cond: string, names: string[]) => {
  try { compile(cond, names)(...names.map(() => 0)); return true } catch { return false }
}
const matches = (t: Trans, names: string[], v: number[]) => {
  if (isDefault(t.cond)) return true
  try { return compile(t.cond, names)(...v) } catch { return false }
}

// default (else) transitions are tried last
export const outgoing = (f: FSM, id: string) =>
  f.trans.filter(t => t.from === id).sort((a, b) => +isDefault(a.cond) - +isDefault(b.cond))

export const combos = (n: number) =>
  Array.from({ length: 1 << n }, (_, i) => Array.from({ length: n }, (_, b) => (i >> (n - 1 - b)) & 1))

export function step(f: FSM, id: string, v: number[]) {
  const names = inputsOf(f)
  const t = outgoing(f, id).find(t => matches(t, names, v))
  const s = f.states.find(s => s.id === id)
  const out = outBits(f, f.cfg.type === 'moore' ? s?.out ?? '' : t?.out ?? '')
  return { next: t ? t.to : id, out, hit: !!t }
}

export function stateTable(f: FSM) {
  const n = inputsOf(f).length
  return f.states.flatMap(s =>
    combos(n).map(v => {
      const r = step(f, s.id, v)
      return { from: s.name, input: v.join('') || '-', next: stateName(f, r.next), out: r.out }
    }))
}

export function simulate(f: FSM, seq: string) {
  const none = (error: string) => ({ rows: [] as { cycle: number; input: string; cur: string; next: string; out: string }[], error })
  if (!f.states.some(s => s.id === f.initial)) return none('No valid initial state')
  const n = inputsOf(f).length
  const tokens = n > 1 ? seq.split(/[\s,]+/).filter(Boolean) : seq.replace(/[\s,]/g, '').split('').filter(Boolean)
  for (const [i, tk] of tokens.entries()) {
    if (!/^[01]+$/.test(tk) || tk.length !== Math.max(n, 1)) return none(`Cycle ${i}: "${tk}" must be ${Math.max(n, 1)} binary digit(s)${n > 1 ? ` (${inputsOf(f).join(', ')})` : ''}`)
  }
  let cur = f.initial
  const rows = tokens.map((tk, cycle) => {
    const r = step(f, cur, Array.from({ length: n }, (_, j) => +tk[j]))
    const row = { cycle, input: tk, cur, next: r.next, out: r.out }
    cur = r.next
    return row
  })
  return { rows, error: undefined as string | undefined }
}

export const removeState = (f: FSM, id: string): FSM => ({
  ...f,
  states: f.states.filter(s => s.id !== id),
  trans: f.trans.filter(t => t.from !== id && t.to !== id),
  initial: f.initial === id ? '' : f.initial,
})

export function parseFSM(raw: unknown): FSM {
  const o = raw as any
  const bad = (m: string): never => { throw new Error(m) }
  const c = o?.cfg
  if (!c || !['moore', 'mealy'].includes(c.type) || !['verilog', 'sv'].includes(c.hdl) || typeof c.clk !== 'string' || typeof c.rst !== 'string' ||
      typeof c.outName !== 'string' || typeof c.activeLow !== 'boolean' || typeof c.async !== 'boolean') bad('invalid configuration')
  if (!Array.isArray(o.states) || !Array.isArray(o.trans)) bad('missing states or transitions')
  const ids = new Set<string>(), tids = new Set<string>()
  for (const s of o.states) {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.out !== 'string' || !Number.isFinite(s.x) || !Number.isFinite(s.y) || ids.has(s.id)) bad('invalid state')
    ids.add(s.id)
  }
  for (const t of o.trans) {
    if (!t || typeof t.id !== 'string' || typeof t.cond !== 'string' || typeof t.out !== 'string' || !ids.has(t.from) || !ids.has(t.to) || tids.has(t.id)) bad('invalid transition')
    tids.add(t.id)
  }
  if (typeof o.initial !== 'string' || (o.initial && !ids.has(o.initial))) bad('invalid initial state')
  return {
    cfg: { type: c.type, hdl: c.hdl, clk: c.clk, rst: c.rst, activeLow: c.activeLow, async: c.async, outName: c.outName },
    states: o.states.map(({ id, name, out, x, y }: State) => ({ id, name, out, x, y })),
    trans: o.trans.map(({ id, from, to, cond, out }: Trans) => ({ id, from, to, cond, out })),
    initial: o.initial,
  }
}

export function validate(f: FSM): string[] {
  const w: string[] = []
  if (!f.states.length) return ['✖ The FSM has no states']
  const names = inputsOf(f)
  const nm = (id: string) => stateName(f, id)
  if (!f.states.some(s => s.id === f.initial)) w.push('✖ No initial state selected')

  const { clk, rst, outName } = f.cfg
  const ports = [clk, rst, ...names, outName]
  for (const [label, n] of [['Clock', clk], ['Reset', rst], ['Output signal', outName], ...names.map(n => ['Input', n])]) {
    if (badIdent(n)) w.push(`✖ ${label} name "${n}" is not a valid or is a reserved HDL identifier`)
  }
  for (const n of new Set(ports.filter((n, i) => ports.indexOf(n) !== i))) w.push(`✖ Signal name "${n}" is used more than once (clock, reset, inputs, output)`)
  const seen = new Set<string>()
  for (const s of f.states) {
    if (badIdent(s.name)) w.push(`✖ State name "${s.name}" is not a valid or is a reserved HDL identifier`)
    else if ([...ports, ...INTERNAL].includes(s.name)) w.push(`✖ State name "${s.name}" collides with a port or generated signal`)
    if (seen.has(s.name)) w.push(`✖ Duplicate state name ${s.name}`)
    seen.add(s.name)
    if (f.cfg.type === 'moore' && !/^[01]+$/.test(outVal(s.out))) w.push(`✖ State ${s.name}: invalid output "${s.out}" (use binary, e.g. 010)`)
  }
  let condErrors = false
  for (const t of f.trans) {
    const label = `${nm(t.from)} → ${nm(t.to)}`
    if (!isDefault(t.cond) && !condOk(t.cond, names)) { w.push(`✖ Invalid condition "${t.cond}" on ${label}`); condErrors = true }
    if (f.cfg.type === 'mealy' && t.out.trim() && !/^[01]+$/.test(outVal(t.out))) w.push(`✖ Invalid output "${t.out}" on ${label}`)
  }
  for (const s of f.states) {
    if (outgoing(f, s.id).filter(t => isDefault(t.cond)).length > 1) w.push(`✖ State ${s.name} has more than one default (else) transition`)
  }

  const reach = new Set([f.initial])
  const queue = [f.initial]
  while (queue.length) {
    const cur = queue.shift()
    for (const t of f.trans) if (t.from === cur && !reach.has(t.to)) { reach.add(t.to); queue.push(t.to) }
  }
  for (const s of f.states) {
    if (f.states.some(o => o.id === f.initial) && !reach.has(s.id)) w.push(`⚠ State ${s.name} is unreachable from the initial state`)
    const out = outgoing(f, s.id)
    if (!out.length) w.push(`⚠ State ${s.name} has no outgoing transitions`)
    else if (!condErrors && names.length <= 6) {
      const gaps = combos(names.length).filter(v => !step(f, s.id, v).hit)
      for (const v of gaps.slice(0, 2)) w.push(`⚠ State ${s.name} has no transition for ${names.map((n, i) => `${n}=${v[i]}`).join(', ') || 'any input'} (holds state)`)
      const clash = combos(names.length).find(v => {
        const hit = out.filter(t => !isDefault(t.cond) && matches(t, names, v))
        return hit.length > 1 && hit.some(t => t.to !== hit[0].to || (f.cfg.type === 'mealy' && outBits(f, t.out) !== outBits(f, hit[0].out)))
      })
      if (clash) w.push(`⚠ State ${s.name} has conflicting transitions when ${names.map((n, i) => `${n}=${clash[i]}`).join(', ')}; the first one listed wins`)
      if (gaps.length > 2) w.push(`⚠ State ${s.name}: ${gaps.length - 2} more input combinations without a transition`)
    }
  }
  return w
}
