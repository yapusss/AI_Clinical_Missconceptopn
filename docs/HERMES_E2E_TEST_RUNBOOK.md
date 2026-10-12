# Hermes: End-to-End Test Runbook

## Mission

Test EvalAI Academic as a real user across all supported roles and layers: visual UI, responsive behavior, browser interactions, authorization, API responses, database side effects, asynchronous AI analysis, and lecturer validation.

Report defects with severity, reproducible steps, expected versus actual behavior, screenshots/video, browser console errors, failed network request/response (redact tokens), and relevant backend/worker logs. Do not edit application code or modify production data.

## Application Under Test

| Item | Value |
| --- | --- |
| Web app | `http://localhost:3000` |
| Backend API | `http://localhost:8000/api` directly, or `/api` through the frontend proxy |
| Database | PostgreSQL in the `postgres` Docker service |
| Cache/queue support | Valkey in the `valkey` Docker service |
| Analysis worker | Docker Compose profile `worker`; required for real LLM analysis |
| Main roles | Administrator, Lecturer, Student, General/demo account |
| Core product language | Indonesian |

Use a clean Chrome/Chromium profile or separate browser contexts for every role. Never reuse a role's browser storage, token, or session in another role's context.

## Required Preflight

### 1. Start services

From repository root:

```powershell
docker compose up -d --build
docker compose ps
docker compose exec -T backend python manage.py check
docker compose exec -T backend python manage.py migrate
docker compose exec -T backend python manage.py seed_demo_data
```

Expected running services: `postgres`, `valkey`, `backend`, and `frontend`. Expected public ports: frontend `3000`, backend `8000`, PostgreSQL `5432`, Valkey `6379`.

For a brand-new non-production database, the unmanaged domain schema must exist before using Django endpoints. Only on an empty throwaway database:

```powershell
docker cp V2_Full_Script.sql postgres:/tmp/V2_Full_Script.sql
docker exec postgres psql -v ON_ERROR_STOP=1 -U appuser -d appdb -f /tmp/V2_Full_Script.sql
docker compose exec -T backend python manage.py migrate
docker compose exec -T backend python manage.py seed_demo_data
```

Do not run `V2_Full_Script.sql`, delete Docker volumes, or reset the database on a shared environment without explicit approval.

### 2. Optional reference data

`V2_Student_Flow_Data.sql` provides reference question sets and historical student submissions. It is safe to rerun but is intended for a non-production demo database.

```powershell
docker cp V2_Student_Flow_Data.sql postgres:/tmp/V2_Student_Flow_Data.sql
docker exec postgres psql -v ON_ERROR_STOP=1 -U appuser -d appdb -f /tmp/V2_Student_Flow_Data.sql
```

### 3. Configure real AI analysis

The student-to-validation lifecycle needs a reachable OpenAI-compatible LLM API. Ensure the backend and worker receive valid deployment-only variables:

```text
LLM_BASE_URL=<provider OpenAI-compatible URL>
LLM_API_KEY=<secret; never include in report>
LLM_MODEL=<approved model identifier>
LLM_TIMEOUT=60
LLM_MAX_RUNS=3
```

Start the worker only after these are valid:

```powershell
docker compose --profile worker up -d --build worker
docker compose logs --tail=100 worker
```

If no real LLM is available, execute every non-AI flow and mark AI pipeline checks as **blocked by missing provider**, not failed. Never substitute a fake success result.

### 4. Browser baseline

Test at least:

| Viewport | Required checks |
| --- | --- |
| Desktop: 1440 x 900 | Full workflow, tables, charts, sidebar |
| Laptop: 1024 x 768 | No clipped controls or horizontal page overflow |
| Mobile: 390 x 844 | Sidebar drawer, forms, long text, modals, timed exam |

Run the primary visual path in dark mode and light mode. Check keyboard navigation: `Tab`, `Shift+Tab`, `Enter`, `Space`, and `Escape` for menu/modal dismissal. Use browser console and Network tabs with Preserve log enabled.

## Test Accounts

All seeded demo accounts use password `demo12345`.

