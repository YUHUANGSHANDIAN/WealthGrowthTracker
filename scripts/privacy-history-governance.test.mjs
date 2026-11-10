import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyHistoryFindings,
  createHistoryBaseline,
  parseHistoryBaseline,
  scanHistory,
} from './privacy-history-governance.mjs';

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'wealth-history-governance-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init');
  git('config', 'user.email', 'privacy-test@example.invalid');
  git('config', 'user.name', 'Privacy Test');
  return { cwd, git };
}

function commit(repo, content) {
  writeFileSync(join(repo.cwd, 'notes.md'), content);
  repo.git('add', '--', 'notes.md');
  repo.git('commit', '-m', 'synthetic history fixture');
}

test('exact fingerprints accept only the audited commit and reject reused content', () => {
  const repo = repository();
  commit(repo, String.raw`path=D:\Desktop\synthetic\repo`);
  const first = scanHistory(repo.cwd);
  const baseline = parseHistoryBaseline(createHistoryBaseline(first));
  assert.deepEqual(classifyHistoryFindings(first, baseline).unexpected, []);
  repo.git('commit', '--allow-empty', '-m', 'new commit reuses audited content');
  const afterNewCommit = scanHistory(repo.cwd);
  const classified = classifyHistoryFindings(afterNewCommit, baseline);
  assert.ok(classified.known.length >= 1);
  assert.ok(classified.unexpected.some((finding) => finding.category === 'personal_absolute_path'));
});

test('baseline has no raw paths and tampering fails closed', () => {
  const repo = repository();
  commit(repo, String.raw`path=D:\Desktop\synthetic\repo`);
  const baseline = createHistoryBaseline(scanHistory(repo.cwd));
  assert.doesNotMatch(JSON.stringify(baseline), /Desktop|synthetic|repo/);
  const tampered = structuredClone(baseline);
  tampered.entries[0].fingerprint = '0'.repeat(64);
  assert.throws(() => parseHistoryBaseline(tampered), /摘要|重复|无效/);
});

test('credential material can never be accepted into the baseline', () => {
  const report = {
    commits: 1,
    findings: [{
      category: 'credential_material',
      ruleVersion: 1,
      commit: 'a'.repeat(40),
      blob: 'b'.repeat(40),
      path: 'synthetic.txt',
      contentGroup: 'c'.repeat(64),
      fingerprint: 'd'.repeat(64),
    }],
  };
  assert.throws(() => createHistoryBaseline(report), /凭据/);
});
