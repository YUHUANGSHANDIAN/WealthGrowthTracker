#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const accepted = [
  /^MIT$/i,
  /^MIT-0$/i,
  /^ISC$/i,
  /^0BSD$/i,
  /^BSD-[23]-Clause$/i,
  /^Apache-2\.0$/i,
  /^BlueOak-1\.0\.0$/i,
  /^CC0-1\.0$/i,
  /^CC-BY-4\.0$/i,
  /^Unlicense$/i,
  /^MPL-2\.0$/i,
  /^Python-2\.0$/i,
];

function lockPackages(path) {
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  return Object.entries(lock.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath && metadata && !metadata.link)
    .map(([packagePath, metadata]) => ({
      path: packagePath,
      license: typeof metadata.license === 'string' ? metadata.license : '',
    }));
}

export function checkLicenses(cwd = process.cwd()) {
  const packages = [
    ...lockPackages(join(cwd, 'package-lock.json')),
    ...lockPackages(join(cwd, 'ai-runtime', 'package-lock.json')),
  ];
  const violations = [];
  for (const item of packages) {
    const alternatives = item.license
      .replace(/[()]/g, '')
      .split(/\s+(?:OR|AND)\s+|\//i)
      .map((license) => license.trim());
    if (!alternatives.length || !alternatives.every((license) => accepted.some((pattern) => pattern.test(license)))) {
      violations.push(`${item.path}: ${item.license || 'missing license metadata'}`);
    }
  }
  return { packageCount: packages.length, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkLicenses();
    if (result.violations.length) {
      console.error(result.violations.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`许可证检查通过：${result.packageCount} 个锁定包。`);
    }
  } catch (error) {
    console.error(`许可证检查无法完成，已阻止通过：${error.message}`);
    process.exitCode = 1;
  }
}
