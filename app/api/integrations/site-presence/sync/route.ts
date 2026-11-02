import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { syncSitePresenceIntegrations } from '@/lib/sitePresenceSync';
import { getSimpleFrenchErrorMessage } from '@/lib/userFacingErrors';

export async function POST() {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;
    const rows = await syncSitePresenceIntegrations(activeUserId);
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ error: getSimpleFrenchErrorMessage(e, 'Impossible de synchroniser les sites.') }, { status: 500 });
  }
}