| Role/use | Email | Expected authorization |
| --- | --- | --- |
| Administrator | `admin@acm.local` | `is_superuser=true`; manages users, subjects, website, help, questions, AI settings |
| Lecturer | `lecturer@acm.local` | Lecturer role for seeded Biology and Physics subjects; creates questions/packages and validates analyses |
| Student | `student@acm.local` | Student role for seeded Biology and Physics subjects; takes exams and reviews submitted results |
| General/demo | `demo@acm.local` | Active account without role-specific privilege; validates least-privilege behavior |
| Django admin only | username `admin` | Django admin site support account; do not confuse it with product login |

Login API is `POST /api/auth/login` with JSON `{ "email": "...", "password": "..." }`. The response token must be sent as `Authorization: Bearer <token>`. Tokens are sensitive and must be redacted in test evidence.

## Test Data To Create

Create unique test data with a Hermes prefix, for example `HERMES-<YYYYMMDD>-<random>`, to make it identifiable and removable.

Use a meaningful Four-Tier question such as:

```text
Prompt: Sebuah lift dipercepat ke atas. Bandingkan gaya normal dan gaya berat penumpang, lalu jelaskan alasannya.
Jawaban singkat acuan: Gaya normal lebih besar daripada gaya berat.
Alasan acuan: N - mg = ma, sehingga N = m(g + a) ketika percepatan lift ke atas.
```

Prepare three student responses for one active package:

| Case | Tier 1 answer | Tier 2 confidence | Tier 3 reason | Tier 4 confidence | Purpose |
| --- | --- | ---: | --- | ---: | --- |
| Correct | `Gaya normal lebih besar.` | 5 | `Karena N - mg = ma sehingga N = m(g+a).` | 5 | Expected scientifically correct result |
| Misconception | `Gaya normal sama dengan berat.` | 5 | `Karena penumpang diam relatif terhadap lift maka semua gaya nol.` | 5 | Expected incorrect/misconception candidate |
| Empty reason | `Gaya normal lebih besar.` | 4 | empty or fewer than five words | 4 | Heuristic `t3_kosong` and non-success path |

## Role Workflows

### A. Public and Authentication

1. Open `/`; inspect landing page and links.
2. Open `/login`; verify required fields, invalid email format, wrong password, and inactive/unknown-account behavior do not leak account details.
3. Log in with every account in separate contexts.
4. Verify the login destination, displayed name, and available navigation match role.
5. Logout and verify protected route access redirects to `/login`; browser Back must not restore authenticated data.
6. Register one unique student from the registration flow if exposed. Confirm duplicate email/NIM validation and that the new account has Student role only.
7. Check `/api/auth/me` with valid token (200), no token (401), malformed token (401), and after logout (401).

Visual acceptance: no layout shift, clear validation errors, password not visible, accessible labels, visible focus ring, and mobile layout is usable.

### B. Administrator

Use `admin@acm.local`.

#### Dashboard and navigation

1. Open `/dashboard`; verify system counters, package and validation status charts, activity list, AI-health panel, alerts, empty states, and links.
2. Visit every sidebar route: `/dashboard`, `/questions`, `/admin/lecturers`, `/admin/students`, `/admin/subjects`, `/admin/website`, `/help`, `/settings`, `/profile`.
3. Toggle theme from sidebar and Settings; refresh and confirm the chosen theme persists.
4. On mobile, open/close drawer with trigger, overlay, Escape, and route navigation.

#### User management

1. Create a lecturer with a unique email, password, and both/all relevant subject assignments.
2. Create a student with unique email, NIM, password, and subject assignments.
3. Edit name, active status, password, and assigned subjects.
4. Verify duplicate email/NIM, missing password for creation, invalid input, and cannot use protected fields through the UI.
5. Deactivate the test user; confirm login is rejected. Reactivate and confirm login works.
6. Delete if UI supports it; confirm list/detail/dashboard update and no unrelated user changes.

#### Subjects, topics, website, and help

1. Create, edit, archive/deactivate, and restore/activate a subject if supported.
2. Create, edit, and delete a topic under a subject; verify it appears in question creation and package grouping.
3. Update a website section with text, button link, visibility, ordering, and image if supported; verify public landing output and no unsafe HTML execution.
4. Create, edit, hide/publish, and delete help articles for each supported role. Confirm users only see permitted published content.

