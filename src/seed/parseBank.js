// Parses the "Bank_Soal_TKA_SMA_*.md" files into normalized question objects.
//
// Layout of those files:
//   ## Teks N — Title          reading passage (blockquote / table lines) shared by the next questions
//   **12.** **[PG][Tag]** ...  question; type is PG (single answer), PGK (several answers)
//                              or BS (a Benar/Salah table, one verdict per statement)
//   - A. option                A-E options (PG / PGK)
//   > **Kunci & Pembahasan**   per-question explanations ("12-C — reason")
//   ## Rekap Kunci Jawaban     authoritative answer-key tables (| No | Kunci | ... |)

import fs from 'node:fs';

const QUESTION_RE = /^\*\*(\d+)\.\*\*\s*\*\*\[(PG|PGK|BS)\]\[([^\]]+)\]\*\*\s*(.*)$/;
const OPTION_RE = /^-\s+([A-E])\.\s+(.+)$/;
const PASSAGE_HEAD_RE = /^##\s+(?:Teks|Text)\s+(\d+)\s+—\s+(.+)$/;
const SECTION_RE = /^#\s+BAGIAN\s+[A-Z]\s+—\s+(.+)$/;
const KUNCI_RE = /^>\s*\*\*Kunci/;
const EXPLAIN_RE = /(?<![\w])(\d{1,3})-((?:[A-E](?:,\s*[A-E])*)|(?:(?:Benar|Salah)(?:,\s*(?:Benar|Salah))*))(?=[\s)—;.,:]|$)/g;

const LEVEL_BY_COGNITIVE = {
  Tekstual: 'easy',
  Pemahaman: 'easy',
  Inferensi: 'medium',
  Penerapan: 'medium',
  Evaluasi: 'hard',
  Refleksi: 'hard',
  Penalaran: 'hard',
};

const LETTERS = 'ABCDE';

