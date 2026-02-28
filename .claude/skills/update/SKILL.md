---
disable-model-invocation: true
---

# /update — Merge Upstream Changes

Pulls the latest mdclaw changes from the upstream repository while preserving your local customizations (personality files, .env, channel configs, group data).

## When to use

Run `/update` when:
- New features or bug fixes are available upstream
- You want to update skill files to their latest versions
- The agent-runner or container Dockerfile has been updated

## Prerequisites

- Must be in a git repository with an upstream remote
- Local changes should be committed (uncommitted changes will be stashed)

## Steps to perform

### Phase 1: Pre-flight

1. Check git status — warn if there are uncommitted changes
2. Stash any uncommitted changes: `git stash`
3. Identify the upstream remote:
   ```bash
   git remote -v | grep fetch
   ```
4. If no upstream remote exists, add it:
   ```bash
   git remote add upstream https://github.com/qwibitai/mdclaw.git
   ```

### Phase 2: Fetch and merge

1. Fetch upstream:
   ```bash
   git fetch upstream
   ```
2. Identify the default branch (main or master):
   ```bash
   git remote show upstream | grep 'HEAD branch'
   ```
3. Merge upstream into current branch:
   ```bash
   git merge upstream/main --no-edit
   ```
4. If merge conflicts occur:
   - List conflicted files: `git diff --name-only --diff-filter=U`
   - For each conflict, analyze the file:
     - **Real code** (`container/agent-runner/`, `test/`, `container/Dockerfile`): prefer upstream, apply local fixes on top
     - **Skill files** (`.claude/skills/`): prefer upstream (skills are regenerable)
     - **Generated code** (`src/`): prefer upstream, will be regenerated
     - **User data** (`data/`, `.env`, personality files): prefer LOCAL (user customizations)
   - Resolve conflicts and commit

### Phase 3: Rebuild

1. Rebuild agent-runner:
   ```bash
   cd container/agent-runner && npm install && npm run build && cd ../..
   ```
2. Install any new dependencies:
   ```bash
   npm install
   ```
3. Rebuild host:
   ```bash
   npm run build
   ```
4. If the Dockerfile changed, rebuild the container image:
   ```bash
   docker build -t mdclaw -f container/Dockerfile .
   ```

### Phase 4: Re-apply customizations

1. Pop stashed changes if any: `git stash pop`
2. Check if personality files are intact:
   ```bash
   ls data/*/IDENTITY.md data/*/SOUL.md 2>/dev/null
   ```
3. Check if .env is intact:
   ```bash
   cat .env | head -5
   ```

### Phase 5: Verify

1. Type check: `npx tsc --noEmit`
2. Run tests: `npx vitest run`
3. Build: `npm run build`

If any step fails, diagnose and fix before proceeding.

## Protected files

These files are NEVER overwritten by upstream changes:

- `.env` — user configuration
- `data/*/IDENTITY.md` — personality files
- `data/*/SOUL.md` — personality files
- `data/*/CLAUDE.md` — group instructions
- `store/` — database and auth state
- `data/sessions/` — session history

## Verification

```bash
npx tsc --noEmit
npx vitest run
npm run build
```
