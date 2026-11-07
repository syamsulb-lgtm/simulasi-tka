import express from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { getDb } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { generateQuestionSet } from '../services/testGenerator.js';

const router = express.Router();

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

function distinctCategories(questions) {
  return [...new Set(questions.map((q) => q.category))].sort();
}

// ---- Auth ----

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Login' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();
  const admin = db.data.admins.find((a) => a.username === username);
  if (!admin || !bcrypt.compareSync(password || '', admin.passwordHash)) {
    req.flash('error', 'Invalid username or password.');
    return res.redirect('/admin/login');
  }
  req.session.adminId = admin.id;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(requireAdmin);

// ---- Dashboard ----

router.get('/', async (req, res) => {
  const db = await getDb();
  const { tests, candidates, questions, exams, results } = db.data;

  const pending = exams.filter((e) => e.status === 'pending' || e.status === 'in_progress').length;
  const completed = results.length;
  const avgScore = results.length
    ? Math.round((results.reduce((s, r) => s + r.percentage, 0) / results.length) * 10) / 10
    : null;

  const recentResults = [...results]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 5)
    .map((r) => ({ ...r, submittedAtDisplay: formatDateTime(r.submittedAt) }));

  res.render('admin/dashboard', {
    title: 'Dashboard',
    stats: { tests: tests.length, candidates: candidates.length, questions: questions.length, pending, completed, avgScore },
    recentResults,
  });
});

// ---- Tests ----

router.get('/tests', async (req, res) => {
  const db = await getDb();
  res.render('admin/tests', { title: 'Tests', tests: db.data.tests });
});

router.get('/tests/new', async (req, res) => {
  const db = await getDb();
  res.render('admin/testForm', { title: 'New Test', test: null, categories: distinctCategories(db.data.questions) });
});

router.get('/tests/:id/edit', async (req, res) => {
  const db = await getDb();
  const test = db.data.tests.find((p) => p.id === req.params.id);
  if (!test) {
    req.flash('error', 'Test not found.');
    return res.redirect('/admin/tests');
  }
  res.render('admin/testForm', { title: 'Edit Test', test, categories: distinctCategories(db.data.questions) });
});

function parseTestBody(body) {
  // express.urlencoded({extended:true}) uses `qs`, which collapses
  // repeated "name[]" fields into a plain array under "name" (no brackets).
  const topicCategory = [].concat(body.topicCategory || []);
  const topicPercent = [].concat(body.topicPercent || []);
  const topicWeights = topicCategory
    .map((category, i) => ({ category, percent: Number(topicPercent[i]) || 0 }))
    .filter((t) => t.percent > 0);

  const enforceLevels = body.enforceLevels === 'on';
  let levelWeights = null;
  if (enforceLevels) {
    const levelName = [].concat(body.levelName || []);
    const levelPercent = [].concat(body.levelPercent || []);
    levelWeights = levelName
      .map((level, i) => ({ level, percent: Number(levelPercent[i]) || 0 }))
      .filter((l) => l.percent > 0);
  }

  return {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    totalQuestions: Math.max(1, Number(body.totalQuestions) || 0),
    timeLimitMinutes: Math.max(1, Number(body.timeLimitMinutes) || 0),
    passingPercent: Math.min(100, Math.max(0, Number(body.passingPercent) || 0)),
    topicWeights,
    levelWeights,
  };
}

function validateTest(pos) {
  const errors = [];
  if (!pos.title) errors.push('Title is required.');
  const topicSum = pos.topicWeights.reduce((s, t) => s + t.percent, 0);
  if (pos.topicWeights.length === 0) errors.push('Set at least one topic percentage.');
  else if (topicSum !== 100) errors.push(`Topic percentages must total 100% (currently ${topicSum}%).`);
  if (pos.levelWeights) {
    const levelSum = pos.levelWeights.reduce((s, l) => s + l.percent, 0);
    if (pos.levelWeights.length === 0) errors.push('Enable at least one difficulty level, or turn off difficulty enforcement.');
    else if (levelSum !== 100) errors.push(`Difficulty percentages must total 100% (currently ${levelSum}%).`);
  }
  return errors;
}

