# CLAUDE.md

**THE GOLDEN RULE OF SOFTWARE ARCHITCTURE AND PLANNING: KEEP COGNITIVE LOAD LOW while accomplishing the required functionality!**

> Think carefully and implement a concise solution with hopefully minimal code changes, if the code can replace existing code then it probably should and that's OK!
> If you notice that the code you updated has changed from what you expected it to be, that means the user may have made changes as well, before you jump to conclusions PLEASE look it over and consider it before changing it back to what you expected!
> Always ask the user if you are unsure about something!
> Collect your thoughts: Whenever possible, make all your edits to a given file AT ONCE, this makes your intentions clear to the user.

## Tone and Behavior

- Criticism is welcome. Please tell me when I am wrong or mistaken, or even when you think I might be wrong or mistaken.
- Please tell me if there is a better approach than the one I am taking.
- Please tell me if there is a relevant standard or convention that I appear to be unaware of.
- Be skeptical.
- Be _concise_ **NOT verbose**.
- Short summaries are OK, but don't give an extended breakdown unless we are working through the details of a plan.
- Do not flatter, and do not give compliments unless I am specifically asking for your judgement.
- Occasional pleasantries are fine.
- Feel free to ask many questions. If you are in doubt of my intent, don't guess. Ask.
- AVOID jargon or unclear/mixed metaphors (e.g., don't use "seam" or "geometry" to describe software structure), say what you mean!

## ABSOLUTE RULES:

- THINK — DON'T MINDLESSLY FOLLOW A PLAN/SPEC : A plan is what we *thought* the work was before touching the code; it is an aid to judgment, NOT a substitute for it. While implementing, YOU hold the current information — evaluate each step against the actual code and the actual goal before doing it. If a step is wrong, half-baked, contradicts its own goal (e.g. leaves a duplicate after an extraction), or just doesn't make sense against what's really in the code, STOP and flag it. **Reality and common sense beat the plan every time.**
- NO PARTIAL IMPLEMENTATION
- NO SIMPLIFICATION : no "// This is simplified stuff for now, complete implementation would blablabla"
- NO CODE DUPLICATION : check existing codebase to reuse functions and constants Read files before writing new functions. Use common sense function name to find them easily.
- NO CHEATER TESTS : test must be accurate, reflect real usage and be designed to reveal flaws. No useless tests! No tests that just restate the implementation. Design tests to be verbose so we can use them for debugging. Tests have a maintenance cost, make it worth it.
- NO INCONSISTENT NAMING - read existing codebase naming patterns.
- NO OVER-ENGINEERING - Don't add unnecessary abstractions, factory patterns, or middleware when simple functions would work. Don't think "enterprise" when you need "working"
- NO MIXED CONCERNS - Don't put validation logic inside API handlers, database queries inside UI components, etc. instead of proper separation
- NO RESOURCE LEAKS - Don't forget to close database connections, clear timeouts, remove event listeners, dispose of native containers, or clean up file handles

### Variable Names
- Stick to coding conventions established in the code base
- If a variable represents a value in a particular unit, the unit should be part of the variable name e.g., prefer `segmentInTiles` over `segment`

### Method Names
- Name methods by their epistemic status, not their caller. A method that produces an estimate or prediction (as opposed to ground-truth execution) should say so — `Estimate*`, `Expected*`, `Predict*`. That is what a reader needs to know, and it stays true regardless of who calls it.

### Code Comments
- Please do not ever refer to the user (e.g., using "your" or similar words) in comments, keep comments descriptive NOT prescriptive
- Be considerate of existing TODOs, they are likely there for a reason!
- Be concise and clear!
- AVOID excessive verbosity!
- Keep comments scoped to the thing being documented (e.g., Comment what a function/type IS and returns, not who its callers are or what they do with it).

## General Coding Philosophy

- Do NOT create unnecessary abstractions
- Do NOT create unnecessary helpers / getters / setters
- DO NOT add parameters / functions / variables / Actions / etc. that aren't being used anywhere yet (unless you plan on using them during your current cycle of design / implementation)
- Do NOT assume object-oriented design, consider performance before domain, prioritize data-driven design and balance it with domain design. CODE FOLLOWS DATA, NOT VICE VERSA.
- Unless it absolutely suits the design (ask the user if in doubt!), avoid the use of events - they lead to hard-to-follow execution order and tend to create more problems than they solve
- Use structs (NOT classes) for simple (i.e., PoD) data types whenever possible
- Be defensive - use assertions to verify assumptions regarding passed parameters and/or in-use state

## Misc

### Spelling
- Prefer Canadian spelling over American, (e.g., "colour" NOT "color"), unless the name is already determined by a third-party library.