#### Question bank

1. Create a multi-question set with title, subject, topic, rich prompt, short answer, model answer, and concept indicators.
2. Confirm unsaved-change guard on sidebar, breadcrumb, browser navigation, and reload.
3. Save as draft. Confirm it is not selectable in active exam package creation or student lookup.
4. Edit, publish, view, export, deactivate/reactivate, and inspect versioning.
5. Exercise import: download template, upload valid file, inspect rows/errors, commit valid import; upload malformed/wrong-column file and verify readable failure without partial corruption.

#### AI model settings

1. Open `/settings` as admin; only approved models from server should be selectable. The selector must use the custom application listbox, close on outside click/Escape, and support keyboard focus.
2. Use **Uji Koneksi** for the current model. Expect successful confirmation only with a reachable configured provider.
3. Change active model only to an existing enabled model. Verify confirmation says it affects new analyses only.
4. Confirm API does not return `LLM_API_KEY`, base URL credentials, or secret environment variables.
5. If direct database seeding added more than one allowed model, select another approved model and later verify a new `llm_analyses.model_identifier` records it; prior analyses must retain their original model.

### C. Lecturer

Use `lecturer@acm.local`, or the new lecturer created by admin.

#### Content and package authoring

1. Confirm lecturer sees only assigned subjects and cannot manage users, website, global help, or AI settings.
2. Create/edit/publish a question set for an assigned subject. Check rich-text toolbar, image upload if present, source/sanitization behavior, indicators, multi-question navigation, deletion confirmation, and cancellation.
3. Attempt to access a different/unauthorized subject by changing URL; expect denial/not found, never data exposure.
4. Create an exam package from published questions:
   - valid code/title;
   - at least one published question to activate;
   - `opens_at` earlier than `closes_at`;
   - duration at least 0.5 hour;
   - duration not longer than open/close window;
   - `max_attempts` >= 1;
   - each scoring policy: highest, average, and last attempt;
   - both expiry modes: `REJECT` and `AUTO_SUBMIT`;
   - optional access password.
5. Test package draft save, edit, duplicate, activate/deactivate, review details, and student result review. Check password is never rendered in API/UI response.
6. Try invalid dates, zero/negative duration, duration exceeding schedule, invalid attempts, duplicate package code, active package without questions, and unselected draft question. Verify API and UI reject consistently.

#### AI validation workflow

1. Wait until a new student submission moves from `SUBMITTED`/`ANALYZING` to `PENDING_VALIDATION`.
2. Open `/validation`; verify only analyses within lecturer subject scope appear.
3. Open an analysis. Verify student response, all four tiers, reference answer, LLM model identifier, category, explanation, confidence, and execution time are present and readable.
4. Submit each validation outcome:
   - `ACCEPTED`: preserves/accepts AI score and produces `VALIDATED`.
   - `EDITED`: alters final score/tier/feedback and produces `VALIDATED`.
   - `REJECTED`: accepts notes, produces `REJECTED`, and becomes eligible for bounded reanalysis.
5. Reopen an already validated/rejected analysis and correct it. Verify audit/diff behavior and final student-facing result.
6. Confirm student cannot see lecturer-only raw analysis before validation, and another lecturer cannot retrieve this analysis through a guessed ID.

### D. Student

Use `student@acm.local`. Do not use the same account used for earlier historical test cases if max attempts is being tested.

#### Discovery and access

1. Open `/dashboard` and `/code`; verify only active, currently-open, assigned packages are available.
2. Search by exact code and invalid/unknown code. Test wrong package password, then correct password.
3. Verify draft, inactive, future, and closed packages cannot be started. Confirm errors are explanatory but do not leak protected question content.
4. Start a valid package. Verify package metadata, question order, progress, previous/next navigation, required fields, answer persistence, and local draft behavior.

#### Four-Tier submission

