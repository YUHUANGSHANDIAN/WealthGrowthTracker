#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const accepted = [
  /^MIT$/i,
  /^MIT-0$/i,
  /^Apache-2\.0$/i,
  /^BSD-[23]-Clause$/i,
  /^ISC$/i,
  /^0BSD$/i,
  /^Zlib$/i,
  /^Unlicense$/i,
  /^CC0-1\.0$/i,
  /^LGPL-2\.1-or-later$/i,
  /^Unicode-3\.0$/i,
  /^BSL-1\.0$/i,
  /^MPL-2\.0$/i,
];

function expressions(value) {
  return value
    .replace(/\s+WITH\s+[A-Za-z0-9.-]+/ig, '')
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+|\//i)
    .map((license) => license.trim())
    .filter(Boolean);
}

export function checkCargoLicenses(cwd = process.cwd()) {
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata',
    '--format-version', '1',
    '--locked',
    '--manifest-path', 'src-tauri/Cargo.toml',
  ], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  const workspaceIds = new Set(metadata.workspace_members);
  const violations = [];
  const packages = metadata.packages.filter((item) => !workspaceIds.has(item.id));
  for (const item of packages) {
    if (!item.license) {
      if (!item.license_file) violations.push(`${item.name} ${item.version}: missing license metadata`);
      continue;
    }
    const licenses = expressions(item.license);
    if (!licenses.length || !licenses.every((license) => accepted.some((pattern) => pattern.test(license)))) {
      violations.push(`${item.name} ${item.version}: ${item.license}`);
    }
  }
  return { packageCount: packages.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkCargoLicenses();
    if (result.violations.length) {
      console.error(result.violations.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`Cargo 许可证检查通过：${result.packageCount} 个依赖。`);
    }
  } catch (error) {
    console.error(`Cargo 许可证检查无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
