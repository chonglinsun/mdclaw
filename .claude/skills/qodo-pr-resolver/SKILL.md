---
disable-model-invocation: true
---

# /qodo-pr-resolver — PR Review Resolution

Resolves PR review comments by analyzing feedback, implementing fixes, and updating the PR.

## When to use

Run `/qodo-pr-resolver` after receiving PR review comments that need code changes.

## Steps to perform

### Phase 1: Gather review comments

1. Get the PR number from the user or detect from current branch:
   ```bash
   gh pr view --json number,reviews,comments
   ```
2. List all unresolved review comments:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '.[] | select(.position != null)'
   ```
3. Group comments by file and line number

### Phase 2: Analyze and plan

For each comment:
1. Read the referenced file and line range
2. Understand the reviewer's request
3. Determine if it's a:
   - **Code change** — fix, refactor, rename
   - **Question** — needs a reply, not a code change
   - **Style issue** — formatting, naming convention
   - **Bug report** — requires investigation

### Phase 3: Implement fixes

For code changes:
1. Make the requested change
2. Run `npx tsc --noEmit` to verify type safety
3. Run relevant tests: `npx vitest run {affected_test_file}`

For questions:
1. Reply to the comment via `gh api`:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies -f body="..."
   ```

### Phase 4: Commit and push

1. Stage changed files
2. Commit with a message referencing the review:
   ```
   Address PR review feedback

   - Fix: {summary of change 1}
   - Fix: {summary of change 2}
   ```
3. Push to the PR branch

### Phase 5: Verify

1. `npx tsc --noEmit` — zero errors
2. `npx vitest run` — all tests pass
3. Notify: "Review comments addressed, ready for re-review"

## Verification

```bash
npx tsc --noEmit
npx vitest run
```
