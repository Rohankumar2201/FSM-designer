export type Tool = 'select' | 'state' | 'trans' | 'delete' | 'pan'

export interface Config {
  type: 'moore' | 'mealy'
  hdl: 'verilog' | 'sv'
  clk: string
  rst: string
  activeLow: boolean
  async: boolean
  outName: string
}
export interface State { id: string; name: string; out: string; x: number; y: number }
export interface Trans { id: string; from: string; to: string; cond: string; out: string }
export interface FSM { cfg: Config; states: State[]; trans: Trans[]; initial: string }
export type Sel = { kind: 'state' | 'trans'; id: string } | null
