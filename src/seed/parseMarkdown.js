// Parses the exercise-test markdown files in the project root into a flat
// array of normalized question objects that can be inserted into lowdb.
//
// Two authoring formats are supported (both present in this repo):
//   1. "- A. option text"  (basic-*.md, bss-operations-*.md)
//   2. "A. option text"    (50-api-integration-*.md, scm-50-*.md)
//
// Every file ends with an "# Answer Key" table:  | Q | Ans | Rationale |
// Two of the files additionally carry a fine-grained "Topic Mapping" table
// with a cognitive-level column (R = recall, A = apply, D = diagnose) which
// we fold into an easy/medium/hard difficulty rating. Files without that
// table get a difficulty inferred from the file itself (see FILE_META).

import fs from 'node:fs';

const QUESTION_RE = /^\*\*(\d+)\.\*\*\s*(.+)$/;
const OPTION_RE = /^-?\s*([A-D])\.\s+(.+)$/;
const SECTION_RE = /^##\s+Section\s+[A-Z]\s+—\s+(.+?)\s*\(/;
const ANSWER_ROW_RE = /^\|\s*(\d+)\s*\|\s*([A-D])\s*\|\s*(.+?)\s*\|$/;
// 5-column topic-mapping table: | Q | Topic | <domain> | <source> | Level |
const LEVEL_ROW_RE = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([RAD])\s*\|$/;

const LEVEL_MAP = { R: 'easy', A: 'medium', D: 'hard' };

/**
 * @param {string} filePath
 * @param {{category: string, defaultLevel: string}} meta
 */
export function parseMarkdownFile(filePath, meta) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const questions = new Map(); // num -> question object
  const answerKey = new Map(); // num -> { ans, rationale }
  const topicLevels = new Map(); // num -> { topic, level }

  let currentSection = null;
  let current = null; // question being built
  let inAnswerKey = false;
  let inTopicMapping = false;

  for (const line of lines) {
    if (/^#\s+Answer Key/i.test(line)) {
      inAnswerKey = true;
      inTopicMapping = false;
      continue;
    }
    if (/^#\s+Topic Mapping/.test(line)) {
      inTopicMapping = true;
      inAnswerKey = false;
      continue;
    }

    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch && !inAnswerKey && !inTopicMapping) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (inAnswerKey) {
      const m = line.match(ANSWER_ROW_RE);
      if (m) answerKey.set(Number(m[1]), { ans: m[2], rationale: m[3] });
      continue;
    }

    if (inTopicMapping) {
      // The mapping table is exactly 50 rows (Q 1-50); once we've seen them
      // all, stop treating later tables in the same doc (coverage summary,
      // theme coverage, etc.) as more mapping rows.
      if (topicLevels.size >= 50) {
        inTopicMapping = false;
      } else {
        const m = line.match(LEVEL_ROW_RE);
        if (m) topicLevels.set(Number(m[1]), { topic: m[2].trim(), level: LEVEL_MAP[m[5]] });
        continue;
      }
    }

    const qMatch = line.match(QUESTION_RE);
    if (qMatch) {
      current = {
        num: Number(qMatch[1]),
        text: qMatch[2].trim(),
        section: currentSection,
        options: [],
      };
      questions.set(current.num, current);
      continue;
    }

    const oMatch = line.match(OPTION_RE);
    if (oMatch && current) {
      current.options.push({ letter: oMatch[1], text: oMatch[2].trim() });
      continue;
    }
  }

  // Files without a per-question R/A/D table (i.e. topicLevels is empty)
  // still progress from foundational to advanced sections, so derive a
  // easy/medium/hard split from each question's section position instead
  // of flattening the whole file to one level. Sections are bucketed into
  // thirds in the order they first appear in the document.
  const sectionOrder = [];
  for (const q of questions.values()) {
    if (q.section && !sectionOrder.includes(q.section)) sectionOrder.push(q.section);
  }
  function levelFromSection(section) {
    if (!section || sectionOrder.length === 0) return meta.defaultLevel;
    const idx = sectionOrder.indexOf(section);
    const ratio = (idx + 1) / sectionOrder.length;
    if (ratio <= 1 / 3) return 'easy';
    if (ratio <= 2 / 3) return 'medium';
    return 'hard';
  }

  const letterIndex = { A: 0, B: 1, C: 2, D: 3 };
  const result = [];
  for (const [num, q] of questions) {
    const ans = answerKey.get(num);
    const lvl = topicLevels.get(num);
    if (!ans || q.options.length !== 4) continue; // skip malformed entries defensively

    result.push({
      id: `${meta.slug}-${String(num).padStart(2, '0')}`,
      sourceFile: meta.fileName,
      category: meta.category,
      section: q.section,
      topic: lvl?.topic || q.section,
      level: lvl?.level || levelFromSection(q.section),
      text: q.text,
      options: q.options.map((o) => o.text),
      correctIndex: letterIndex[ans.ans],
      explanation: ans.rationale,
    });
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
