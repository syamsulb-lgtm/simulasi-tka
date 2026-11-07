// Grades a submitted exam against the question bank and produces a summary
// broken down by category and difficulty level, without ever needing to
// send correct answers to the candidate's browser beforehand.
//
// Question types (each question is worth 1 point, all-or-nothing):
//   PG  - single answer:   answer is an option index
//   PGK - multiple answer: answer is an array of option indexes; must match the key set exactly
//   BS  - true/false:      answer is an array of booleans/null, one per statement; all must match

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function isCorrect(q, answer) {
  if (answer === undefined || answer === null) return false;
  switch (q.type || 'PG') {
    case 'PGK':
      return Array.isArray(answer) && sameSet(answer, q.correctIndexes);
    case 'BS':
      return Array.isArray(answer) && answer.length === q.correctAnswers.length && answer.every((v, i) => v === q.correctAnswers[i]);
    default:
      return answer === q.correctIndex;
  }
}

/**
 * @param {Array} questions - the exam's questions (full objects, in order)
 * @param {Record<string, number|number[]|(boolean|null)[]>} answers - questionId -> answer (shape depends on type)
 */
export function gradeExam(questions, answers) {
  let correctCount = 0;
  const breakdown = [];
  const byCategory = new Map();

  for (const q of questions) {
    const answer = answers[q.id] ?? null;
    const correct = isCorrect(q, answer);
    if (correct) correctCount++;

    breakdown.push({
      questionId: q.id,
      category: q.category,
      level: q.level,
      type: q.type || 'PG',
      passageTitle: q.passageTitle || null,
      passage: q.passage || null,
      text: q.text,
      options: q.options || [],
      statements: q.statements || [],
      answer,
      correctIndex: q.correctIndex ?? null,
      correctIndexes: q.correctIndexes || null,
      correctAnswers: q.correctAnswers || null,
      correct,
      explanation: q.explanation,
    });

    const stat = byCategory.get(q.category) || { total: 0, correct: 0 };
    stat.total++;
    if (correct) stat.correct++;
    byCategory.set(q.category, stat);
  }

  const total = questions.length;
  const percentage = total === 0 ? 0 : Math.round((correctCount / total) * 10000) / 100;

  return {
    total,
    correctCount,
    percentage,
    byCategory: [...byCategory.entries()].map(([category, s]) => ({
      category,
      total: s.total,
      correct: s.correct,
      percentage: s.total === 0 ? 0 : Math.round((s.correct / s.total) * 10000) / 100,
    })),
    breakdown,
  };
}
