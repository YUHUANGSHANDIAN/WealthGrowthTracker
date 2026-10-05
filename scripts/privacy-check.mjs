#!/usr/bin/env node
/**
 * Privacy Guard（v1.5）—— 发布前隐私检查。
 *
 * 确保以下「用户真实数据」绝不进入 Git 仓库：
 *  - app-state.json / wealth-backup_*.json（应用主数据与备份）
 *  - 用户 *.xlsx（旧彩票 Excel）
 *  - 历史财务报告/ 目录（用户历史报告）
 *  - private-data/ / local-imports/ / migration-backups/（私人数据目录）
 *  - 源码中的真实银行卡尾号 / 真实项目名等敏感内容模式
 *
 * 基于「路径 / 文件名 / 数据目录」判断，不粗暴禁止所有 json / png。
 * 用法：npm run privacy:check
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const FORBIDDEN_PATH = [
  /(^|\/)历史财务报告(\/|$)/,
  /(^|\/)private-data(\/|$)/,
  /(^|\/)local-imports(\/|$)/,
  /(^|\/)migration-backups(\/|$)/,
  /(^|\/)legacy-reports?(\/|$)/,
  /(^|\/)legacy-lottery(\/|$)/,
  /(^|\/)app-state\.json$/,
  /(^|\/)wealth-backup[^/]*\.json$/,
  /\.xlsx$/i,
  /\.xls$/i,
];

// 源码内不应出现的敏感内容模式（真实银行尾号、真实世界杯项目名等）
const FORBIDDEN_CONTENT = [
  /浦发银行\s*\(\d{4}\)/,
  /FIFA20\d{2}/,
  /卡塔尔世界杯/,
  /美加墨世界杯/,
];

function git(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const violations = [];
const warnings = [];

const tracked = git('git ls-files');
const staged = git('git diff --cached --name-only');

for (const f of new Set([...tracked, ...staged])) {
  for (const re of FORBIDDEN_PATH) {
    if (re.test(f)) violations.push(`[tracked/staged] 禁止文件进入 Git：${f}（匹配 ${re}）`);
  }
}

// 内容检查（仅文本文件）
const TEXT_RE = /\.(ts|tsx|js|mjs|cjs|json|md|txt|html|css|yml|yaml|toml)$/;
for (const f of tracked) {
  if (!TEXT_RE.test(f)) continue;
  try {
    const content = readFileSync(f, 'utf8');
    for (const re of FORBIDDEN_CONTENT) {
      if (re.test(content)) violations.push(`[content] ${f} 命中敏感模式 ${re}`);
    }
  } catch {
    /* ignore unreadable */
  }
}

// 工作区内存在但未跟踪的敏感目录（仅警告，因其不会被提交）
const ROOT_SENSITIVE_DIRS = ['历史财务报告', 'private-data', 'local-imports', 'migration-backups'];
for (const d of ROOT_SENSITIVE_DIRS) {
  if (existsSync(d) && statSync(d).isDirectory()) {
    warnings.push(`工作区存在敏感目录（已按未跟踪处理，切勿 git add）：${d}/`);
  }
}

if (warnings.length > 0) {
  console.warn('⚠️  Privacy warnings:');
  for (const w of warnings) console.warn('  - ' + w);
}

if (violations.length > 0) {
  console.error('❌ Privacy check FAILED：发现用户数据 / 备份 / Excel / 历史报告可能进入 Git：');
  for (const v of violations) console.error('  - ' + v);
  process.exit(1);
}

console.log('✅ Privacy check passed：未发现用户数据 / 备份 / Excel / 历史报告进入 Git。');
