import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FSM } from './types'
import { combos, inputsOf, outWidth, parseFSM, removeState, simulate, stateName, stateTable, step, validate } from './core'
import { generate } from './generator'
import { blank, templates } from './templates'

const tpl = (name: string): FSM => structuredClone(templates.find(t => t.name.startsWith(name))!.fsm)
const names = (f: FSM, seq: string) => simulate(f, seq).rows.map(r => stateName(f, r.next))
const outs = (f: FSM, seq: string) => simulate(f, seq).rows.map(r => r.out)
const errors = (f: FSM) => validate(f).filter(w => w.startsWith('✖'))
const small = (extra: Partial<FSM['cfg']> = {}): FSM => ({
  cfg: { ...blank().cfg, ...extra },
  states: [{ id: 'a', name: 'A', out: '0', x: 0, y: 0 }, { id: 'b', name: 'B', out: '1', x: 100, y: 0 }],
  trans: [{ id: 't0', from: 'a', to: 'b', cond: 'x == 1', out: '1' }, { id: 't1', from: 'b', to: 'a', cond: 'x == 0', out: '1' }],
  initial: 'a',
})

describe('simulation', () => {
  it('Moore: output depends on the current state', () => {
    const f = tpl('Traffic')
    expect(names(f, '1101')).toEqual(['GREEN', 'YELLOW', 'YELLOW', 'RED'])
    expect(outs(f, '1101')).toEqual(['100', '001', '010', '010'])
  })
  it('Mealy 1011 detector (overlapping)', () => {
    const f = tpl('1011')
    expect(outs(f, '10110110')).toEqual(['0', '0', '0', '1', '0', '0', '1', '0'])
    expect(names(f, '10110110')).toEqual(['S1', 'S2', 'S3', 'S1', 'S2', 'S3', 'S1', 'S2'])
    expect(outs(f, '1011011011').filter(o => o === '1')).toHaveLength(3)
    expect(outs(f, '0000')).toEqual(['0', '0', '0', '0'])
  })
  it('starts in the initial state and follows a changed initial state', () => {
    const f = tpl('1011')
    f.initial = 'S3'
    expect(simulate(f, '1').rows[0].cur).toBe('S3')
    expect(outs(f, '1')).toEqual(['1'])
  })
  it('rejects simulation without a valid initial state', () => {
    const f = tpl('1011'); f.initial = ''
    expect(simulate(f, '101').error).toMatch(/initial/)
  })
  it('unmatched input holds the state; Mealy output is zero', () => {
    const f = small({ type: 'mealy' })
    f.trans = [f.trans[0]]
    expect(names(f, '01')).toEqual(['A', 'B'])
    expect(outs(f, '01')).toEqual(['0', '1'])
    expect(validate(f).join()).toContain('State B has no outgoing transitions')
  })
  it('first listed transition wins and ambiguity is reported', () => {
    const f = small()
    f.trans.push({ id: 't2', from: 'a', to: 'a', cond: 'x == 1', out: '' })
    expect(names(f, '1')).toEqual(['B'])
    expect(validate(f).join()).toContain('conflicting transitions')
  })
  it('rejects malformed input sequences instead of coercing them', () => {
    const f = tpl('1011')
    for (const bad of ['10a1', '102', 'x']) expect(simulate(f, bad).error).toMatch(/Cycle/)
    expect(simulate(f, '1 0 1').rows).toHaveLength(3)
    expect(simulate(f, '').rows).toHaveLength(0)
    const v = tpl('Vending')
    expect(simulate(v, '01 10 1').error).toMatch(/Cycle 2/)
    expect(simulate(v, '01 10 11').rows).toHaveLength(3)
  })
})

describe('state table', () => {
  it('1011 detector table is correct', () => {
    const t = stateTable(tpl('1011'))
    expect(t).toHaveLength(8)
    expect(t.find(r => r.from === 'S3' && r.input === '1')).toMatchObject({ next: 'S1', out: '1' })
    expect(t.find(r => r.from === 'S3' && r.input === '0')).toMatchObject({ next: 'S2', out: '0' })
    expect(t.find(r => r.from === 'S0' && r.input === '1')).toMatchObject({ next: 'S1', out: '0' })
  })
  it('matches the simulator for every state and input of every template', () => {
    for (const { fsm } of templates) {
      const n = inputsOf(fsm).length
      for (const s of fsm.states) for (const v of combos(n)) {
        const row = stateTable(fsm).find(r => r.from === s.name && r.input === v.join(''))!
        const g = structuredClone(fsm); g.initial = s.id
        const sr = simulate(g, v.join('')).rows[0]
        expect([row.next, row.out]).toEqual([stateName(fsm, sr.next), sr.out])
      }
    }
  })
})

