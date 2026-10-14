import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/constants/version';
import pkg from '../package.json';
import tauriConf from '../src-tauri/tauri.conf.json';
import cargoRaw from '../src-tauri/Cargo.toml?raw';

describe('版本单一事实来源', () => {
  it('所有声明版本一致', () => {
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoRaw)?.[1];
    expect(APP_VERSION).toBe('1.7.0');
    expect(pkg.version).toBe(APP_VERSION);
    expect((tauriConf as { version: string }).version).toBe(APP_VERSION);
    expect(cargoVersion).toBe(APP_VERSION);
  });
});
