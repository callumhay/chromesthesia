# Review Plan

You are tasked with critically reviewing an implementation plan to catch issues before implementation begins. Your role is that of a skeptical technical reviewer who verifies assumptions, identifies gaps, and ensures the plan is actually implementable.

## Initial Response

When this command is invoked:

1. **Check if a plan path was provided**:
   - If yes, read the plan FULLY (no limit/offset)
   - Begin the review process immediately

2. **If no plan path provided**, respond with:
```
I'll help you review an implementation plan. Please provide the path to the plan file.

Example: `/review_plan thoughts/shared/plans/2025-01-15-terrain-refactor.md`
```

Then wait for the user's input.

## Review Philosophy

Plans often look reasonable on paper but fall apart when they meet reality. Your job is to:
- **Verify, don't assume** - Check that what the plan says about the codebase is actually true
- **Think like an implementer** - Would you know exactly what to do from this plan?
- **Be skeptical** - Question vague language, hand-wavy steps, and optimistic assumptions
- **Find the gaps** - What does the plan NOT address that it should?

## Review Process

### Step 1: Initial Read and Context Gathering

1. **Read the plan completely** - Use Read tool without limit/offset
2. **Read all referenced files**:
   - Original ticket (if mentioned)
   - Any files the plan references
   - Related research documents
3. **Note your initial impressions**:
   - Does the plan have a clear goal?
   - Are the phases logical?
   - What seems vague or hand-wavy?

### Step 2: Verify Codebase Assumptions

The plan makes claims about the codebase. Verify them.

1. **Spawn parallel research tasks** to check:
   - **codebase-locator**: Do the files mentioned in the plan actually exist at those paths?
   - **codebase-analyzer**: Does the code work the way the plan assumes it does?
   - **codebase-pattern-finder**: Are there existing patterns the plan should follow but doesn't mention?

2. **For each file the plan says to modify**:
   - Does it exist?
   - Does it have the structure the plan expects?
   - Are the line numbers / function names accurate?
   - Has the code changed since the plan was written?

3. **Check for stale references**:
   - Is the git commit in the plan (if any) current?
   - Have the referenced files been modified since the plan was created?

### Step 3: Evaluate Plan Quality

Assess the plan against these criteria:

#### Correctness
- [ ] File paths are accurate and files exist
- [ ] The plan's understanding of existing code is correct
- [ ] Technical approach is sound for this codebase
- [ ] Dependencies between phases are correctly ordered
- [ ] No contradictions between phases

#### Completeness
- [ ] All necessary files are identified
- [ ] No orphaned references (mentioning something without explaining it)
- [ ] Success criteria are specific and verifiable
- [ ] Edge cases are addressed
- [ ] Error handling is considered
- [ ] No "TODO" or "TBD" items remain
- [ ] No open questions in the plan

#### Scope & Ordering
- [ ] Each phase is appropriately sized (not too big, not too small)
- [ ] Phases build logically on each other
- [ ] No circular dependencies
- [ ] Can be implemented incrementally with working state between phases
- [ ] "What we're NOT doing" section is present and clear

#### Architecture & Design
- [ ] Follows existing codebase patterns and conventions
- [ ] Doesn't introduce unnecessary complexity
- [ ] Reuses existing code when possible OR if very close to existing functionality makes note of it
- [ ] Changes are cohesive (related things change together)
- [ ] No over-engineering or premature abstraction
- [ ] Performance implications considered where relevant

#### Implementability
- [ ] A competent developer could implement this without asking questions
- [ ] Code snippets are syntactically correct
- [ ] APIs used actually exist and work as described
- [ ] Integration points are clearly defined

### Step 4: Identify Risks and Gaps

Look for things that could derail implementation:

1. **Missing information**:
   - What would an implementer need to look up or figure out?
   - What decisions are deferred that should be made now?

2. **Risky assumptions**:
   - What does the plan assume that might not be true?
   - What external dependencies could change?

3. **Scope creep potential**:
   - Are there vague requirements that could expand?
   - Does "and other related changes" appear anywhere?

4. **Testing gaps**:
   - Can the success criteria actually be verified?
   - Are manual testing steps specific enough?

### Step 5: Generate Review Report

Present your findings in this format:

```markdown
## Plan Review: [Plan Name]

**Plan file**: `[path to plan]`
**Review date**: [today's date]
**Plan appears**: [READY FOR IMPLEMENTATION / NEEDS REVISION / MAJOR ISSUES]

### Summary
[2-3 sentence overall assessment]

### Verification Results

#### Files Checked
- `path/to/file.cs` - [EXISTS / MISSING / CHANGED SINCE PLAN]
- ...

#### Assumptions Verified
- [Assumption from plan] - [CORRECT / INCORRECT - actual situation]
- ...

### Issues Found

#### Critical (Must Fix Before Implementation)
1. **[Issue title]**
   - Location in plan: [section/phase]
   - Problem: [what's wrong]
   - Impact: [why this matters]
   - Suggested fix: [how to address it]

#### Important (Should Fix)
1. ...

#### Minor (Nice to Fix)
1. ...

### Missing Elements
- [Thing that should be in the plan but isn't]
- ...

### Recommendations
- [Specific recommendation for improving the plan]
- ...
```

### Questions for Plan Author
1. [Specific question that needs answering]
2. ...

### Step 6: Discuss with User

After presenting the report:
- Ask if they want clarification on any findings
- Offer to help update the plan if issues were found
- If the plan is ready, confirm they can proceed to `/implement_plan`

## Important Guidelines

1. **Be constructive, not just critical**:
   - Point out issues but also acknowledge what's done well
   - Provide specific suggestions, not just complaints
   - The goal is a better plan, not a rejected plan

2. **Calibrate severity appropriately**:
   - Critical: Would cause implementation to fail or produce wrong results
   - Important: Would cause confusion or suboptimal implementation
   - Minor: Polish issues, unclear wording, style

3. **Don't over-review**:
   - Focus on substantive issues, not nitpicks
   - The plan doesn't need to be perfect, just implementable
   - Some ambiguity is acceptable if the direction is clear

4. **Trust but verify**:
   - The plan author probably knew what they were doing
   - But verify key assumptions with actual codebase research
   - Fresh eyes catch things the author missed

5. **Consider the implementer**:
   - Will likely be an AI agent or a developer unfamiliar with context
   - Needs explicit, unambiguous instructions
   - Can't read minds or fill in gaps

## Common Issues to Watch For

- **Stale file references**: Code has changed since plan was written
- **Missing error handling**: Happy path only, no consideration of failures
- **Unclear phase boundaries**: When is a phase "done"?
- **Dependency on unwritten code**: "After we implement X" but X isn't in the plan
- **Scope ambiguity**: "Update related tests" - which tests exactly?
- **Performance assumptions**: "This should be fast enough" without verification
- **Integration blindness**: Changes to one system without considering downstream effects
- **Copy-paste from research**: Plan includes research findings but not actionable steps