describe('validation', () => {
  it('regression: reachable states are not reported unreachable', () => {
    for (const { fsm } of templates) expect(validate(fsm)).toEqual([])
  })
  it('flags truly unreachable states and missing initial state', () => {
    const f = small(); f.states.push({ id: 'c', name: 'C', out: '0', x: 0, y: 0 })
    expect(validate(f).join()).toContain('State C is unreachable')
    f.initial = ''
    expect(errors(f)).toContain('✖ No initial state selected')
  })
  it('rejects invalid and reserved identifiers', () => {
    for (const bad of ['module', 'always_ff', '1abc', 'a b', 'next_state', 'fsm', 'clk', 'x']) {
      const f = small(); f.states[1].name = bad
      expect(errors(f).length, bad).toBeGreaterThan(0)
    }
    expect(errors(small({ clk: 'wire' })).length).toBeGreaterThan(0)
    expect(errors(small({ outName: 'x' })).join()).toContain('more than once')
    expect(errors(small({ rst: 'clk' })).join()).toContain('more than once')
  })
  it('rejects duplicate states, invalid conditions and invalid outputs', () => {
    const f = small(); f.states[1].name = 'A'
    expect(errors(f).join()).toContain('Duplicate state name A')
    const g = small(); g.trans[0].cond = 'x = 1'
    expect(errors(g).join()).toContain('Invalid condition')
    const h = small(); h.trans[0].cond = 'x == 1 ||'
    expect(errors(h).join()).toContain('Invalid condition')
    const m = small({ type: 'mealy' }); m.trans[0].out = 'y = 2'
    expect(errors(m).join()).toContain('Invalid output')
    const o = small(); o.states[0].out = 'abc'
    expect(errors(o).join()).toContain('invalid output')
  })
  it('refuses to generate RTL for an invalid FSM', () => {
    const f = small(); f.states[1].name = 'module'
    expect(() => generate(f)).toThrow()
    expect(() => generate(blank())).toThrow()
    const g = small(); g.initial = ''
    expect(() => generate(g)).toThrow()
  })
})