function parseKey(type, raw) {
  const key = raw.replace(/\s*\(.*$/, '').trim();
  if (type === 'PG') return LETTERS.indexOf(key);
  if (type === 'PGK') return key.split(/\s*,\s*/).map((l) => LETTERS.indexOf(l));
  return key.split(/\s*[–-]\s*/).map((v) => v === 'B');
}

// Many entries in the source only list the key with no reasoning; fall back
// to a readable statement of the key itself.
function explanationFor(text, type, key) {
  if (text && /\w/.test(text)) return text;
  if (type === 'PG') return `Jawaban benar: ${LETTERS[key]}.`;
  if (type === 'PGK') return `Jawaban benar: ${key.map((k) => LETTERS[k]).join(', ')}.`;
  return `Jawaban benar: ${key.map((v) => (v ? 'Benar' : 'Salah')).join(', ')}.`;
}

function parseExplanations(kunciLines) {
  const text = kunciLines
    .map((l) => l.replace(/^>\s?/, '').replace(/^-\s+/, '').replace(/\*\*/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
  const found = [...text.matchAll(EXPLAIN_RE)];
  const out = new Map();
  found.forEach((m, i) => {
    const end = i + 1 < found.length ? found[i + 1].index : text.length;
    const body = text
      .slice(m.index + m[0].length, end)
      .replace(/^[\s—;:-]+/, '')
      .replace(/[\s;]+$/, '')
      .replace(/^\((.*)\)\.?$/, '$1');
    out.set(Number(m[1]), body);
  });
  return out;
}

/**
 * @param {string} filePath
 * @param {{slug: string, category: string, fileName: string}} meta
 */
export function parseBankFile(filePath, meta) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  const questions = new Map();
  const explanations = new Map();
  const answerKey = new Map(); // num -> raw key string

  let section = null;
  let passage = null; // { id, title, lines[] }
  let collectingPassage = false;
  let current = null;
  let kunci = null; // lines of the Kunci block being read
  let inRekap = false;

  const flushKunci = () => {
    if (!kunci) return;
    for (const [n, e] of parseExplanations(kunci)) explanations.set(n, e);
    kunci = null;
  };

  for (const line of lines) {
    if (kunci) {
      if (line.trim() !== '' && /^>/.test(line)) {
        kunci.push(line);
        continue;
      }
      flushKunci();
    }

    if (/^#{1,2}\s+Rekap Kunci/i.test(line)) {
      inRekap = true;
      current = null;
      continue;
    }
    if (inRekap) {
      if (/^\|/.test(line)) {
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        for (let i = 0; i + 1 < cells.length; i += 2) {
          if (/^\d+$/.test(cells[i]) && cells[i + 1] && !/^-+$/.test(cells[i + 1])) {
            answerKey.set(Number(cells[i]), cells[i + 1]);
          }
        }
        continue;
      }
      if (!SECTION_RE.test(line) && !PASSAGE_HEAD_RE.test(line)) continue;
    }

    if (KUNCI_RE.test(line)) {
      kunci = [line];
      collectingPassage = false;
      current = null;
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1].replace(/\s*\(Soal.*$/, '').trim();
      passage = null;
      collectingPassage = false;
      current = null;
      inRekap = false;
      continue;
    }

    const passageMatch = line.match(PASSAGE_HEAD_RE);
    if (passageMatch) {
      passage = {
        id: `${meta.slug}-t${String(passageMatch[1]).padStart(2, '0')}`,
        title: passageMatch[2].trim(),
        lines: [],
      };
      collectingPassage = true;
      current = null;
      inRekap = false;
      continue;
    }

    const qMatch = line.match(QUESTION_RE);
    if (qMatch) {
      collectingPassage = false;
      const [, num, type, tag, rest] = qMatch;
      const [first, second] = tag.split('·').map((s) => s.trim());
      const cognitive = second || first;
      current = {
        num: Number(num),
        type,
        topic: second ? first : cognitive,
        level: LEVEL_BY_COGNITIVE[cognitive] || 'medium',
        section,
        passage,
        stem: rest.trim() ? [rest.trim()] : [],
        options: [],
        statements: [],
        inOptions: false,
      };
      questions.set(current.num, current);
      continue;
    }

    if (collectingPassage && passage) {
      if (line.trim() === '---') continue;
      passage.lines.push(line.replace(/^>\s?/, '').replace(/\s+$/, ''));
      continue;
    }

    if (!current) continue;

    const oMatch = line.match(OPTION_RE);
    if (oMatch) {
      current.inOptions = true;
      current.options.push(oMatch[2].trim());
      continue;
    }
    if (current.inOptions || line.trim() === '' || line.trim() === '---') continue;

    if (current.type === 'BS' && /^\|/.test(line)) {
      if (line.includes('☐')) {
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        current.statements.push(cells[0]);
      }
      continue;
    }
    current.stem.push(line.trim());
  }
  flushKunci();

  const result = [];
  const problems = [];
  for (const [num, q] of questions) {
    const rawKey = answerKey.get(num);
    const id = `${meta.slug}-${String(num).padStart(3, '0')}`;
    if (!rawKey) {
      problems.push(`${id}: no answer key`);
      continue;
    }
    const key = parseKey(q.type, rawKey);
    const bad =
      (q.type === 'PG' && (key < 0 || key >= q.options.length)) ||
      (q.type === 'PGK' && (key.length < 2 || key.some((k) => k < 0 || k >= q.options.length))) ||
      (q.type === 'BS' && (q.statements.length < 2 || key.length !== q.statements.length)) ||
      (q.type !== 'BS' && q.options.length < 2);
    if (bad) {
      problems.push(`${id}: malformed (${q.type}, ${q.options.length} options, ${q.statements.length} statements, key "${rawKey}")`);
      continue;
    }

    const trimPassage = q.passage
      ? q.passage.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      : null;

    const out = {
      id,
      sourceFile: meta.fileName,
      category: meta.category,
      section: q.section,
      topic: q.topic,
      level: q.level,
      type: q.type,
      passageId: q.passage ? q.passage.id : null,
      passageTitle: q.passage ? q.passage.title : null,
      passage: trimPassage,
      text: q.stem.join('\n'),
      explanation: explanationFor(explanations.get(num), q.type, key),
    };
    if (q.type === 'BS') {
      out.statements = q.statements;
      out.correctAnswers = key;
    } else {
      out.options = q.options;
      if (q.type === 'PG') out.correctIndex = key;
      else out.correctIndexes = key;
    }
    result.push(out);
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  return { questions: result, problems };
}
