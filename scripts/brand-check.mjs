#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const forbiddenBrands = [
  ['hyphenated_slug', /wealth-growth-tracker/i],
  ['hyphenated_title', /Wealth-Growth-Tracker/i],
  ['spaced_title', /Wealth Growth Tracker/i],
  ['retired_chinese_brand', /财富成长记/],
  ['retired_chinese_product', /财富梦想实现家/],
  ['secondary_product', /WealthGrowthPlanner/],
];

const legacyLine = /legacy|旧版|历史|兼容|保留|退役|DO NOT|compatibility/i;
const allowedCompatibilityFiles = new Set([
  '.gitignore',
  'CHANGELOG.md',
  'CLEANUP_AUDIT.md',
  'V1.3_TECH_AUDIT.md',
  'docs/BRANDING.md',
  'public/sw.js',
  'scripts/privacy-check.mjs',
  'scripts/privacy-history-check.mjs',
  'scripts/privacy-check.test.mjs',
  'scripts/privacy-history-check.test.mjs',
  'scripts/test-local-cache.ps1',
  'src/constants/brand.ts',
  'src/services/storage/indexedDb.ts',
  'src/services/export/fullBackup.ts',
  'src/services/monthlyPlanning/attachmentArchive.ts',
  'src-tauri/src/ai.rs',
  'src-tauri/windows/installer-hooks.nsh',
]);
const textFile = /\.(?:md|txt|html|json|webmanifest|ts|tsx|js|mjs|cjs|css|ya?ml|toml|rs|nsh|ps1|svg)$/i;

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function checkBrand(cwd = process.cwd()) {
  const violations = [];
  const packageJson = readJson(join(cwd, 'package.json'));
  const runtimeJson = readJson(join(cwd, 'ai-runtime', 'package.json'));
  const tauri = readJson(join(cwd, 'src-tauri', 'tauri.conf.json'));
  const cargo = readFileSync(join(cwd, 'src-tauri', 'Cargo.toml'), 'utf8');
  const brandSource = readFileSync(join(cwd, 'src', 'constants', 'brand.ts'), 'utf8');

  if (packageJson.name !== 'wealthgrowthtracker') violations.push('package.json name 不是 wealthgrowthtracker');
  if (runtimeJson.name !== 'wealthgrowthtrackerairuntime') violations.push('AI Runtime package name 不正确');
  if (!/^name\s*=\s*"wealthgrowthtracker"/m.test(cargo)) violations.push('Cargo package name 不正确');
  if (!/^name\s*=\s*"wealthgrowthtracker_lib"/m.test(cargo)) violations.push('Cargo library name 不正确');
  if (tauri.productName !== 'WealthGrowthTracker') violations.push('Tauri productName 不正确');
  if (tauri.mainBinaryName !== 'WealthGrowthTracker') violations.push('Tauri mainBinaryName 不正确');
  if (tauri.identifier !== 'com.yuhuangshandian.wealthgrowthtracker') violations.push('Tauri identifier 被意外修改');
  if (/APP_BRAND_ZH/.test(brandSource)) violations.push('APP_BRAND_ZH 仍存在');
  if (!/return APP_BRAND;/.test(brandSource)) violations.push('brandTitle() 未直接返回 WealthGrowthTracker');

  const tracked = git(cwd, 'ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean);
  if (!tracked.length) violations.push('Git index 为空，无法完成品牌审计');
  for (const path of tracked) {
    if (path === 'scripts/brand-check.mjs' || !textFile.test(path)) continue;
    const isCompatibilityFile = allowedCompatibilityFiles.has(path) || path.startsWith('tests/');
    let content;
    try {
      content = readFileSync(join(cwd, path), 'utf8');
    } catch {
      continue;
    }
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
      if (isCompatibilityFile || legacyLine.test(line)) continue;
      for (const [category, pattern] of forbiddenBrands) {
        if (pattern.test(line)) {
          violations.push(`${path}:${lineIndex + 1} ${category}`);
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const violations = checkBrand();
    if (violations.length) {
      console.error(violations.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('品牌检查通过：当前品牌与兼容白名单一致。');
    }
  } catch (error) {
    console.error(`品牌检查无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
