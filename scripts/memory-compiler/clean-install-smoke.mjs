#!/usr/bin/env node
import { execFileSync } from 'child_process';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const target = path.join(root, 'scripts', 'memory-compiler', 'plugin-only-acceptance.mjs');
const out = execFileSync('node', [target], { cwd: root, encoding: 'utf8' });
process.stdout.write(out);
