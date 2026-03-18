'use strict';
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const srcDir = path.join(cwd, 'db', 'migrations');
const destDir = path.join(cwd, 'dist', 'db', 'migrations');

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-migrations] Source dir not found:', srcDir);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.sql'))) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
}
const pgSrc = path.join(srcDir, 'pg');
const pgDest = path.join(destDir, 'pg');
if (fs.existsSync(pgSrc)) {
  fs.mkdirSync(pgDest, { recursive: true });
  for (const f of fs.readdirSync(pgSrc).filter((x) => x.endsWith('.sql'))) {
    fs.copyFileSync(path.join(pgSrc, f), path.join(pgDest, f));
  }
}
console.log('[copy-migrations] OK');
