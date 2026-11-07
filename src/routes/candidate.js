import express from 'express';
import { getDb } from '../db.js';
import { gradeExam } from '../services/scoring.js';

const router = express.Router();

function notFound(res) {
  return res.status(404).render('candidate/error', {
    heading: 'Test link not found',
    message: 'This link is invalid. Please check the URL or ask the recruiter to resend it.',
  });
}

function loadContext(db, token) {
  const exam = db.data.exams.find((e) => e.token === token);
  if (!exam) return null;
  const candidate = db.data.candidates.find((c) => c.id === exam.candidateId);
  const test = db.data.tests.find((p) => p.id === exam.testId);
  return { exam, candidate, test };
}

/** Reads one question's answer out of the submitted form body (undefined = unanswered). */
function readAnswer(q, body) {
  if (q.type === 'BS') {
    const arr = q.statements.map((_, k) => {
      const v = body[`answer_${q.id}_${k}`];
      return v === '1' ? true : v === '0' ? false : null;
    });
    return arr.some((v) => v !== null) ? arr : undefined;
  }
  const raw = body[`answer_${q.id}`];
  if (raw === undefined || raw === '') return undefined;
  if (q.type === 'PGK') return [].concat(raw).map(Number);
  return Number(raw);
}

/**
 * Grades whatever answers were submitted (possibly none, if the candidate's
 * timer ran out and the auto-submit never reached the server) and records
 * the Result, transitioning the exam to `completed`.
 */
async function finalizeSubmission(db, ctx, answersRaw) {
  const { exam, candidate, test } = ctx;
  const questions = exam.questionIds
    .map((id) => db.data.questions.find((q) => q.id === id))
    .filter(Boolean);

  const answers = {};
  for (const q of questions) {
    const a = readAnswer(q, answersRaw || {});
    if (a !== undefined) answers[q.id] = a;
  }

  const grade = gradeExam(questions, answers);
  const now = new Date();
  const startedAt = exam.startedAt ? new Date(exam.startedAt) : now;
  const durationSeconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const passed = grade.percentage >= (test ? test.passingPercent : 0);

  const result = {
    id: `res-${exam.id}`,
    examId: exam.id,
    candidateId: candidate ? candidate.id : null,
    testId: test ? test.id : null,
    candidateName: candidate ? candidate.name : 'Unknown candidate',
    testTitle: test ? test.title : 'Unknown test',
    passingPercent: test ? test.passingPercent : 0,
    timeLimitMinutes: exam.timeLimitMinutes,
    total: grade.total,
    correctCount: grade.correctCount,
    percentage: grade.percentage,
    passed,
    byCategory: grade.byCategory,
    breakdown: grade.breakdown,
    startedAt: exam.startedAt,
    submittedAt: now.toISOString(),
    durationSeconds,
  };

  exam.status = 'completed';
  exam.submittedAt = now.toISOString();

  db.data.results = db.data.results.filter((r) => r.examId !== exam.id);
  db.data.results.push(result);
  await db.write();
  return result;
}

router.get('/:token', async (req, res) => {
  const db = await getDb();
  const ctx = loadContext(db, req.params.token);
  if (!ctx) return notFound(res);
  const { exam, candidate, test } = ctx;
  if (!candidate || !test) return notFound(res);

  if (exam.status === 'pending') {
    return res.render('candidate/landing', { test, candidate, token: exam.token });
  }

  if (exam.status === 'in_progress') {
    if (exam.deadlineAt && Date.now() > new Date(exam.deadlineAt).getTime()) {
      await finalizeSubmission(db, ctx, {});
      return res.redirect(`/test/${exam.token}`);
    }
    return res.redirect(`/test/${exam.token}/quiz`);
  }

  if (exam.status === 'completed') {
    const result = db.data.results.find((r) => r.examId === exam.id);
    if (!result) return notFound(res);
    return res.render('candidate/submitted', {
      test, candidate,
      percentage: result.percentage, correctCount: result.correctCount, total: result.total, passed: result.passed,
    });
  }

  return res.status(410).render('candidate/error', {
    heading: 'This test link is no longer active',
    message: 'A new link may have been issued. Please contact the recruiter if you believe this is a mistake.',
  });
});

router.post('/:token/start', async (req, res) => {
  const db = await getDb();
  const ctx = loadContext(db, req.params.token);
  if (!ctx) return notFound(res);
  const { exam } = ctx;

  if (exam.status === 'pending') {
    const now = new Date();
    exam.status = 'in_progress';
    exam.startedAt = now.toISOString();
    exam.deadlineAt = new Date(now.getTime() + exam.timeLimitMinutes * 60 * 1000).toISOString();
    await db.write();
  }

  res.redirect(`/test/${exam.token}/quiz`);
});

router.get('/:token/quiz', async (req, res) => {
  const db = await getDb();
  const ctx = loadContext(db, req.params.token);
  if (!ctx) return notFound(res);
  const { exam, candidate, test } = ctx;
  if (!candidate || !test) return notFound(res);

  if (exam.status !== 'in_progress') return res.redirect(`/test/${exam.token}`);

  if (exam.deadlineAt && Date.now() > new Date(exam.deadlineAt).getTime()) {
    await finalizeSubmission(db, ctx, {});
    return res.redirect(`/test/${exam.token}`);
  }

  const questions = exam.questionIds
    .map((id) => db.data.questions.find((q) => q.id === id))
    .filter(Boolean)
    // Never expose the answer key/explanation to the candidate's browser.
    .map((q) => ({
      id: q.id, category: q.category, type: q.type || 'PG', text: q.text,
      options: q.options || [], statements: q.statements || [],
      passageId: q.passageId || null, passageTitle: q.passageTitle || null, passage: q.passage || null,
    }));

  res.render('candidate/quiz', {
    test, candidate, questions,
    token: exam.token,
    deadlineAt: new Date(exam.deadlineAt).getTime(),
  });
});

router.post('/:token/submit', async (req, res) => {
  const db = await getDb();
  const ctx = loadContext(db, req.params.token);
  if (!ctx) return notFound(res);
  const { exam } = ctx;

  if (exam.status === 'in_progress') {
    await finalizeSubmission(db, ctx, req.body);
  }

  res.redirect(`/test/${exam.token}`);
});

export default router;
