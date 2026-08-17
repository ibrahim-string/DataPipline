import 'server-only';

import { DEFAULT_BUILD_POLICY, type BuildPolicy } from '@/lib/pipeline/config';
import {
  buildDataset,
  toCandidate,
  toManifestEntry,
  type BuildResult,
  type DatasetCandidate,
  type DatasetVersion,
  type ManifestEntry,
} from '@/lib/pipeline/dataset';
import type { Sensor } from '@/lib/pipeline/types';
import { getAllEpisodes, getDataset } from './catalog';

/**
 * Dataset building on the server.
 *
 * Deliberately stateless. A build is a pure function of (episodes, scope,
 * policy), and the episodes are a committed snapshot — so the same request
 * always produces the same version, and nothing has to be persisted between
 * requests. That matters on serverless, where a module-level cache would live on
 * one instance and vanish on the next.
 *
 * The cost of that choice is that a version a visitor builds is not added to the
 * registry. In production the registry is a table, and this function writes a
 * row to it; here the result is returned to the caller and rendered as a
 * session-local build. The README says so explicitly.
 */

/** Which episodes each dataset name draws from. */
export const DATASET_SCOPES: Record<string, { label: string; description: string }> = {
  'hospital-navigation': {
    label: 'hospital-navigation',
    description: 'Episodes collected at Kita General Hospital.',
  },
  'service-multisite': {
    label: 'service-multisite',
    description: 'Hotel, retail and test-facility episodes.',
  },
  'all-sites': {
    label: 'all-sites',
    description: 'Every episode in the catalog, regardless of site.',
  },
};

const HOSPITAL_SITE = 'Kita General Hospital';

function inScope(candidate: DatasetCandidate, dataset: string): boolean {
  if (dataset === 'hospital-navigation') return candidate.site === HOSPITAL_SITE;
  if (dataset === 'service-multisite') return candidate.site !== HOSPITAL_SITE;
  return true;
}

export function getCandidates(dataset: string): DatasetCandidate[] {
  return getAllEpisodes()
    .map(toCandidate)
    .filter((candidate) => inScope(candidate, dataset))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** Rebuilds the manifest for a committed version from its member list. */
export function getManifestFor(version: DatasetVersion): ManifestEntry[] {
  const byId = new Map(getAllEpisodes().map((episode) => [episode.episode_id, episode]));
  const manifest: ManifestEntry[] = [];
  for (const episodeId of version.episode_ids) {
    const episode = byId.get(episodeId);
    if (episode) manifest.push(toManifestEntry(toCandidate(episode), version.full_name));
  }
  return manifest;
}

export interface BuildRequest {
  dataset: string;
  version: string;
  policy: Partial<BuildPolicy>;
}

export function normaliseBuildRequest(body: unknown): BuildRequest {
  const input = (body ?? {}) as Record<string, unknown>;

  const dataset =
    typeof input.dataset === 'string' && input.dataset in DATASET_SCOPES
      ? input.dataset
      : 'hospital-navigation';

  const version =
    typeof input.version === 'string' && /^v\d+\.\d+$/.test(input.version) ? input.version : 'v0.4';

  const rawSensors = Array.isArray(input.require_sensors) ? input.require_sensors : undefined;
  const requireSensors = rawSensors?.filter(
    (value): value is Sensor =>
      value === 'camera' || value === 'lidar' || value === 'imu' || value === 'odometry',
  );

  const score = Number(input.min_quality_score);
  const duration = Number(input.min_duration_s);

  return {
    dataset,
    version,
    policy: {
      min_quality_score: Number.isFinite(score)
        ? Math.min(100, Math.max(0, score))
        : DEFAULT_BUILD_POLICY.min_quality_score,
      include_flagged: input.include_flagged === true,
      min_duration_s: Number.isFinite(duration)
        ? Math.min(120, Math.max(0, duration))
        : DEFAULT_BUILD_POLICY.min_duration_s,
      require_sensors: requireSensors ?? [...DEFAULT_BUILD_POLICY.require_sensors],
    },
  };
}

export function runBuild(request: BuildRequest): BuildResult {
  const parent = findLatestVersion(request.dataset);
  return buildDataset({
    dataset: request.dataset,
    version: request.version,
    candidates: getCandidates(request.dataset),
    policy: request.policy,
    parent: parent?.full_name ?? null,
    notes: 'Built interactively from the dataset console. Not persisted to the registry.',
  });
}

function findLatestVersion(dataset: string): DatasetVersion | undefined {
  const versions = ['v0.3', 'v0.2', 'v0.1'];
  for (const version of versions) {
    const found = getDataset(`${dataset}-${version}`);
    if (found) return found;
  }
  return undefined;
}
