# Backend system tests (AI4EDU_BE)

Black-box tests that call the running API over HTTP and check the database. Results: `results/suites/<SUITE>.json`; `python3 aggregate.py` builds `results/system_test_table.csv/json`.

> ⚠️ **Never run against Atlas or any real database.** Several tests prove access-control bugs by actually changing roles, passwords and deleting other users' records. `start-be.sh` refuses to start unless `../.env.systest` points `MONGO_URI` at localhost.

## Setup (once)

1. MongoDB ≥ 7 locally as a single-node replica set:
   `mongod --dbpath ./tmp-db --port 27017 --replSet rs0` then once `mongosh --eval 'rs.initiate()'`
2. `cp systest/env.systest.example .env.systest` (in `AI4EDU_BE/`)
3. `cd systest && npm install`

## Run

```bash
cd AI4EDU_BE/systest
npm run mock &             # OpenAI-compatible mock on :4010 (or remove OPENAI_BASE_URL in .env.systest to use real OpenAI)
bash start-be.sh           # backend with test env, rate limit raised for functional tests
npm run test:functional    # auth, ai, courses, assess, submit, collab, monitoring, security
npm run report             # merged table
```

Run these **alone** (nothing else hitting the server):
- `npm run test:ratelimit` — restarts the backend with the production default limit, then restores.
- `npm run test:robustness` — switches the mock into failure modes (500/429/garbage/empty/slow).
- `npm run test:db-outage` — shuts MongoDB down; restart `mongod` ~20 s later by hand; the suite waits for recovery.
- `npm run test:stress` — seeds 2,000 courses + 20,000 log rows (remove afterwards: `courseId: /^vol-c-/`, `metadata.volume: true`, `sessionId: 'stress'`).

## Suites → report tasks

| File | Suite | IDs | Area |
|---|---|---|---|
| `be-tests/auth.test.js` | BE-AUTH | AUTH-* | register/login/logout/password/OAuth |
| `be-tests/ai-features.test.js` | BE-AI | CHAT-*, PRM-*, WKS-*, MSG-* | chatbot, prompts, worksheets, stakeholder chat |
| `be-tests/courses.test.js` | BE-COURSES | CRS-*, CPD-*, EXR-*, LOM-*, LOG-*, FIL-* | courses, course-plan docs, exercises, LO mappings, logs, files |
| `be-tests/assessment-setup.test.js` | BE-ASSESS | PRJ-*, TSK-*, ROL-*, QUZ-*, QSB-*, UPL-* | projects, tasks, roles, quizzes, quiz submissions, upload |
| `be-tests/submissions.test.js` | BE-SUBMIT | SUB-* | assessment submissions & AI feedback |
| `be-tests/collab.test.js` | BE-COLLAB | GRP-*, PKR-*, SWT-*, STU-*, USR-*, NTF-* | groups, planning poker, SWOT, students, users, notifications |
| `be-tests/monitoring.test.js` | BE-MON | MON-*, MET-*, LIT-*, UFB-*, SYS-* | monitoring, metrics, AI literacy, feedback, app-level |
| `be-tests/security.test.js` | BE-SEC | SEC-* | anonymous sweep of all endpoints, headers, CORS, cookies, injection |
| `be-tests/ratelimit.test.js` | BE-RATE | RATE-* | rate limit, XFF spoofing, brute force |
| `be-tests/robustness.test.js` | BE-ROB | ROB-00…37 | AI upstream failures, malformed input |
| `be-tests/db-outage.test.js` | BE-DBOUT | ROB-22…24 | database outage and recovery |
| `stress/stress.js` | STRESS | ST-* | load, volume, spike, soak |

A test that is expected to change after a fix (e.g. a status code you deliberately choose differently) — update its `expected` and condition in the same commit and say why.
