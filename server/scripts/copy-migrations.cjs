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
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.sql'));
for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
}
console.log('[copy-migrations] Copied', files.length, 'file(s) to dist/db/migrations');
