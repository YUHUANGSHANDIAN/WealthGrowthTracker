import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_VERSION } from '../src/constants/version';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, p), 'utf-8')) as Record<string, unknown>;
}

describe('版本单一事实来源', () => {
  it('所有声明版本一致', () => {
    const pkg = readJson('package.json') as { version: string };
    const conf = readJson('src-tauri/tauri.conf.json') as { version: string };
    const cargo = readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf-8');
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];

    expect(APP_VERSION).toBe('1.3.0');
    expect(pkg.version).toBe(APP_VERSION);
    expect(conf.version).toBe(APP_VERSION);
    expect(cargoVersion).toBe(APP_VERSION);
  });
});
