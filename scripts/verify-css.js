// Catches the exact silent-no-op bug CLAUDE.md warns about (found twice
// already, see git history for public/style.css after 2f2d319): a Tailwind
// class gets added to public/**/*.html or a hub's own script but `npm run
// build:css` never gets re-run, so public/style.css keeps serving the old
// compiled output with zero console or visual signal that anything is
// missing. Rebuilds to a scratch file with the real tailwindcss binary
// (never hand-parses classes) and diffs it against the committed
// public/style.css; a real difference means the committed file is stale.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const COMMITTED = path.join(ROOT, 'public', 'style.css');
const scratch = path.join(os.tmpdir(), `style.check.${process.pid}.css`);

try {
  execFileSync('npx', ['tailwindcss', '-i', './src/input.css', '-o', scratch, '--minify'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  const committed = fs.readFileSync(COMMITTED, 'utf8');
  const fresh = fs.readFileSync(scratch, 'utf8');
  if (committed !== fresh) {
    console.error('public/style.css is stale: a class was added or removed somewhere in public/**/*.html or a hub script since the last `npm run build:css`.');
    console.error('Run `npm run build:css` and commit the result.');
    process.exit(1);
  }
  console.log('public/style.css matches a fresh build.');
} finally {
  fs.rmSync(scratch, { force: true });
}
