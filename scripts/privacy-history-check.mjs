#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const excludedPaths = new Set([
  'scripts/privacy-check.mjs',
  'scripts/privacy-history-check.mjs',
  'scripts/privacy-check.test.mjs',
  'scripts/privacy-history-check.test.mjs',
]);

export const HISTORY_RULES = [
  {
    category: 'personal_absolute_path',
    pattern: 'D:\\\\Desktop\\\\[^\\\\]+\\\\',
  },
  {
    category: 'personal_workspace_path',
    pattern: 'D:\\\\AI-Workspace\\\\ChatGPT',
  },
  {
    category: 'personal_user_home',
    pattern: 'C:\\\\Users\\\\[A-Za-z0-9._-]+',
  },
  {
    category: 'historical_financial_fixture',
    pattern: 'FIFA20[0-9]{2}[^\\n]{0,120}(世界杯|投注|支出|[0-9]{3,})|浦发银行[^\\n]{0,120}(投注|支出|已收款)',
  },
  {
    category: 'private_financial_workbook_reference',
    pattern: '彩票[^\\r\\n]{0,40}收支[^\\r\\n]{0,40}\\.xlsx',
  },
  {
    category: 'credential_material',
    pattern: 'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(proj-|ant-api[0-9]+-)?[A-Za-z0-9_-]{32,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}',
  },
];

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function scanHistory(cwd = process.cwd()) {
  const commits = git(cwd, 'rev-list', '--all').trim().split(/\s+/).filter(Boolean);
  if (!commits.length) throw new Error('Git 历史为空，无法完成历史审计');
  const findings = [];
  for (const rule of HISTORY_RULES) {
    for (const commit of commits) {
      let output;
      try {
        output = git(cwd, 'grep', '-I', '-l', '-E', rule.pattern, commit, '--', '.');
      } catch (error) {
        if (error.status === 1) continue;
        throw error;
      }
      for (const record of output.split(/\r?\n/).filter(Boolean)) {
        const separator = record.indexOf(':');
        const path = separator >= 0 ? record.slice(separator + 1) : '(unknown)';
        if (!excludedPaths.has(path)) {
          findings.push({ category: rule.category, commit, path });
        }
      }
    }
  }
  return { commits: commits.length, findings };
}

function redactedLocation(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length <= 2 ? normalized : `…/${parts.slice(-2).join('/')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = scanHistory();
    const outputIndex = process.argv.indexOf('--output');
    const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
    const sanitized = {
      generatedAt: new Date().toISOString(),
      commitsScanned: report.commits,
      blocked: report.findings.length > 0,
      findings: report.findings.map((finding) => ({
        category: finding.category,
        commit: finding.commit,
        location: redactedLocation(finding.path),
      })),
    };
    if (outputPath) {
      const absolute = resolve(outputPath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${JSON.stringify(sanitized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      console.error(`历史审计报告已写入私人路径：${absolute}`);
    } else {
      for (const finding of report.findings) {
        console.error(`[BLOCKED] ${finding.category} ${finding.commit.slice(0, 12)} ${redactedLocation(finding.path)}`);
      }
    }
    if (report.findings.length) {
      console.error(`历史审计发现 ${report.findings.length} 个阻断项，涉及 ${report.commits} 个提交；未输出敏感原文。`);
      process.exitCode = 1;
    } else {
      console.log(`历史审计通过：${report.commits} 个提交未命中当前规则。`);
    }
  } catch (error) {
    console.error(`历史审计无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
