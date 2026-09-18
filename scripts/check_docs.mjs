/* global console */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const DECISIONS_DIR = path.join(DOCS_DIR, 'decisions');

const errors = [];

// 1. Check ADR naming convention
if (fs.existsSync(DECISIONS_DIR)) {
  const adrFiles = fs.readdirSync(DECISIONS_DIR);
  for (const file of adrFiles) {
    if (!file.endsWith('.md')) continue;
    if (!/^\d{4}-[a-zA-Z0-9_-]+\.md$/.test(file)) {
      errors.push(`[ADR Naming] ${path.join('docs/decisions', file)} must match pattern: NNNN-slug.md`);
    }
  }
}

// Helper to get all markdown files recursively
function getMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === '.codegraph' || file === 'graphify-out') continue;
      results = results.concat(getMarkdownFiles(filePath));
    } else if (file.endsWith('.md')) {
      results.push(filePath);
    }
  }
  return results;
}

// 2. Validate Metadata in living docs
const livingDocs = fs
  .readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join(DOCS_DIR, f));

for (const filePath of livingDocs) {
  const relPath = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const headLines = content.split('\n').slice(0, 15).join('\n');

  if (!content.startsWith('# ')) {
    errors.push(`[Metadata] ${relPath} is missing a level 1 heading (# Title) on the first line.`);
  }
  if (!/更新日期[：:]|Updated[：:]/i.test(headLines)) {
    errors.push(`[Metadata] ${relPath} is missing '更新日期：' or 'Updated:' in header.`);
  }
  if (!/状态[：:]|Status[：:]/i.test(headLines)) {
    errors.push(`[Metadata] ${relPath} is missing '状态：' or 'Status:' in header.`);
  }
  if (!/适用范围[：:]|Scope[：:]/i.test(headLines)) {
    errors.push(`[Metadata] ${relPath} is missing '适用范围：' or 'Scope:' in header.`);
  }
}

// 3. Validate INDEX.md coverage
const indexPath = path.join(DOCS_DIR, 'INDEX.md');
if (fs.existsSync(indexPath)) {
  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  const allDocs = getMarkdownFiles(DOCS_DIR);

  for (const doc of allDocs) {
    const relFromDocs = path.relative(DOCS_DIR, doc);
    // Ignore INDEX.md itself
    if (relFromDocs === 'INDEX.md') continue;

    // Check if relative path or filename is referenced in INDEX.md
    const filename = path.basename(doc);
    if (!indexContent.includes(relFromDocs) && !indexContent.includes(filename)) {
      errors.push(`[Index Coverage] Document ${path.relative(ROOT, doc)} is not linked in docs/INDEX.md`);
    }
  }
} else {
  errors.push(`[Index Missing] docs/INDEX.md does not exist.`);
}

// 4. Validate Relative Links in markdown files
const docsAndRoot = [...getMarkdownFiles(DOCS_DIR), path.join(ROOT, 'README.md'), path.join(ROOT, 'AGENTS.md')].filter(
  (p) => fs.existsSync(p),
);

const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const filePath of docsAndRoot) {
  const relPath = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  let match;

  while ((match = LINK_REGEX.exec(content)) !== null) {
    const rawTarget = match[2].trim();
    if (
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:') ||
      rawTarget.startsWith('#') ||
      rawTarget.startsWith('tel:')
    ) {
      continue;
    }

    // Strip anchor #...
    const cleanTarget = rawTarget.split('#')[0];
    if (!cleanTarget) continue; // Pure anchor inside same document

    const resolvedTarget = path.resolve(path.dirname(filePath), cleanTarget);
    if (!fs.existsSync(resolvedTarget)) {
      errors.push(
        `[Broken Link] In ${relPath}: link target "${rawTarget}" does not exist (resolved to: ${path.relative(ROOT, resolvedTarget)})`,
      );
    }
  }
}

// Output results
console.log('--- Lens Documentation Governance Check ---');
if (errors.length > 0) {
  console.error(`\n❌ Found ${errors.length} error(s):`);
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log('✅ All documentation checks passed: metadata, index coverage, ADR rules, and links valid.');
  process.exit(0);
}
