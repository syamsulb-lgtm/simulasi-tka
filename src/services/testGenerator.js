// Builds one concrete question set for a candidate's exam, given a Test's
// topic (category) weighting, optional difficulty (level) weighting, and a
// target total question count.
//
// Algorithm:
//   1. Split `totalQuestions` across categories using largest-remainder
//      rounding on the category percentages (so the counts always sum to
//      exactly `totalQuestions`, not just approximately).
//   2. If difficulty weighting is enabled, split each category's count again
//      across easy/medium/hard using the same rounding method.
//   3. Randomly sample (without replacement) from the bank for each
//      (category, level) cell.
//   4. If a cell doesn't have enough questions, the shortfall is backfilled
//      first from other levels of the same category, then from the general
//      pool of any remaining unused questions — so the generator always
//      returns exactly `totalQuestions` as long as the bank has that many
//      questions in total, and reports what it had to substitute.

const LEVELS = ['easy', 'medium', 'hard'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Largest-remainder apportionment: distributes `total` units across the
 * given weighted buckets so the resulting integer counts sum to exactly
 * `total`, while staying as close as possible to each bucket's exact share.
 * @param {{key: string, percent: number}[]} weights
 * @param {number} total
 * @returns {Map<string, number>}
 */
function apportion(weights, total) {
  const sumPercent = weights.reduce((s, w) => s + w.percent, 0) || 1;
  const exact = weights.map((w) => ({ key: w.key, exact: (w.percent / sumPercent) * total }));
  const floors = exact.map((e) => ({ key: e.key, count: Math.floor(e.exact), remainder: e.exact - Math.floor(e.exact) }));
  let allocated = floors.reduce((s, f) => s + f.count, 0);
  let remaining = total - allocated;

  const byRemainder = [...floors].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < byRemainder.length && remaining > 0; i++, remaining--) {
    byRemainder[i].count += 1;
  }

  const result = new Map();
  for (const f of floors) result.set(f.key, f.count);
  return result;
}

/**
 * @param {Array} bank - full question bank
 * @param {{
 *   totalQuestions: number,
 *   topicWeights: {category: string, percent: number}[],
 *   levelWeights?: {level: string, percent: number}[] | null
 * }} config
 * @returns {{ questionIds: string[], warnings: string[] }}
 */
export function generateQuestionSet(bank, config) {
  const { totalQuestions, topicWeights, levelWeights } = config;
  const warnings = [];

  const byCategory = new Map();
  for (const category of topicWeights.map((t) => t.category)) {
    byCategory.set(category, bank.filter((q) => q.category === category));
  }

  const categoryCounts = apportion(
    topicWeights.map((t) => ({ key: t.category, percent: t.percent })),
    totalQuestions
  );

  const selected = [];
  const usedIds = new Set();
  const shortfallByCategory = new Map();

  for (const [category, desiredCount] of categoryCounts) {
    const pool = byCategory.get(category) || [];
    let cellTargets;

    if (levelWeights && levelWeights.length > 0) {
      cellTargets = apportion(
        levelWeights.map((l) => ({ key: l.level, percent: l.percent })),
        desiredCount
      );
    } else {
      cellTargets = new Map([['any', desiredCount]]);
    }

    let categoryShortfall = 0;
    for (const [level, want] of cellTargets) {
      const candidates = shuffle(
        level === 'any' ? pool : pool.filter((q) => q.level === level)
      ).filter((q) => !usedIds.has(q.id));

      const take = candidates.slice(0, want);
      for (const q of take) {
        selected.push(q);
        usedIds.add(q.id);
      }
      if (take.length < want) categoryShortfall += want - take.length;
    }

    // Backfill shortfall from other levels within the same category first.
    if (categoryShortfall > 0) {
      const rest = shuffle(pool.filter((q) => !usedIds.has(q.id)));
      const take = rest.slice(0, categoryShortfall);
      for (const q of take) {
        selected.push(q);
        usedIds.add(q.id);
      }
      categoryShortfall -= take.length;
    }

    if (categoryShortfall > 0) shortfallByCategory.set(category, categoryShortfall);
  }

  // Final backfill from the entire bank (any category/level) so the exam
  // still gets exactly `totalQuestions` questions whenever the bank has
  // enough overall, even if the requested distribution couldn't be honored.
  let totalShortfall = [...shortfallByCategory.values()].reduce((s, n) => s + n, 0);
  if (totalShortfall > 0) {
    for (const [category, n] of shortfallByCategory) {
      warnings.push(`Not enough "${category}" questions to satisfy the requested distribution (short by ${n}); backfilled from the general pool.`);
    }
    const rest = shuffle(bank.filter((q) => !usedIds.has(q.id)));
    const take = rest.slice(0, totalShortfall);
    for (const q of take) {
      selected.push(q);
      usedIds.add(q.id);
    }
    totalShortfall -= take.length;
  }

  if (selected.length < totalQuestions) {
    warnings.push(`Question bank only has ${selected.length} usable questions; requested ${totalQuestions}.`);
  }

  // Shuffle in passage groups so questions about the same reading passage
  // stay together (the quiz shows each passage once above its questions).
  const groups = new Map();
  for (const q of selected) {
    const key = q.passageId || q.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const ordered = shuffle([...groups.values()]).flatMap((g) => g.sort((a, b) => a.id.localeCompare(b.id)));

  return { questionIds: ordered.map((q) => q.id), warnings };
}

export { LEVELS };
