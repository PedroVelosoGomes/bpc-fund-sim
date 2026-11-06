import { parseBenchmarkCsv, parseBenchmarkJson, type BenchmarkPack } from '../../engine';
import sampleCsv from '../../benchmarks/sample-benchmark-pack.csv?raw';

export const SAMPLE_PACK_CSV = sampleCsv;

const id = () => `bp-${Math.random().toString(36).slice(2, 8)}`;

export function parsePackText(text: string, name: string, percentileBacked: boolean): BenchmarkPack {
  const meta = { id: id(), name, importedAt: new Date().toISOString(), percentileBacked };
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[') ? parseBenchmarkJson(text, meta) : parseBenchmarkCsv(text, meta);
}

export function samplePack(): BenchmarkPack {
  return parsePackText(SAMPLE_PACK_CSV, 'Illustrative sample pack', false);
}
