import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
test('CLI fails closed in a directory without Git instead of printing a pass',()=>{
  // 回归：ZIP 解压出的无 .git 目录里运行隐私检查时，旧实现会输出"检查通过"，
  // 发布门禁因此形同虚设。这里直接验证 CLI 的退出码与输出。
  const cwd=mkdtempSync(join(tmpdir(),'wealth-privacy-nogit-'));
  const script=fileURLToPath(new URL('./privacy-check.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});
  assert.notEqual(result.status,0,'非 Git 目录必须返回非零退出码');
  assert.match(result.stderr,/无法完成|已阻止通过/);
  assert.doesNotMatch(result.stdout??'',/检查通过/);
});
test('CLI rejects an initialized repository with an empty index',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'wealth-privacy-empty-cli-'));
  execFileSync('git',['init'],{cwd,stdio:'ignore'});
  const script=fileURLToPath(new URL('./privacy-check.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});
  assert.notEqual(result.status,0,'空索引必须返回非零退出码');
  assert.match(result.stderr,/为空|无法完成|已阻止通过/);
});
