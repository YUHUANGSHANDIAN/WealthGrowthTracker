#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const forbiddenPaths = [
  /(^|\/)(历史财务报告|private-data|local-imports|migration-backups|legacy-reports?|legacy-lottery)(\/|$)/,
  /(^|\/)app-state\.json(?:\.|$)/,
  /(^|\/)wealth-backup[^/]*\.json$/,
  /\.(xlsx|xls)$/i,
];
const forbiddenContents = [
  /浦发银行\s*\(\d{4}\)/, /FIFA20\d{2}/, /卡塔尔世界杯/, /美加墨世界杯/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}\b/,
  /https?:\/\/[^\s"'<>]+[?&](?:access_token|refresh_token|id_token|code)=[^\s"'&<>]+/i,
];
const textPath = /\.(ts|tsx|js|mjs|cjs|json|md|txt|html|css|yml|yaml|toml|rs|svg)$/i;

export function parseIndexRecords(output) {
  return output.split('\0').filter(Boolean).map(record => {
    const match = /^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('无法解析 Git index');
    const [, mode, oid, stage, path] = match;
    if (stage !== '0') throw new Error('Git index 存在未解决冲突');
    if (mode === '120000' || mode === '160000') throw new Error(`无法审核链接或子模块：${JSON.stringify(path)}`);
    return { mode, oid, path };
  });
}

/** Inspect both the actual index blobs and the current working files. Git errors fail closed. */
export function checkPrivacy(cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const records = parseIndexRecords(git('ls-files', '--stage', '-z'));
  if (!records.length) throw new Error('Git index 为空，无法确认审核目标');
  const violations = [];
  for (const { oid, path } of records) {
    if (forbiddenPaths.some((re) => re.test(path))) violations.push(`禁止路径：${JSON.stringify(path)}`);
    if (!textPath.test(path) || path === 'scripts/privacy-check.mjs') continue;
    const staged = git('cat-file', 'blob', oid);
    let working;
    try { working = readFileSync(resolve(cwd, path), 'utf8'); }
    catch (error) {
      // A tracked file missing from disk is still audited from its index blob.
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [label, content] of [['index', staged], ['working', working]]) {
      if (content !== undefined && forbiddenContents.some((re) => re.test(content))) {
        violations.push(`${label} 敏感内容：${JSON.stringify(path)}`);
      }
    }
  }
  // New source and documentation must be reviewed before they enter the index, too.
  for (const path of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
    if (forbiddenPaths.some((re) => re.test(path))) violations.push(`禁止路径：${JSON.stringify(path)}`);
    if (textPath.test(path) && path !== 'scripts/privacy-check.mjs') {
      const content = readFileSync(resolve(cwd, path), 'utf8');
      if (forbiddenContents.some((re) => re.test(content))) violations.push(`untracked 敏感内容：${JSON.stringify(path)}`);
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const violations = checkPrivacy();
    if (violations.length) {
      console.error(violations.join('\n'));
      process.exitCode = 1;
    } else console.log('隐私检查通过：已审核 Git index blob 和工作区文本。');
  } catch (error) {
    console.error(`隐私检查无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
