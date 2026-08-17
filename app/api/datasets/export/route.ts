import { NextResponse } from 'next/server';

import {
  EXPORT_MIME,
  manifestFilename,
  serialiseManifest,
  type ExportFormat,
} from '@/lib/pipeline/export';
import { getDataset } from '@/lib/server/catalog';
import { getManifestFor, normaliseBuildRequest, runBuild } from '@/lib/server/datasets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS: ExportFormat[] = ['json', 'jsonl', 'csv'];

function parseFormat(value: string | null): ExportFormat {
  return FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : 'json';
}

function fileResponse(body: string, filename: string, format: ExportFormat) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': `${EXPORT_MIME[format]}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GET /api/datasets/export?version=hospital-navigation-v0.3&format=jsonl
 *
 * Exports a committed dataset version. The manifest is rebuilt from the version's
 * member list rather than stored, so it can never drift from the episodes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const versionName = url.searchParams.get('version');
  const format = parseFormat(url.searchParams.get('format'));

  if (!versionName) {
    return NextResponse.json({ error: 'Missing "version" parameter.' }, { status: 400 });
  }

  const version = getDataset(versionName);
  if (!version) {
    return NextResponse.json({ error: `Unknown dataset version "${versionName}".` }, { status: 404 });
  }

  const manifest = getManifestFor(version);
  return fileResponse(
    serialiseManifest(format, version, manifest),
    manifestFilename(version, format),
    format,
  );
}

/**
 * POST /api/datasets/export
 *
 * Exports a version built on the fly from a policy — the download path for a
 * dataset a visitor just built in the console.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const format = parseFormat(
    typeof (body as { format?: unknown })?.format === 'string'
      ? (body as { format: string }).format
      : null,
  );

  try {
    const result = runBuild(normaliseBuildRequest(body));
    return fileResponse(
      serialiseManifest(format, result.version, result.manifest),
      manifestFilename(result.version, format),
      format,
    );
  } catch (error) {
    console.error('dataset export failed', error);
    return NextResponse.json({ error: 'Failed to export dataset.' }, { status: 500 });
  }
}