router.post('/tests', async (req, res) => {
  const db = await getDb();
  const pos = parseTestBody(req.body);
  const errors = validateTest(pos);
  if (errors.length) {
    req.flash('error', errors.join(' '));
    return res.redirect('/admin/tests/new');
  }
  const test = { id: nanoid(10), ...pos, createdAt: new Date().toISOString() };
  db.data.tests.push(test);
  await db.write();
  req.flash('success', `Test "${test.title}" created.`);
  res.redirect('/admin/tests');
});

router.post('/tests/:id', async (req, res) => {
  const db = await getDb();
  const test = db.data.tests.find((p) => p.id === req.params.id);
  if (!test) {
    req.flash('error', 'Test not found.');
    return res.redirect('/admin/tests');
  }
  const pos = parseTestBody(req.body);
  const errors = validateTest(pos);
  if (errors.length) {
    req.flash('error', errors.join(' '));
    return res.redirect(`/admin/tests/${test.id}/edit`);
  }
  Object.assign(test, pos);
  await db.write();
  req.flash('success', `Test "${test.title}" updated.`);
  res.redirect('/admin/tests');
});

router.post('/tests/:id/delete', async (req, res) => {
  const db = await getDb();
  db.data.tests = db.data.tests.filter((p) => p.id !== req.params.id);
  await db.write();
  req.flash('success', 'Test deleted.');
  res.redirect('/admin/tests');
});

// ---- Candidates ----

