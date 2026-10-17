# FSM Designer

Browser tool for drawing a finite state machine and generating Verilog/SystemVerilog from it. Includes a state table, a cycle-by-cycle simulator, five example machines, SVG/PNG/CSV export and localStorage save/load. No backend.

## Run

```
npm ci
npm run dev        # development server
npm run build      # type-check + production build into dist/
npm test           # unit tests (+ Icarus Verilog checks if iverilog is installed)
```

## Semantics

- **Moore:** output is a binary value stored on each state and depends only on the current state.
- **Mealy:** output is set on a transition (`y = 1` or just `1`) and depends on the current state and the inputs. A transition without an output drives all zeros.
- **Conditions:** boolean expressions over 1-bit inputs using `== != && || ! ( )`, e.g. `x == 1 && y == 0`. A blank condition or `else` is the default branch. Input names are taken from the conditions.
- **Priority:** transitions of a state are evaluated in the order listed, default (`else`) last; the first match wins. If none match, the FSM stays in its state (Mealy output is zero). Overlapping conditions with different results are reported as warnings.
- **Simulation input:** binary only. One digit per cycle for one input (`10110110`); with several inputs, one token per cycle with one digit per input in the order shown (`01 10 11`). Anything else is rejected.
- **Reset:** active-high or active-low, synchronous or asynchronous; resets to the initial state.

## Generated HDL

One module named `fsm` with `current_state`/`next_state`, a state register, a combinational next-state block and (Moore) an output block.

- Verilog: Verilog-2001 (`localparam`, `reg`, `always @(*)`).
- SystemVerilog: `typedef enum`, `always_ff`, `always_comb`.
- Generation is refused while there are errors (invalid or reserved identifiers, name collisions, invalid conditions/outputs, no initial state). Warnings (unreachable states, missing or conflicting transitions) do not block it.

## Verify generated HDL locally

`npm test` compiles and simulates every example (Verilog and SystemVerilog, both reset styles) with Icarus Verilog and compares the outputs with the built-in simulator. Without `iverilog` on the PATH those tests are skipped. Install it (e.g. `sudo apt install iverilog`) and rerun.

## Limitations

- Inputs are single-bit; the output is one bus of up to the width of the longest output value.
- No state-encoding options (sequential binary only), no one-hot.
- Reserved-word checking covers Verilog-2001 and common SystemVerilog keywords, not the full SystemVerilog list.
- Not synthesised or run through formal tools; only simulated with Icarus Verilog.
