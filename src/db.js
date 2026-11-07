// Central lowdb accessor. The whole app (seed script, routes, services)
// shares a single JSON file as the "test bank" + operational data store.
//
// Collections:
//   questions  - the multiple-choice question bank (parsed from *.md)
//   tests  - hiring tests with topic/level weighting + timer config
//   candidates - people invited to take a test
//   exams      - one generated test instance for one candidate (token, question set, timing)
//   results    - graded submissions for an exam
//   admins     - admin web users

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  questions: [],
  tests: [],
  candidates: [],
  exams: [],
  results: [],
  admins: [],
};

let dbPromise = null;

async function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const adapter = new JSONFile(DB_FILE);
  const db = new Low(adapter, DEFAULT_DATA);
  await db.read();
  db.data ||= structuredClone(DEFAULT_DATA);

  // Make sure every collection exists even if the file predates one of them.
  for (const key of Object.keys(DEFAULT_DATA)) {
    db.data[key] ||= structuredClone(DEFAULT_DATA[key]);
  }

  // Seed a default admin account on first run so the app is usable right
  // after `npm install && npm run seed`. Credentials are printed once.
  if (db.data.admins.length === 0) {
    const defaultPassword = 'admin123';
    db.data.admins.push({
      id: 'admin-1',
      username: 'admin',
      passwordHash: bcrypt.hashSync(defaultPassword, 10),
      createdAt: new Date().toISOString(),
    });
    await db.write();
    console.log('----------------------------------------------------------');
    console.log(' Created default admin account:');
    console.log('   username: admin');
    console.log(`   password: ${defaultPassword}`);
    console.log(' Change this after first login (Admin > Account).');
    console.log('----------------------------------------------------------');
  }

  return db;
}

export function getDb() {
  dbPromise ||= initDb();
  return dbPromise;
}
