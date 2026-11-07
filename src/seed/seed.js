// Seeds data/db.json with the question bank parsed from the Bank_Soal_TKA_SMA_*.md
// files that live in the project root. Safe to re-run: it replaces the
// `questions` collection wholesale but leaves tests/candidates/exams/
// results/admins untouched.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBankFile } from './parseBank.js';
import { getDb } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/seed/ -> src/ -> project root, where the source .md files live
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const SOURCES = [
  { fileName: 'Bank_Soal_TKA_SMA_Bahasa_Indonesia.md', slug: 'indonesia', category: 'Bahasa Indonesia' },
  { fileName: 'Bank_Soal_TKA_SMA_Bahasa_Inggris.md', slug: 'inggris', category: 'Bahasa Inggris' },
  { fileName: 'Bank_Soal_TKA_SMA_Matematika.md', slug: 'matematika', category: 'Matematika' },
  { fileName: 'Bank_Soal_TKA_SMA_Matematika_Lanjut.md', slug: 'matematika-lanjut', category: 'Matematika Lanjut' },
  { fileName: 'Bank_Soal_TKA_SMA_Ekonomi.md', slug: 'ekonomi', category: 'Ekonomi' },
];

async function main() {
  const db = await getDb();

  let all = [];
  for (const meta of SOURCES) {
    const filePath = path.join(PROJECT_ROOT, meta.fileName);
    try {
      const { questions, problems } = parseBankFile(filePath, meta);
      console.log(`Parsed ${questions.length.toString().padStart(3)} questions from ${meta.fileName}`);
      for (const p of problems) console.warn(`  skipped ${p}`);
      all = all.concat(questions);
    } catch (err) {
      console.error(`Failed to parse ${meta.fileName}:`, err.message);
    }
  }

  db.data.questions = all;
  await db.write();

  console.log(`\nSeeded ${all.length} questions into data/db.json`);
  const byCategory = {};
  for (const q of all) {
    byCategory[q.category] = byCategory[q.category] || { easy: 0, medium: 0, hard: 0 };
    byCategory[q.category][q.level]++;
  }
  console.table(byCategory);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