describe('HDL text', () => {
  it('Verilog uses localparam/reg and no SystemVerilog constructs', () => {
    const f = tpl('Traffic'); f.cfg.hdl = 'verilog'
    const v = generate(f)
    expect(v).toContain("localparam [1:0]")
    expect(v).toContain("YELLOW = 2'd2")
    expect(v).toContain('reg [1:0] current_state, next_state;')
    expect(v).toContain("RED: light = 3'b100;")
    expect(v).not.toMatch(/typedef|always_comb|always_ff|\blogic\b/)
  })
  it('SystemVerilog uses typedef enum, always_ff and always_comb', () => {
    const f = tpl('Traffic'); f.cfg.hdl = 'sv'
    const v = generate(f)
    expect(v).toMatch(/typedef enum logic \[1:0\] \{\s*RED,\s*GREEN,\s*YELLOW\s*\} state_t;/)
    expect(v).toContain('always_ff @(posedge clk or negedge rst_n)')
    expect(v).toContain('always_comb')
  })
  it('reset polarity and type follow the configuration', () => {
    const f = tpl('Traffic')
    Object.assign(f.cfg, { activeLow: false, async: false, rst: 'reset' })
    let v = generate(f)
    expect(v).toContain('always_ff @(posedge clk) begin')
    expect(v).toContain('if (reset)')
    Object.assign(f.cfg, { activeLow: false, async: true, hdl: 'verilog' })
    v = generate(f)
    expect(v).toContain('always @(posedge clk or posedge reset)')
    Object.assign(f.cfg, { activeLow: true, async: false })
    expect(generate(f)).toContain('if (!reset)')
  })
  it('Mealy outputs are assigned on transitions, Moore outputs per state', () => {
    const m = generate(tpl('1011'))
    expect(m).toMatch(/S3: begin\s+if \(x == 1\) begin\s+next_state = S1;\s+z = 1'b1;/)
    expect(m).not.toContain('S3: z =')
    expect(generate(tpl('UART'))).toContain("DONE: status = 2'b01;")
  })
  it('single-state machine uses a 1-bit state register', () => {
    const f = small(); f.states.pop(); f.trans = []
    expect(generate(f)).toContain('[0:0]')
  })
})

describe('saved data', () => {
  it('round-trips a valid FSM', () => {
    const f = tpl('Vending')
    expect(parseFSM(JSON.parse(JSON.stringify(f)))).toEqual(f)
  })
  it('rejects malformed or outdated data', () => {
    const f = tpl('1011')
    const cases: unknown[] = [null, 42, {}, { ...f, cfg: { ...f.cfg, type: 'moorr' } }, { ...f, states: 'x' },
      { ...f, trans: [{ ...f.trans[0], to: 'nope' }] }, { ...f, initial: 'zzz' }, { ...f, states: [{ ...f.states[0], x: 'a' }] },
      { ...f, states: [f.states[0], f.states[0]] }]
    for (const c of cases) expect(() => parseFSM(c)).toThrow()
  })
  it('regression: deleting a state removes its transitions and initial marker', () => {
    const f = removeState(tpl('1011'), 'S1')
    expect(f.trans.every(t => t.from !== 'S1' && t.to !== 'S1')).toBe(true)
    expect(removeState(tpl('1011'), 'S0').initial).toBe('')
    expect(() => parseFSM(f)).not.toThrow()
  })
})

// --- generated HDL compiled and simulated with Icarus Verilog (skipped if absent) ---
const hasIverilog = spawnSync('iverilog', ['-V']).stdout?.toString().includes('Icarus') ?? false

function testbench(f: FSM, tokens: string[]) {
  const c = f.cfg, ins = inputsOf(f), W = outWidth(f)
  const on = c.activeLow ? 0 : 1
  const set = (tk: string) => ins.map((n, i) => `${n}=${tk[i]};`).join(' ')
  const ports = [`.${c.clk}(${c.clk})`, `.${c.rst}(${c.rst})`, ...ins.map(n => `.${n}(${n})`), `.${c.outName}(${c.outName})`].join(', ')
  return [
    'module tb;', `reg ${c.clk}=0, ${c.rst}=${on};`, ins.length ? `reg ${ins.join(', ')};` : '', `wire [${W - 1}:0] ${c.outName};`,
    `fsm dut(${ports});`, `always #5 ${c.clk}=~${c.clk};`, 'initial begin',
    `  ${set('0'.repeat(ins.length))}`, `  repeat (3) @(negedge ${c.clk});`,
    ...tokens.map((tk, i) => `  @(negedge ${c.clk}); ${i ? '' : `${c.rst}=${1 - on};`} ${set(tk)} #1 $display("%b", ${c.outName});`),
    `  @(negedge ${c.clk}); ${set('0'.repeat(ins.length))} ${c.rst}=${on}; repeat (2) @(negedge ${c.clk}); #1 $display("%b", ${c.outName});`,
    '  $finish;', 'end', 'endmodule'].join('\n')
}

describe.skipIf(!hasIverilog)('generated HDL vs simulator (Icarus Verilog)', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const variants = [{ activeLow: true, async: true }, { activeLow: false, async: false }]
  for (const { name, fsm } of templates) for (const hdl of ['verilog', 'sv'] as const) for (const rv of variants) {
    it(`${name} / ${hdl} / ${rv.activeLow ? 'active-low async' : 'active-high sync'} reset`, () => {
      const f = structuredClone(fsm)
      Object.assign(f.cfg, { hdl }, rv, { rst: rv.activeLow ? 'rst_n' : 'rst' })
      const n = Math.max(1, inputsOf(f).length)
      const tokens = Array.from({ length: 60 }, () => Array.from({ length: n }, () => (rnd() < 0.5 ? 0 : 1)).join(''))
      if (name.startsWith('1011')) tokens.splice(0, 14, ...'10110110111011'.split(''))
      const dir = mkdtempSync(join(tmpdir(), 'fsm-'))
      writeFileSync(join(dir, 'fsm.v'), generate(f)); writeFileSync(join(dir, 'tb.v'), testbench(f, tokens))
      execFileSync('iverilog', [hdl === 'sv' ? '-g2012' : '-g2005', '-Wall', '-o', join(dir, 'sim'), join(dir, 'fsm.v'), join(dir, 'tb.v')])
      const raw = execFileSync('vvp', [join(dir, 'sim')]).toString()
      const got = raw.split(/\r?\n/).map(l => l.trim()).filter(l => /^[01xz]+$/.test(l))
      if (!got.length) throw new Error(`vvp printed no output lines:\n${raw}`)
      const expected = simulate(f, tokens.join(' ')).rows.map(r => r.out)
      expected.push(step(f, f.initial, Array(inputsOf(f).length).fill(0)).out) // output after reset
      expect(got).toEqual(expected)
    })
  }
})
