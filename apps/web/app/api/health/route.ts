// Liveness / uptime probe for the web app.
//
// A deliberately cheap, dependency-free 200 that an uptime monitor
// (Better Stack / UptimeRobot / a cron curl) can poll to confirm the
// Next.js server is up and serving. It does NOT touch Supabase or R2 —
// the deeper "curl + DB ping + R2 read" production health check is the
// deferred Stage 11 follow-up in `rules/11-deployment.md` ("Done when"),
// tracked as #FU-63. Keep this endpoint fast and side-effect-free so a
// monitor hitting it every 30–60s costs nothing.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface HealthPayload {
  readonly status: 'ok';
  readonly service: 'web';
  readonly timestamp: string;
}

export function GET(): NextResponse<HealthPayload> {
  return NextResponse.json(
    { status: 'ok', service: 'web', timestamp: new Date().toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