1. Submit all three prepared responses in separate eligible attempts/packages: correct, misconception, and empty/very short Tier 3 reason.
2. Verify Tier 1, Tier 2 confidence, Tier 3 reason, and Tier 4 confidence reach the API correctly.
3. Submit with blank required answer, invalid confidence, overly long input, and network interruption/retry; no duplicate submission should be created.
4. Check submission list/detail: status transitions, package association, attempt number, and eventual lecturer-approved feedback/score.
5. Confirm a student can access only their own submission details; guessed IDs from another student must fail.

#### Timed package regressions

Create short-lived dedicated packages in a throwaway environment so this can be tested quickly.

1. **Normal completion:** submit before deadline; only completed answers are recorded and package attempt becomes submitted.
2. **Duration deadline:** start package with duration shorter than close time; timer must use the server-provided effective deadline.
3. **Closing deadline:** start package with close time earlier than duration deadline; closing time wins.
4. **REJECT behavior:** let deadline pass, attempt submit, verify no answer is submitted, local draft is removed, and UI redirects to `/code#pengumpulan` without an expiry modal.
5. **AUTO_SUBMIT behavior:** let deadline pass with some incomplete questions. Verify automatic request is made once, only complete answers are sent, and no second submission is created on reload.
6. Reload, open second tab, change client clock, return after sleep, and navigate backward/forward. Server must remain authoritative; client time manipulation cannot extend access.
7. Verify max attempts and score policy after multiple attempts.

### E. General/demo account and authorization boundaries

Use `demo@acm.local`.

1. Verify navigation only shows general-safe routes: dashboard, help, profile.
2. Visit privileged routes directly (`/admin/lecturers`, `/admin/students`, `/admin/subjects`, `/questions`, `/settings`, `/validation`, `/code`) and verify no data-changing or data-leaking access.
3. Repeat with direct API calls using the general token. Every unauthorized action must return 401/403/404 as designed, with no partial state change.

## API and Backend Verification

Use browser Network records for UI-generated traffic and a REST client for authorization negatives. Do not invent endpoint paths: use this route inventory.

| Area | Endpoint(s) | Expected role/access |
| --- | --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Public register/login; authenticated me |
| Dashboard | `GET /api/dashboard/summary` | Authenticated; payload scoped by role |
| Admin users | `/api/admin/users/{LECTURER|STUDENT}`, `/api/admin/users/{role}/{id}` | Superuser only |
| Admin content | `/api/admin/subjects`, `/api/admin/subjects/{id}`, `/api/admin/subjects/{id}/topics`, `/api/admin/topics/{id}` | Admin and scoped lecturer behavior as exposed by UI |
| Website/help | `/api/admin/website/sections`, `/api/admin/help/{role}`, `/api/help`, `/api/website/sections` | Admin mutations; `/api/help` requires authentication and returns published content within role scope |
| AI settings | `GET/PATCH /api/admin/ai/settings`, `POST /api/admin/ai/test` | Superuser only |
| Questions/import | `/api/questions`, `/api/questions/{id}`, `/api/questions/{id}/publish`, `/api/question-imports`, `/api/question-import-template` | Authenticated role/scope enforced server-side |
| Packages | `/api/exam-packages`, `/api/exam-packages/{id}`, `/duplicate`, `/review`, `/toggle-active` | Lecturer/admin scope enforced server-side |
| Student packages | `/api/student/sets`, `/api/student/sets/{id}/submissions`, `/auto-submit`, `/questions/{qid}/submissions` | Student identity, package timing/password/attempt rules enforced |
| Student results | `/api/student/submissions`, `/api/student/submission-packages`, `/api/student/submission-packages/{id}` | Owner only |
| Validation | `/api/validations/queue`, `/tiers`, `/{analysis_id}`, `/{analysis_id}/submit` | Lecturer subject scope (and authorized admin behavior) |
| Metrics | `GET /api/metrics/model` | Authorized metric scope |

For every mutation endpoint, check all of the following:

1. Valid request gives expected 2xx response and persisted state.
2. No token gives 401.
3. General/student/lecturer token outside scope gives denial, not success.
4. Invalid UUID/body/type/range gives 400/404 without a 500.
5. Repeating safe action is idempotent where expected; duplicate submission/actions do not create duplicate records.
6. Error responses contain no traceback, password hash, token, database DSN, LLM key, or internal stack data.

