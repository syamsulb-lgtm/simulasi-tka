# Simulasi Test (Test Generator)

A Node.js web app that generates test-specific, timed exercise tests (TKA SMA simulations) for invited candidates. An admin defines a **Test** (topic mix, difficulty mix, question count, time limit, passing score), invites candidates, and each candidate receives a freshly assembled test through a private link. Answers are graded automatically.

## Features

- **Question bank** of 1,350 questions across 5 topics, parsed from the `Bank_Soal_TKA_SMA_*.md` files.
- **Three question types:** single answer (PG), multiple answer (PGK) and true/false statements (BS), with shared reading passages and tables.
- **Weighted test generation:** topic and difficulty percentages are honored exactly (largest-remainder apportionment), with warnings when the bank can't satisfy a request.
- **Timed, single-session tests:** the deadline is set by the server when the candidate starts; reopening the link resumes the same exam.
- **No candidate accounts:** the unguessable link is the credential.
- **Admin panel:** tests, candidates, results with a question-by-question review, and a question bank browser where difficulty can be corrected.
- **Answers never reach the browser early:** the answer key is stripped server-side before the quiz renders.

## Requirements

- Node.js 24 (ES modules)

## Getting started

```bash
npm install
npm run seed    # load the question bank from the .md files into data/db.json
npm start       # http://localhost:15001
```

Admin panel: http://localhost:15001/admin

On first run a default admin account is created (`admin` / `admin123`). Change it after logging in (Admin > Account).

For development with auto-restart: `npm run dev`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `15001` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to bind (all interfaces, so the LAN can reach it) |
| `SESSION_SECRET` | built-in dev value | Secret for admin session cookies. Set your own outside local use. |

## Typical workflow

1. **Seed** the question bank (`npm run seed`).
2. **Create a test** in the admin panel: pick topic percentages (must total 100), optional easy/medium/hard split, number of questions, time limit and passing score.
3. **Invite a candidate:** the questions are generated at invite time. Any shortfall warnings are shown, and you get the candidate's test link.
4. **Candidate takes the test** at `/test/<token>`. The timer starts when they click Start, and the test auto-submits when time runs out.
5. **Review results** under Results in the admin panel.

## Question bank

The bank is loaded from the five source files in the project root:

| File | Topic | Questions |
|---|---|---|
| `Bank_Soal_TKA_SMA_Bahasa_Indonesia.md` | Bahasa Indonesia | 300 |
| `Bank_Soal_TKA_SMA_Bahasa_Inggris.md` | Bahasa Inggris | 300 |
| `Bank_Soal_TKA_SMA_Matematika.md` | Matematika | 250 |
| `Bank_Soal_TKA_SMA_Matematika_Lanjut.md` | Matematika Lanjut | 250 |
| `Bank_Soal_TKA_SMA_Ekonomi.md` | Ekonomi | 250 |

`npm run seed` replaces the `questions` collection only. Tests, candidates, exams, results and admins are left untouched.

To add a new file, append an entry to `SOURCES` in [src/seed/seed.js](src/seed/seed.js) and re-run the seed. The file must follow the same layout as the existing ones (question tags such as `**1.** **[PG][Tekstual]**`, an answer-key table headed `Rekap Kunci Jawaban`, and `Kunci & Pembahasan` blocks).

**Difficulty** is derived from each question's cognitive tag: Tekstual and Pemahaman are easy; Inferensi and Penerapan are medium; Evaluasi, Refleksi and Penalaran are hard. It can be changed per question in Admin > Question Bank.

**Scoring** is 1 point per question, all or nothing: a PGK question needs exactly the right set of options, and a BS question needs every statement right.

## Project structure

```
Bank_Soal_TKA_SMA_*.md     question bank sources
data/db.json               lowdb file: questions, tests, candidates, exams, results, admins
docs/                      architecture reference (architecture.html)
src/
  server.js                Express app, sessions, route mounting
  db.js                    lowdb bootstrap + default admin
  lib/markdown.js          safe renderer for passages and tables
  middleware/auth.js       admin session guard
  routes/admin.js          tests, candidates, results, question bank
  routes/candidate.js      landing, start, quiz, submit
  services/testGenerator.js  weighted selection + backfill
  services/scoring.js      grading for PG / PGK / BS
  seed/parseBank.js        .md to normalized questions
  seed/seed.js             writes the questions collection
  views/                   EJS templates (admin, candidate, partials)
  public/                  CSS and quiz.js (timer, answer autosave)
```

See [docs/architecture.html](docs/architecture.html) for diagrams, the data model and the selection algorithm.

## Data and backups

All state lives in `data/db.json`. To back up or reset, stop the server and copy or replace that file. Deleting the `questions` collection's contents and re-running `npm run seed` restores the bank.

## Limitations

- Single JSON file and in-memory sessions: built for one Node process. Admin sessions reset on restart.
- The test link is the only access control. Anyone with the link can take the test.
- No proctoring (tab switching, pasting and repeat attempts aren't detected).
