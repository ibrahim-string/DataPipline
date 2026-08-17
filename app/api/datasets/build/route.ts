import { NextResponse } from 'next/server';

import { normaliseBuildRequest, runBuild } from '@/lib/server/datasets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Preview cap — the full manifest is available from the export endpoint. */
const PREVIEW_LIMIT = 25;

/**
 * POST /api/datasets/build
 *
 * Applies a build policy to the episode catalog and returns the resulting
 * version: which episodes got in, which did not, and why. Pure and deterministic
 * — the same body always yields the same version.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  try {
    const buildRequest = normaliseBuildRequest(body);
    const result = runBuild(buildRequest);

    return NextResponse.json({
      version: result.version,
      manifest_preview: result.manifest.slice(0, PREVIEW_LIMIT),
      manifest_total: result.manifest.length,
      excluded_preview: result.excluded.slice(0, PREVIEW_LIMIT),
      excluded_total: result.excluded.length,
    });
  } catch (error) {
    console.error('dataset build failed', error);
    return NextResponse.json({ error: 'Failed to build dataset.' }, { status: 500 });
  }
}