## Database and Worker Assertions

After primary workflow, inspect only the dedicated Hermes records. Example commands:

```powershell
docker exec postgres psql -U appuser -d appdb -c "SELECT email, is_active, is_superuser FROM users WHERE email LIKE 'hermes%';"
docker exec postgres psql -U appuser -d appdb -c "SELECT code, title, is_active, opens_at, closes_at, duration_minutes, expiry_behavior FROM exam_packages WHERE code LIKE 'HERMES%';"
docker exec postgres psql -U appuser -d appdb -c "SELECT status, count(*) FROM submissions GROUP BY status ORDER BY status;"
docker exec postgres psql -U appuser -d appdb -c "SELECT model_identifier, prompt_version, run_number, is_current FROM llm_analyses ORDER BY created_at DESC LIMIT 20;"
docker compose logs --tail=200 backend
docker compose logs --tail=200 worker
```

Expected lifecycle:

```text
Student submission -> SUBMITTED -> ANALYZING -> PENDING_VALIDATION
Lecturer accepts/edits -> VALIDATED
Lecturer rejects -> REJECTED -> bounded worker reanalysis -> PENDING_VALIDATION or ANALYSIS_FAILED
```

Assertions:

1. Each analysis persists the resolved `model_identifier` and existing history never changes after an admin switches model.
2. Worker claims a submission once; concurrency/reload does not duplicate analyses or submissions.
3. AI failure gives `ANALYSIS_FAILED` with bounded retry behavior, not a permanently stuck `ANALYZING` state.
4. Validation results, final feedback, and package score are visible only after appropriate state transition and ownership checks.
5. Audit-sensitive operations produce expected data changes without modifying unrelated rows.

## Visual, Accessibility, and Resilience Checklist

Apply to all pages visited, not only the happy path.

- No horizontal overflow, clipped modal, inaccessible button, overlap, or unreadable contrast at all three viewport sizes.
- Cards, tables, charts, dropdowns, rich-text content, empty states, errors, loading states, and disabled actions follow the existing dark/light design tokens.
- Custom dropdowns retain visible focus, selected indicator, outside-click dismissal, Escape dismissal, and usable keyboard interaction.
- Errors/warnings use `FeedbackModal` or established feedback pattern and can be closed by visible close control, backdrop where applicable, and Escape.
- Form labels map to inputs; icon-only controls have accessible labels; status messages use appropriate roles.
- Long subject names, prompts, answers, feedback, and API error text wrap without breaking layout.
- Refresh/reconnect behavior preserves only intended drafts/preferences and never replays irreversible requests.
- Network failures show actionable UI feedback; retry does not double-create records.
- Check browser console for errors/warnings caused by tested routes and API calls.

## Exit Criteria and Report Format

Do not declare pass until all applicable role workflows, authorization checks, desktop/mobile visual checks, and API mutation checks are executed.

Final report must contain:

1. Environment: commit/branch, URL, browser/version, viewport, service status, whether real LLM worker was enabled.
2. Coverage table: test ID/role/flow/result (`PASS`, `FAIL`, `BLOCKED`, `NOT RUN`) and evidence link.
3. Defects first, sorted `Critical`, `High`, `Medium`, `Low`; include exact reproduction and impact.
4. Visual findings with screenshot before/after or annotated screenshot.
5. API findings with method/path/status/request payload/response excerpt; redact secrets.
6. AI pipeline observation: model identifier, worker logs, status transitions, or explicit blocker.
7. Data created by Hermes, including IDs/codes, so it can be cleaned up deliberately after review.
8. Residual risks and untested cases, especially any provider-dependent behavior blocked by configuration.

## Non-Negotiable Safety Rules

- Do not expose or paste `LLM_API_KEY`, auth tokens, password hashes, `.env` contents, or database credentials in logs/screenshots/report.
- Do not test against production without written approval and dedicated non-real test accounts.
- Do not use destructive Docker/database commands or mass deletion without written approval.
- Do not treat sidebar visibility or client-selected role as authorization proof; verify server responses with role-specific tokens.
- Do not change model/provider secrets through UI. The UI only selects already approved model identifiers.
