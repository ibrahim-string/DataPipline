import { cx } from '@/components/ui/primitives';
import type { ActionSegment } from '@/lib/pipeline/types';

/**
 * The action track for an episode.
 *
 * Segments carry direct text labels rather than a colour legend — action
 * identity is never encoded by colour alone, and the page already spends its
 * categorical palette on the sensor charts.
 */
export function ActionTimeline({
  segments,
  duration,
}: {
  segments: ActionSegment[];
  duration: number;
}) {
  if (segments.length === 0 || duration <= 0) {
    return <p className="text-xs text-ink-dim">No action stream recorded for this episode.</p>;
  }

  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded border border-line bg-base">
        {segments.map((segment, index) => {
          const width = ((segment.end_offset_s - segment.start_offset_s) / duration) * 100;
          const stopped = segment.action === 'STOP';
          return (
            <div
              key={`${segment.action}-${index}`}
              style={{ width: `${Math.max(width, 0.6)}%` }}
              title={`${segment.action} · ${segment.start_offset_s.toFixed(1)}s → ${segment.end_offset_s.toFixed(1)}s · ${segment.mean_linear_velocity.toFixed(2)} m/s`}
              className={cx(
                'flex items-center justify-center overflow-hidden border-r border-base px-1 text-[10px] font-medium last:border-r-0',
                stopped
                  ? 'bg-elevated text-ink-dim'
                  : 'bg-accent/20 text-ink',
              )}
            >
              <span className="truncate">{width > 7 ? segment.action.replace('_', ' ') : ''}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] tnum text-ink-dim">
        <span>t + 0s</span>
        <span>
          {segments.length} action segment{segments.length === 1 ? '' : 's'}
        </span>
        <span>t + {duration.toFixed(0)}s</span>
      </div>
    </div>
  );
}
