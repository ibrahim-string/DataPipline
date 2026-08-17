import type { DatasetVersion, ManifestEntry } from './dataset';

/**
 * Manifest serialisation.
 *
 * Three formats because three consumers exist in practice: a JSON envelope for
 * humans and APIs, JSONL for training-time streaming readers (one episode per
 * line, seekable, appendable), and CSV for whoever wants it in a spreadsheet.
 * In production the same manifest would point at Parquet/MCAP shards in object
 * storage instead of being the payload itself.
 */

export type ExportFormat = 'json' | 'jsonl' | 'csv';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  csv: 'text/csv',
};

export function toJson(version: DatasetVersion, manifest: ManifestEntry[]): string {
  return JSON.stringify(
    {
      dataset_version: version.full_name,
      created_at: version.created_at,
      parent_version: version.parent,
      generator: 'omakase-ela-lab (independent POC, synthetic data)',
      policy: version.policy,
      statistics: version.stats,
      episodes: manifest,
    },
    null,
    2,
  );
}

export function toJsonl(manifest: ManifestEntry[]): string {
  return manifest.map((entry) => JSON.stringify(entry)).join('\n');
}

const CSV_COLUMNS = [
  'dataset_version',
  'episode_id',
  'robot_id',
  'site',
  'task',
  'started_at',
  'duration_seconds',
  'sensors',
  'quality_score',
  'completeness_pct',
  'validity_pct',
  'sync_p95_ms',
  'event_count',
  'status',
] as const;

export function toCsv(manifest: ManifestEntry[]): string {
  const rows = manifest.map((entry) =>
    CSV_COLUMNS.map((column) => {
      const value = entry[column];
      return escapeCsv(Array.isArray(value) ? value.join('|') : String(value));
    }).join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serialiseManifest(
  format: ExportFormat,
  version: DatasetVersion,
  manifest: ManifestEntry[],
): string {
  switch (format) {
    case 'jsonl':
      return toJsonl(manifest);
    case 'csv':
      return toCsv(manifest);
    case 'json':
    default:
      return toJson(version, manifest);
  }
}

export function manifestFilename(version: DatasetVersion, format: ExportFormat): string {
  return `${version.full_name}-manifest.${format}`;
}
