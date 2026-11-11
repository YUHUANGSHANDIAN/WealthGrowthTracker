#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createHistoryBaseline,
  scanHistory,
} from './privacy-history-governance.mjs';

const output = resolve(process.argv[2] ?? 'scripts/privacy-history-baseline.json');
const report = scanHistory();
const baseline = createHistoryBaseline(report);
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(`历史风险基线已记录 ${baseline.acceptedFindingCount} 个精确指纹、${baseline.acceptedContentGroupCount} 个内容组。`);
