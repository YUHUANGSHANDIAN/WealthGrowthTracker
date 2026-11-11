#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const forbiddenName = [
  /^app-state\.json(?:\.|$)/i,
  /\.wgtbackup(?:\.zip)?$/i,
  /\.(?:xlsx|xls|docx|doc|pdf|zip|7z|rar|pem|pfx|p12|key|keystore|jks|env)$/i,
  /^(?:WealthData|private-data|local-imports|migration-backups)$/i,
];
const textExtensions = new Set([
  '.css', '.csv', '.html', '.js', '.json', '.map', '.md', '.mjs', '.svg', '.txt', '.webmanifest', '.xml',
]);
const contentRules = [
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['github_pat', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['provider_key', /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{32,}\b/],
  ['private_key', /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ['personal_path', /(?:D:\\AI-Workspace\\ChatGPT|D:\\Desktop\\[^\\\r\n]+\\|C:\\Users\\(?!(?:<用户名>|<username>|you\\|$|%USERNAME%|x\\|$))[A-Za-z0-9._-]+)/i],
  ['financial_workbook', /彩票[^\r\n]{0,40}收支[^\r\n]{0,40}\.xlsx/i],
];

export function checkArtifact(root) {
  const base = resolve(root);
  const violations = [];
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const absolute = join(current, name);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        violations.push(`${relative(base, absolute)}: symbolic link`);
        continue;
      }
      if (stats.isDirectory()) {
        if (forbiddenName.some((pattern) => pattern.test(name))) {
          violations.push(`${relative(base, absolute)}: forbidden directory`);
        } else {
          stack.push(absolute);
        }
        continue;
      }
      if (!stats.isFile()) continue;
      if (forbiddenName.some((pattern) => pattern.test(basename(name)))) {
        violations.push(`${relative(base, absolute)}: forbidden filename`);
        continue;
      }
      if (textExtensions.has(extname(name).toLowerCase()) && stats.size <= 2 * 1024 * 1024) {
        const content = readFileSync(absolute, 'utf8');
        for (const [category, pattern] of contentRules) {
          if (pattern.test(content)) violations.push(`${relative(base, absolute)}: ${category}`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const roots = process.argv.slice(2);
  if (!roots.length) {
    console.error('用法：node scripts/artifact-privacy-check.mjs <构建目录...>');
    process.exitCode = 2;
  } else {
    try {
      const violations = roots.flatMap(checkArtifact);
      if (violations.length) {
        console.error(violations.join('\n'));
        process.exitCode = 1;
      } else {
        console.log(`构建产物隐私检查通过：${roots.length} 个目录。`);
      }
    } catch (error) {
      console.error(`构建产物隐私检查无法完成，已阻止通过：${error.message}`);
      process.exitCode = 1;
    }
  }
}
