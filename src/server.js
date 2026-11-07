import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import flash from 'connect-flash';

import adminRouter from './routes/admin.js';
import candidateRouter from './routes/candidate.js';
import { getDb } from './db.js';
import { renderMd } from './lib/markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 15001;

async function main() {
  await getDb(); // ensures data/db.json + default admin exist before serving traffic

  const app = express();

  app.locals.md = renderMd;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'hiring-test-dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8h admin session
    })
  );
  app.use(flash());
  app.use((req, res, next) => {
    res.locals.flash = req.flash();
    next();
  });

  app.get('/', (req, res) => res.redirect('/admin'));

  app.use('/admin', adminRouter);
  app.use('/test', candidateRouter);

  app.use((req, res) => {
    res.status(404).render('candidate/error', {
      heading: 'Not found',
      message: 'That page does not exist.',
    });
  });

  const HOST = process.env.HOST || '0.0.0.0'; // bind all interfaces so the LAN can reach it, not just localhost

  app.listen(PORT, HOST, () => {
    console.log(`Simulasi Test app listening on http://localhost:${PORT}`);
    console.log(`  LAN:   http://10.4.154.100:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
  });
}

main();
