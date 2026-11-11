import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanHistory } from './privacy-history-check.mjs';

function committedRepository(content) {
  const cwd = mkdtempSync(join(tmpdir(), 'wealth-history-privacy-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  git('config', 'user.email', 'privacy-test@example.invalid');
  git('config', 'user.name', 'Privacy Test');
  writeFileSync(join(cwd, 'notes.md'), content);
  git('add', '--', 'notes.md');
  git('commit', '-m', 'synthetic history fixture');
  return cwd;
}

test('historical path findings are reported without requiring scan self-exclusion', () => {
  const cwd = committedRepository(String.raw`path=D:\Desktop\synthetic\repo`);
  const report = scanHistory(cwd);
  assert.equal(report.commits, 1);
  assert.ok(report.findings.some((finding) => finding.category === 'personal_absolute_path'));
});

test('clean synthetic history passes', () => {
  const cwd = committedRepository('开发工作区路径只写入被忽略的本地配置。');
  assert.deepEqual(scanHistory(cwd).findings, []);
});
