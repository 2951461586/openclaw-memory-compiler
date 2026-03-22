# Architecture

## Positioning

`memory-compiler` is the **derived continuity layer** in the OpenClaw memory stack.

It sits between:
- raw/authoritative sources (`file:`, LCM, durable memory)
- operator workflows (review, control-plane, reports)
- runtime prompt injection / session handoff

## Layering

### Sources
- workspace files
- LCM summaries / messages
- durable memory exports
- session-derived state

### Imports / adapters
- session-state import
- workspace note import
- durable memory import
- LCM summary import

### Compiler outputs
- facts
- threads
- continuity
- digests
- session packs
- source backlinks
- review queue

### Control plane
- status
- refresh
- verify
- metrics
- operator evidence reports

### Runtime integration
- before_prompt_build context
- source-dispatch instruction
- session_end handoff/finalize

## Trust boundary

The plugin does **not** declare truth by itself.
It computes derived artifacts from evidence-bearing sources.

Default trust stance:
- source-backed file/summary/memory refs outrank derived artifacts
- review queue is where uncertain or promotable derived claims become operator-facing decisions
- runtime prompt context is continuity support, not a substitute for evidence

## Boundary with other systems

### vs memory-lancedb
- memory-lancedb stores/retrieves durable memory
- memory-compiler compiles operator/runtime continuity artifacts from sources

### vs LCM
- LCM stores and recalls conversation/source history
- memory-compiler consumes LCM outputs as part of its evidence graph

### vs bridge plugin
- bridge plugin is now compatibility glue only
- full plugin should become the long-term ownership boundary

## Current extraction state

Plugin-first shell exists.
Deep extraction is partial.
Some copied MJS code still carries workspace-era path assumptions and should be normalized in later packs.