router.get('/candidates', async (req, res) => {
  const db = await getDb();
  const { candidates, exams, results, tests } = db.data;

  const rows = candidates
    .map((candidate) => {
      const candidateExams = exams
        .filter((e) => e.candidateId === candidate.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const exam = candidateExams[0] || null;
      const test = tests.find((p) => p.id === candidate.testId);
      const result = exam ? results.find((r) => r.examId === exam.id) : null;
      return { candidate, exam, result, testTitle: test ? test.title : '(deleted test)' };
    })
    .sort((a, b) => new Date(b.candidate.createdAt) - new Date(a.candidate.createdAt));

  res.render('admin/candidates', { title: 'Candidates', rows });
});

router.get('/candidates/new', async (req, res) => {
  const db = await getDb();
  res.render('admin/candidateForm', { title: 'Invite Candidate', tests: db.data.tests });
});

router.post('/candidates', async (req, res) => {
  const db = await getDb();
  const { name, email, testId } = req.body;
  const test = db.data.tests.find((p) => p.id === testId);
  if (!name || !email || !test) {
    req.flash('error', 'Please provide a name, email, and valid test.');
    return res.redirect('/admin/candidates/new');
  }

  const candidate = { id: nanoid(10), name: name.trim(), email: email.trim(), testId, createdAt: new Date().toISOString() };
  const { questionIds, warnings } = generateQuestionSet(db.data.questions, {
    totalQuestions: test.totalQuestions,
    topicWeights: test.topicWeights,
    levelWeights: test.levelWeights,
  });
  const exam = {
    id: nanoid(10),
    candidateId: candidate.id,
    testId: test.id,
    token: nanoid(24),
    status: 'pending',
    questionIds,
    timeLimitMinutes: test.timeLimitMinutes,
    startedAt: null,
    deadlineAt: null,
    submittedAt: null,
    createdAt: new Date().toISOString(),
  };

  db.data.candidates.push(candidate);
  db.data.exams.push(exam);
  await db.write();

  warnings.forEach((w) => req.flash('warning', w));
  req.flash('success', `${candidate.name} invited. Test link generated below.`);
  res.redirect(`/admin/candidates/${candidate.id}`);
});

router.get('/candidates/:id', async (req, res) => {
  const db = await getDb();
  const candidate = db.data.candidates.find((c) => c.id === req.params.id);
  if (!candidate) {
    req.flash('error', 'Candidate not found.');
    return res.redirect('/admin/candidates');
  }
  const test = db.data.tests.find((p) => p.id === candidate.testId);
  const exam = db.data.exams
    .filter((e) => e.candidateId === candidate.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!exam) {
    req.flash('error', 'This candidate has no test link. Try regenerating one.');
    return res.redirect('/admin/candidates');
  }

  const inviteUrl = `${req.protocol}://${req.get('host')}/test/${exam.token}`;
  res.render('admin/candidateDetail', {
    title: candidate.name,
    candidate,
    testTitle: test ? test.title : '(deleted test)',
    exam: { ...exam, startedAtDisplay: formatDateTime(exam.startedAt) },
    inviteUrl,
  });
});

router.post('/candidates/:id/regenerate', async (req, res) => {
  const db = await getDb();
  const candidate = db.data.candidates.find((c) => c.id === req.params.id);
  if (!candidate) {
    req.flash('error', 'Candidate not found.');
    return res.redirect('/admin/candidates');
  }
  const test = db.data.tests.find((p) => p.id === candidate.testId);
  if (!test) {
    req.flash('error', 'This candidate\'s test no longer exists.');
    return res.redirect('/admin/candidates');
  }

  // Expire any still-open exam for this candidate before issuing a new one.
  db.data.exams.forEach((e) => {
    if (e.candidateId === candidate.id && (e.status === 'pending' || e.status === 'in_progress')) {
      e.status = 'expired';
    }
  });

  const { questionIds, warnings } = generateQuestionSet(db.data.questions, {
    totalQuestions: test.totalQuestions,
    topicWeights: test.topicWeights,
    levelWeights: test.levelWeights,
  });
  const exam = {
    id: nanoid(10),
    candidateId: candidate.id,
    testId: test.id,
    token: nanoid(24),
    status: 'pending',
    questionIds,
    timeLimitMinutes: test.timeLimitMinutes,
    startedAt: null,
    deadlineAt: null,
    submittedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.data.exams.push(exam);
  await db.write();

  warnings.forEach((w) => req.flash('warning', w));
  req.flash('success', 'New test link generated.');
  res.redirect(`/admin/candidates/${candidate.id}`);
});

// ---- Results ----

router.get('/results', async (req, res) => {
  const db = await getDb();
  const results = [...db.data.results]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .map((r) => ({ ...r, submittedAtDisplay: formatDateTime(r.submittedAt), durationDisplay: formatDuration(r.durationSeconds) }));
  res.render('admin/results', { title: 'Results', results });
});

router.get('/results/:id', async (req, res) => {
  const db = await getDb();
  const result = db.data.results.find((r) => r.id === req.params.id);
  if (!result) {
    req.flash('error', 'Result not found.');
    return res.redirect('/admin/results');
  }
  res.render('admin/resultDetail', {
    title: 'Result',
    result: {
      ...result,
      submittedAtDisplay: formatDateTime(result.submittedAt),
      durationDisplay: formatDuration(result.durationSeconds),
    },
  });
});

// ---- Question bank ----

router.get('/questions', async (req, res) => {
  const db = await getDb();
  const { category = '', level = '' } = req.query;
  let questions = db.data.questions;
  if (category) questions = questions.filter((q) => q.category === category);
  if (level) questions = questions.filter((q) => q.level === level);

  res.render('admin/questions', {
    title: 'Question Bank',
    questions,
    total: db.data.questions.length,
    categories: distinctCategories(db.data.questions),
    filter: { category, level },
  });
});

router.post('/questions/:id/level', async (req, res) => {
  const db = await getDb();
  const question = db.data.questions.find((q) => q.id === req.params.id);
  if (question && ['easy', 'medium', 'hard'].includes(req.body.level)) {
    question.level = req.body.level;
    await db.write();
  }
  res.redirect(req.get('Referer') || '/admin/questions');
});

export default router;
