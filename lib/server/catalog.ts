import 'server-only';

import rawCatalog from '@/data/catalog.json';
import type { Catalog, Experiment, FleetRobotStats } from '@/lib/data/types';
import type { DatasetVersion } from '@/lib/pipeline/dataset';
import type { Episode, EpisodeStatus, EpisodeSummary } from '@/lib/pipeline/types';
import type { RobotProfile } from '@/lib/sim/catalog';

/**
 * Read access to the materialised catalog.
 *
 * `data/catalog.json` is produced by `npm run seed` and committed, so the
 * deployed app has no database and no cold-start cost. The JSON import is typed
 * through `Catalog` once, here, rather than being cast at every call site.
 *
 * The trade-off is honest and stated in the README: this is a read-only
 * snapshot. Datasets a visitor builds in the browser live in `session.ts` and do
 * not survive a redeploy. Swapping this module for a BigQuery or Postgres client
 * is the single change needed to make it durable.
 */
const catalog = rawCatalog as unknown as Catalog;

export function getCatalog(): Catalog {
  return catalog;
}

export function getStats() {
  return catalog.stats;
}

export function getRobots(): RobotProfile[] {
  return catalog.robots;
}

export function getRobot(robotId: string): RobotProfile | undefined {
  return catalog.robots.find((robot) => robot.robot_id === robotId);
}

export function getFleet(): FleetRobotStats[] {
  return catalog.fleet;
}

export function getFleetStats(robotId: string): FleetRobotStats | undefined {
  return catalog.fleet.find((entry) => entry.robot_id === robotId);
}

export function getEpisode(episodeId: string): Episode | undefined {
  return catalog.episodes.find((episode) => episode.episode_id === episodeId);
}

export interface EpisodeQuery {
  robotId?: string;
  status?: EpisodeStatus;
  task?: string;
  site?: string;
  search?: string;
  limit?: number;
}

/** Newest first — the order an operator wants when something just broke. */
export function getEpisodeSummaries(query: EpisodeQuery = {}): EpisodeSummary[] {
  const search = query.search?.trim().toLowerCase();
  const filtered = catalog.summaries.filter((summary) => {
    if (query.robotId && summary.robot_id !== query.robotId) return false;
    if (query.status && summary.status !== query.status) return false;
    if (query.task && summary.task !== query.task) return false;
    if (query.site && summary.site !== query.site) return false;
    if (search) {
      const haystack =
        `${summary.episode_id} ${summary.robot_id} ${summary.task_label} ${summary.site}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return query.limit ? filtered.slice(0, query.limit) : filtered;
}

export function getEpisodeSummary(episodeId: string): EpisodeSummary | undefined {
  return catalog.summaries.find((summary) => summary.episode_id === episodeId);
}

export function getTasks(): string[] {
  return [...new Set(catalog.summaries.map((s) => s.task))].sort();
}

export function getSites(): string[] {
  return [...new Set(catalog.robots.map((r) => r.site))].sort();
}

export function getDatasets(): DatasetVersion[] {
  return catalog.datasets;
}

export function getDataset(fullName: string): DatasetVersion | undefined {
  return catalog.datasets.find((dataset) => dataset.full_name === fullName);
}

/** Groups versions under their dataset name, newest version last. */
export function getDatasetFamilies(): Array<{ dataset: string; versions: DatasetVersion[] }> {
  const families = new Map<string, DatasetVersion[]>();
  for (const version of catalog.datasets) {
    const list = families.get(version.dataset) ?? [];
    list.push(version);
    families.set(version.dataset, list);
  }
  return [...families.entries()]
    .map(([dataset, versions]) => ({
      dataset,
      versions: [...versions].sort((a, b) => a.version.localeCompare(b.version)),
    }))
    .sort((a, b) => b.versions.length - a.versions.length);
}

export function getExperiments(): Experiment[] {
  return catalog.experiments;
}

export function getExperiment(experimentId: string): Experiment | undefined {
  return catalog.experiments.find((experiment) => experiment.experiment_id === experimentId);
}

/** Every candidate episode, for building a new dataset version on demand. */
export function getAllEpisodes(): Episode[] {
  return catalog.episodes;
}
