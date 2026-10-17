import { Config, FSM } from './types'

const cfg = (o: Partial<Config> = {}): Config =>
  ({ type: 'moore', hdl: 'sv', clk: 'clk', rst: 'rst_n', activeLow: true, async: true, outName: 'y', ...o })

export const blank = (): FSM => ({ cfg: cfg(), states: [], trans: [], initial: '' })

type St = [name: string, out: string, x: number, y: number]
type Tr = [from: string, to: string, cond: string, out?: string]
const mk = (c: Partial<Config>, st: St[], tr: Tr[]): FSM => ({
  cfg: cfg(c),
  states: st.map(([name, out, x, y]) => ({ id: name, name, out, x, y })),
  trans: tr.map(([from, to, cond, out = ''], i) => ({ id: `t${i}`, from, to, cond, out })),
  initial: st[0][0],
})

export const templates: { name: string; fsm: FSM }[] = [
  {
    name: '1011 Sequence Detector',
    fsm: mk({ type: 'mealy', outName: 'z' },
      [['S0', '0', 120, 220], ['S1', '0', 320, 220], ['S2', '0', 520, 220], ['S3', '0', 720, 220]],
      [['S0', 'S1', 'x == 1', '0'], ['S0', 'S0', 'x == 0', '0'], ['S1', 'S2', 'x == 0', '0'], ['S1', 'S1', 'x == 1', '0'],
       ['S2', 'S3', 'x == 1', '0'], ['S2', 'S0', 'x == 0', '0'], ['S3', 'S1', 'x == 1', '1'], ['S3', 'S2', 'x == 0', '0']]),
  },
  {
    name: 'Traffic Light Controller',
    fsm: mk({ outName: 'light' },
      [['RED', '100', 140, 160], ['GREEN', '001', 460, 160], ['YELLOW', '010', 300, 340]],
      [['RED', 'GREEN', 'timer == 1'], ['RED', 'RED', 'else'], ['GREEN', 'YELLOW', 'timer == 1'], ['GREEN', 'GREEN', 'else'],
       ['YELLOW', 'RED', 'timer == 1'], ['YELLOW', 'YELLOW', 'else']]),
  },
  {
    name: 'Vending Machine (15c)',
    fsm: mk({ type: 'mealy', outName: 'dispense' },
      [['C0', '0', 120, 240], ['C5', '0', 360, 100], ['C10', '0', 600, 240]],
      [['C0', 'C5', 'nickel == 1 && dime == 0'], ['C0', 'C10', 'dime == 1 && nickel == 0'], ['C0', 'C0', 'else'],
       ['C5', 'C10', 'nickel == 1 && dime == 0'], ['C5', 'C0', 'dime == 1 && nickel == 0', '1'], ['C5', 'C5', 'else'],
       ['C10', 'C0', 'nickel == 1 || dime == 1', '1'], ['C10', 'C10', 'else']]),
  },
  {
    name: 'UART Receiver Controller',
    fsm: mk({ outName: 'status' },
      [['IDLE', '00', 100, 200], ['START', '10', 280, 200], ['DATA', '10', 460, 200], ['STOP', '10', 640, 200], ['DONE', '01', 460, 370]],
      [['IDLE', 'START', 'rx == 0'], ['IDLE', 'IDLE', 'else'], ['START', 'DATA', 'tick == 1'], ['START', 'START', 'else'],
       ['DATA', 'STOP', 'tick == 1 && last == 1'], ['DATA', 'DATA', 'else'], ['STOP', 'DONE', 'tick == 1'], ['STOP', 'STOP', 'else'],
       ['DONE', 'IDLE', 'else']]),
  },
  {
    name: 'Elevator Controller',
    fsm: mk({ outName: 'floor' },
      [['F1', '01', 120, 280], ['F2', '10', 340, 160], ['F3', '11', 560, 280]],
      [['F1', 'F2', 'up == 1'], ['F1', 'F1', 'else'], ['F2', 'F3', 'up == 1 && down == 0'], ['F2', 'F1', 'down == 1 && up == 0'],
       ['F2', 'F2', 'else'], ['F3', 'F2', 'down == 1'], ['F3', 'F3', 'else']]),
  },
]
