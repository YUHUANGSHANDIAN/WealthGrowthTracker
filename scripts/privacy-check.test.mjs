import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPrivacy, parseIndexRecords } from './privacy-check.mjs';

// Synthetic temporary repositories are retained; no bulk cleanup is performed.
function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'wealth-privacy-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding:'utf8', stdio:['pipe','pipe','pipe'] });
  git('init');
  writeFileSync(join(cwd,'fixture.md'),'synthetic');
  git('add','--','fixture.md');
  return { cwd, git };
}
const syntheticToken = 'gh' + 'p_' + 'a'.repeat(36);

test('reads staged secrets even when working text was replaced',()=>{
  const {cwd,git}=repository();
  const path='中文 空格.md';
  writeFileSync(join(cwd,path),syntheticToken);
  git('add','--',path);
  writeFileSync(join(cwd,path),'safe replacement');
  assert.ok(checkPrivacy(cwd).some(v=>v.includes('index')&&v.includes(path)));
});
test('checks untracked text and forbidden paths',()=>{
  const {cwd}=repository();
  writeFileSync(join(cwd,'new.md'),syntheticToken);
  writeFileSync(join(cwd,'app-state.json'),'{}');
  assert.equal(checkPrivacy(cwd).length,2);
});
test('NUL index handles newline filenames without splitting records',()=>{
  // Windows forbids this filename, so verify the NUL parser with Git's record format.
  const name='合成\n换行.md';
  assert.deepEqual(parseIndexRecords(`100644 ${'a'.repeat(40)} 0\t${name}\0`).map(r=>r.path),[name]);
  assert.throws(()=>parseIndexRecords('invalid\0'));
  assert.throws(()=>parseIndexRecords(`100644 ${'a'.repeat(40)} 1\tconflict.md\0`),/冲突/);
});
test('Git failure and an empty index never pass',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'wealth-privacy-empty-'));
  assert.throws(()=>checkPrivacy(cwd));
  execFileSync('git',['init'],{cwd,stdio:'ignore'});
  assert.throws(()=>checkPrivacy(cwd),/为空/);
});
