import type { EpisodeContext } from '@/lib/pipeline/episode';
import type { TelemetryEvent } from '@/lib/pipeline/types';
import { ROBOTS } from '@/lib/sim/catalog';
import { planDemoEpisode } from '@/lib/sim/demo';
import { generateEvents, planEpisode, type EpisodePlan, type Fault } from '@/lib/sim/generator';
import { Rng } from '@/lib/sim/rng';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vercel caps a streaming function; the client reconnects when it expires. */
export const maxDuration = 300;

const TICK_MS = 120;
const GAP_BETWEEN_EPISODES_MS = 3_000;
const HEARTBEAT_MS = 15_000;

interface StreamMessage {
  episode_start: { ctx: EpisodeContext; profile: string; faults: Fault[]; duration_s: number; demo: boolean };
  telemetry: { events: TelemetryEvent[] };
  episode_end: { episode_id: string };
}

/**
 * GET /api/stream?demo=1
 *
 * Server-Sent Events carrying synthetic robot telemetry in wall-clock order.
 *
 * The server plays the robot and the transport only. It computes no metrics and
 * makes no quality judgements — the browser runs the identical pipeline modules
 * the batch seed job runs, which is the point: one implementation, two callers.
 *
 * Episodes are generated whole and then released in real time, so a fault
 * scheduled for t+28s arrives at t+28s.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const demo = url.searchParams.get('demo') === '1';
  const seed = url.searchParams.get('seed') ?? String(Date.now());

  const encoder = new TextEncoder();
  const rng = new Rng(`stream:${seed}`);
  let episodeNumber = 0;
  let robotIndex = rng.int(0, ROBOTS.length - 1);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      // Collected rather than held in named bindings so `cleanup` can be defined
      // before the timers exist — the first `send` can fail and call it.
      const timers: Array<ReturnType<typeof setInterval>> = [];

      const send = <K extends keyof StreamMessage>(event: K, data: StreamMessage[K]): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        for (const timer of timers) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      // --- current episode state ---------------------------------------
      let plan: EpisodePlan | null = null;
      let events: TelemetryEvent[] = [];
      let cursor = 0;
      let originIngest = 0;
      let startedAtWall = 0;
      let resumeAtWall = 0;

      const startEpisode = () => {
        episodeNumber += 1;
        const startTs = Date.now() / 1000;

        if (demo) {
          plan = planDemoEpisode(startTs, episodeNumber);
          events = generateEvents(new Rng(`demo:${episodeNumber}`), plan);
        } else {
          robotIndex = (robotIndex + 1) % ROBOTS.length;
          const robot = ROBOTS[robotIndex]!;
          const episodeRng = new Rng(`${seed}:${episodeNumber}`);
          plan = planEpisode(episodeRng, robot, episodeNumber, startTs);
          // Live episodes are capped so a viewer sees a verdict without waiting.
          plan.duration_s = Math.min(plan.duration_s, 55);
          events = generateEvents(episodeRng, plan);
        }

        cursor = 0;
        originIngest = events[0]?.ingest_timestamp ?? startTs;
        startedAtWall = Date.now();

        send('episode_start', {
          ctx: plan.ctx,
          profile: plan.profile,
          faults: plan.faults,
          duration_s: plan.duration_s,
          demo,
        });
      };

      const tick = () => {
        if (closed) return;

        if (!plan) {
          if (Date.now() >= resumeAtWall) startEpisode();
          return;
        }

        const elapsed = (Date.now() - startedAtWall) / 1000;
        const batch: TelemetryEvent[] = [];
        while (cursor < events.length && events[cursor]!.ingest_timestamp - originIngest <= elapsed) {
          batch.push(events[cursor]!);
          cursor += 1;
        }
        if (batch.length > 0) send('telemetry', { events: batch });

        if (cursor >= events.length && elapsed >= plan.duration_s) {
          send('episode_end', { episode_id: plan.ctx.episode_id });
          plan = null;
          events = [];
          resumeAtWall = Date.now() + GAP_BETWEEN_EPISODES_MS;
        }
      };

      startEpisode();
      timers.push(setInterval(tick, TICK_MS));

      // Comment-only heartbeat keeps proxies from closing an idle connection.
      timers.push(
        setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            cleanup();
          }
        }, HEARTBEAT_MS),
      );

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
