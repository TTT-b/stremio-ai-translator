---
name: git-workflow
description: Safe Git and GitHub routine for this repo (TTT-b/stremio-ai-translator). Use before pulling, committing, pushing, tagging, or opening a pull request.
---

# Git and GitHub workflow

Remote: `origin` = https://github.com/TTT-b/stremio-ai-translator. Default branch: `main`. Windows PowerShell commands.

## Start of work

1. `git status -sb` and `git fetch origin`.
2. If the working tree is clean: `git pull --ff-only`. If not clean, stop and tell the user what is modified.

## While working

- Work on a branch for anything non-trivial: `git switch -c <short-name>`. Small safe fixes may go straight to `main` only if the user says so.
- Commit small, focused changes. Message: `vX.Y.Z: short summary` for releases, otherwise `type: short summary` (`fix:`, `feat:`, `docs:`, `test:`, `chore:`).
- Stage files by name (`git add <file>`), never `git add .` or `-A` blindly. Check `git diff --staged` first.
- Never commit `.env`, `settings.json`, `data/`, `logs/`, `node_modules/`, `dist-electron/`, `release/`, tokens, or API keys. If a secret was committed, stop and tell the user to rotate it.
- Run `npm run check` before every commit. Do not commit while it fails.

## Pushing

- Push only when the user asks. Normal push: `git push`. Never `--force` on `main`. If a force push is truly needed on a personal branch, use `--force-with-lease` and ask first.
- Releases: bump `version` in `package.json`, update README/TROUBLESHOOTING if behavior changed, commit, then `git tag vX.Y.Z` and `git push --follow-tags` only after the user confirms. Each tag must point to its own commit.

### Release checks (every release, not just when something looks wrong)

1. `npm run check` passes (it includes the test that `RELEASE_NOTES` has he + en notes for the version in `package.json`).
2. The version in `package.json` is higher than the latest published tag (`git tag --sort=-v:refname | Select-Object -First 1`); the in-app updater only offers higher versions.
3. Build with `npm run dist` and have the user install it from `release/` first; wait for their OK before publishing.
4. After publishing, `gh release view vX.Y.Z` must list the installer `.exe`, its `.blockmap` and `latest.yml`. Without `latest.yml` the in-app "check for updates" finds nothing.
5. Tell the user to press "Check for updates" in the previous version and confirm it offers the new one.

## Syncing with the laptop/phone

- The desktop is the working machine. When the user says GitHub is updated: `git fetch origin`, show `git log --oneline HEAD..origin/main`, then `git pull --ff-only`. If it cannot fast-forward, show the divergence and ask before merging or rebasing.

## Recommended GitHub settings (user sets in the web UI)

Repo Settings -> Branches: protect `main` (require pull request, block force pushes, block deletion). Settings -> Code security: enable Secret scanning with push protection, Dependabot alerts, and Dependabot security updates. Settings -> General: enable "Automatically delete head branches". Account: turn on two-factor authentication.
