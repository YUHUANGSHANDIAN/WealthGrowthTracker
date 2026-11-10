#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RULE_VERSION = 1;
const BASELINE_SCHEMA_VERSION = 1;
const DEFAULT_BASELINE_PATH = 'scripts/privacy-history-baseline.json';
const ACCEPTED_CATEGORIES = new Set([
  'personal_absolute_path',
  'personal_workspace_path',
  'personal_user_home',
  'historical_financial_fixture',
  'private_financial_workbook_reference',
]);
const excludedPaths = new Set([
  'scripts/privacy-check.mjs',
  'scripts/privacy-history-check.mjs',
  'scripts/privacy-history-governance.mjs',
  'scripts/privacy-check.test.mjs',
  'scripts/privacy-history-check.test.mjs',
  'scripts/privacy-history-governance.test.mjs',
  'scripts/create-privacy-history-baseline.mjs',
  'scripts/privacy-history-baseline.json',
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

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function findingFingerprint({ commit, blob, path, category, ruleVersion }) {
  return digest(['privacy-history-v1', commit, blob, path.replaceAll('\\', '/'), category, ruleVersion].join('\0'));
}

function contentGroup(blob) {
  return digest(`privacy-history-content-v1\0${blob}`);
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
        if (excludedPaths.has(path)) continue;
        const blob = path === '(unknown)' ? digest('unknown') : git(cwd, 'rev-parse', `${commit}:${path}`).trim();
        if (!/^[a-f0-9]{40,64}$/.test(blob)) throw new Error(`无法解析历史 blob：${path}`);
        const finding = {
          category: rule.category,
          ruleVersion: RULE_VERSION,
          commit,
          blob,
          path,
          contentGroup: contentGroup(blob),
        };
        findings.push({ ...finding, fingerprint: findingFingerprint(finding) });
      }
    }
  }
  return { commits: commits.length, findings };
}

function baselineDigest(entries) {
  const canonical = entries
    .map((entry) => [entry.fingerprint, entry.category, entry.contentGroup].join(':'))
    .sort()
    .join('\n');
  return digest(`privacy-history-baseline-v1\n${canonical}`);
}

export function createHistoryBaseline(report) {
  if (report.findings.some((finding) => finding.category === 'credential_material')) {
    throw new Error('历史审计包含凭据材料，绝不能写入已接受风险基线');
  }
  const entries = report.findings.map((finding) => ({
    fingerprint: finding.fingerprint,
    category: finding.category,
    contentGroup: finding.contentGroup,
  })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const uniqueFingerprints = new Set(entries.map((entry) => entry.fingerprint));
  if (uniqueFingerprints.size !== entries.length) throw new Error('历史风险基线指纹重复');
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    generatedFromCommitCount: report.commits,
    acceptedFindingCount: entries.length,
    acceptedContentGroupCount: new Set(entries.map((entry) => entry.contentGroup)).size,
    digest: baselineDigest(entries),
    entries,
  };
}

export function parseHistoryBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== BASELINE_SCHEMA_VERSION
    || !Array.isArray(value.entries)
    || value.acceptedFindingCount !== value.entries.length) {
    throw new Error('历史风险基线结构无效');
  }
  const entries = value.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !/^[a-f0-9]{64}$/.test(String(entry.fingerprint))
      || !/^[a-f0-9]{64}$/.test(String(entry.contentGroup))
      || !ACCEPTED_CATEGORIES.has(entry.category)) {
      throw new Error('历史风险基线条目无效');
    }
    return {
      fingerprint: String(entry.fingerprint),
      category: String(entry.category),
      contentGroup: String(entry.contentGroup),
    };
  });
  if (new Set(entries.map((entry) => entry.fingerprint)).size !== entries.length) throw new Error('历史风险基线指纹重复');
  if (value.digest !== baselineDigest(entries)) throw new Error('历史风险基线摘要不匹配，可能已被篡改');
  if (value.acceptedContentGroupCount !== new Set(entries.map((entry) => entry.contentGroup)).size) {
    throw new Error('历史风险基线内容组统计不一致');
  }
  return { ...value, entries };
}

export function classifyHistoryFindings(report, baseline) {
  const accepted = new Map(baseline.entries.map((entry) => [entry.fingerprint, entry]));
  const known = [];
  const unexpected = [];
  for (const finding of report.findings) {
    const match = accepted.get(finding.fingerprint);
    if (match && match.category === finding.category && match.contentGroup === finding.contentGroup
      && ACCEPTED_CATEGORIES.has(finding.category)) known.push(finding);
    else unexpected.push(finding);
  }
  return { known, unexpected };
}

export function loadHistoryBaseline(cwd = process.cwd(), baselinePath = DEFAULT_BASELINE_PATH) {
  const absolute = resolve(cwd, baselinePath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取历史风险基线：${relative(cwd, absolute)}（${error.code ?? 'parse-error'}）`);
  }
  return parseHistoryBaseline(parsed);
}

function redactedLocation(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length <= 2 ? normalized : `…/${parts.slice(-2).join('/')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = scanHistory();
    const baseline = loadHistoryBaseline();
    const classified = classifyHistoryFindings(report, baseline);
    const outputIndex = process.argv.indexOf('--output');
    const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
    const sanitized = {
      generatedAt: new Date().toISOString(),
      commitsScanned: report.commits,
      knownAccepted: {
        count: classified.known.length,
        contentGroups: [...new Set(classified.known.map((finding) => finding.contentGroup))].sort(),
        categories: [...new Set(classified.known.map((finding) => finding.category))].sort(),
      },
      unexpected: classified.unexpected.map((finding) => ({
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
    }
    if (classified.unexpected.length) {
      for (const finding of classified.unexpected) {
        console.error(`[BLOCKED] ${finding.category} ${finding.commit.slice(0, 12)} ${redactedLocation(finding.path)}`);
      }
      console.error(`历史审计发现 ${classified.unexpected.length} 个新增或未接受的敏感项；已阻止通过。`);
      process.exitCode = 1;
    } else {
      console.log(`历史审计通过：${classified.known.length} 个精确既有指纹属于本人已知残余风险；未发现新增命中。`);
    }
  } catch (error) {
    console.error(`历史审计无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
