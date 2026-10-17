# `docs/` in this repository

**This repository is PUBLIC.** Anything committed here is world-readable forever, including in git
history after a later deletion. That is the only rule that matters: `docs/` may hold files that are
safe to publish, nothing else.

## Allowed here

- Task/feature TODOs and checklists (`MATHLIVE_TODO.md` style) — scope, locked decisions, open items.
- Public-facing technical notes: how a UI component works, which migrations a change needs.
- Anything about the *product* that a reader of the code could already infer.

## Not allowed here — keep them in the out-of-repo docs directory

Authoritative internal docs stay at `D:\ClinicalAI_Misconception\docs\` (outside the repo):
`HANDOFF.md`, phase task files (`Cn_TASK.md`, `Rn_TASK.md`, `Sn_TASK.md`), briefs, plans.

That directory is the home for anything in this list:

- Credentials or anything derived from them: API keys, tokens, passwords, connection strings,
  `.env` contents, secret fragments.
- Infrastructure and ops detail: hostnames, IPs, ports of real services, SSH/tunnel/Cloudflare
  configuration, VPS paths, deploy credentials.
- Personal data: student names/answers, lecturer identities, emails, audit logs.
- Raw DB dumps, seed data, or screenshots of real records.
- Incident write-ups that name a live credential or an exploit path.

## Before adding a file

```bash
grep -nEi "api[_-]?key|secret|password|passwd|token|bearer|sk-|ghp_|private key" docs/<file>
```

A hit is not automatically a leak (a placeholder like `${LLM_API_KEY:-local-llama-cpp}` is fine),
but every hit must be read and justified before the commit.

## History note

This directory was emptied on 2026-10-16 (`b36df9e5 chore: drop the handoff docs from the repo`)
because the docs contained internal detail. It was reopened on 2026-10-17 for non-sensitive files
only; `MATHLIVE_TODO.md` is the first such file. Do not re-add the handoff or the phase task files
here.
