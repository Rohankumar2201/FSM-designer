import { FSM } from './types'
import { validate, inputsOf, isDefault, outBits, outgoing, outWidth, stateName } from './core'

export function generate(f: FSM): string {
  const errors = validate(f).filter(w => w.startsWith('✖'))
  if (errors.length || !f.states.some(s => s.id === f.initial)) throw new Error(errors.join('\n') || 'No initial state')
  const { cfg } = f
  const sv = cfg.hdl === 'sv'
  const mealy = cfg.type === 'mealy'
  const ins = inputsOf(f)
  const W = outWidth(f)
  const nb = Math.max(1, Math.ceil(Math.log2(f.states.length)))
  const out = cfg.outName
  const nm = (id: string) => stateName(f, id)
  const init = nm(f.initial)
  const lit = (v: string) => `${W}'b${v}`
  const zero = lit('0'.repeat(W))
  const wire = sv ? 'logic' : 'wire'

  const ports = [
    `input ${wire} ${cfg.clk}`, `input ${wire} ${cfg.rst}`,
    ...ins.map(i => `input ${wire} ${i}`),
    `output ${sv ? 'logic' : 'reg'} ${W > 1 ? `[${W - 1}:0] ` : ''}${out}`,
  ]
  const L = ['module fsm (', ports.map(p => '    ' + p).join(',\n'), ');', '']

  if (sv) {
    L.push(`    typedef enum logic [${nb - 1}:0] {`, f.states.map(s => `        ${s.name}`).join(',\n'), '    } state_t;', '', '    state_t current_state, next_state;')
  } else {
    L.push(`    localparam [${nb - 1}:0]`, f.states.map((s, i) => `        ${s.name} = ${nb}'d${i}`).join(',\n') + ';', '', `    reg [${nb - 1}:0] current_state, next_state;`)
  }

  const edge = cfg.activeLow ? 'negedge' : 'posedge'
  const active = cfg.activeLow ? `!${cfg.rst}` : cfg.rst
  const sens = cfg.async ? `@(posedge ${cfg.clk} or ${edge} ${cfg.rst})` : `@(posedge ${cfg.clk})`
  L.push('', `    ${sv ? 'always_ff' : 'always'} ${sens} begin`,
    `        if (${active})`, `            current_state <= ${init};`,
    '        else', '            current_state <= next_state;', '    end', '')

  const comb = sv ? 'always_comb' : 'always @(*)'
  L.push(`    ${comb} begin`, '        next_state = current_state;')
  if (mealy) L.push(`        ${out} = ${zero};`)
  L.push('        case (current_state)')
  for (const s of f.states) {
    const ts = outgoing(f, s.id)
    if (!ts.length) continue
    L.push(`            ${s.name}: begin`)
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]
      const dflt = isDefault(t.cond)
      const act = [`next_state = ${nm(t.to)};`]
      if (mealy && t.out.trim()) act.push(`${out} = ${lit(outBits(f, t.out))};`)
      if (dflt && i === 0) { L.push(...act.map(a => '                ' + a)); break }
      L.push(i === 0 ? `                if (${t.cond}) begin` : dflt ? '                end else begin' : `                end else if (${t.cond}) begin`)
      L.push(...act.map(a => '                    ' + a))
      if (dflt || i === ts.length - 1) { L.push('                end'); break }
    }
    L.push('            end')
  }
  L.push(`            default: next_state = ${init};`, '        endcase', '    end')

  if (!mealy) {
    L.push('', `    ${comb} begin`, '        case (current_state)',
      ...f.states.map(s => `            ${s.name}: ${out} = ${lit(outBits(f, s.out))};`),
      `            default: ${out} = ${zero};`, '        endcase', '    end')
  }
  L.push('', 'endmodule', '')
  return L.join('\n')
}
