// Studio report repository (v1.1 Addendum §8). Server-authoritative, org + event scoped,
// optimistic concurrency via `revision`. Browser storage is never the source of truth.
import type { StudioReport, User } from "./types";
import { audit, mutate, nowIso, read, uid } from "./store";
import { HttpError } from "./auth";
import { defaultEventPerformanceReport, REPORT_TEMPLATE_VERSION } from "./report-template";

export const AG_STUDIO_VERSION = "3.1.0";
export const REPORT_SCHEMA_VERSION = "peakshift-report-v1";
const MAX_STATE_BYTES = 512 * 1024;

const view = (r: StudioReport) => r;

function scoped(u: User, r: StudioReport | undefined) {
  if (!r || r.organisationId !== u.orgId) throw new HttpError(404, "NOT_FOUND", "Report not found.");
  return r;
}

export function listReports(u: User, eventId: string) {
  const s = read();
  if (!s.events.some((e) => e.id === eventId)) throw new HttpError(404, "NOT_FOUND", "Event not found.");
  return (s.studioReports ?? []).filter((r) => r.organisationId === u.orgId && r.eventId === eventId).map(view);
}

/** Return the org's report for this event, creating it from the versioned template on first open. */
export async function getOrCreateEventReport(u: User, eventId: string) {
  const existing = listReports(u, eventId)[0];
  if (existing) return existing;
  return mutate((s) => {
    s.studioReports ??= [];
    const again = s.studioReports.find((r) => r.organisationId === u.orgId && r.eventId === eventId);
    if (again) return again;
    const r: StudioReport = {
      id: uid("rpt"),
      organisationId: u.orgId,
      ownerUserId: u.id,
      eventId,
      name: "Event Performance",
      description: "Default PeakShift report: capacity, load-shift evidence, participant contribution, incentive efficiency and settlement pulse.",
      reportState: defaultEventPerformanceReport(),
      agStudioVersion: AG_STUDIO_VERSION,
      reportSchemaVersion: REPORT_SCHEMA_VERSION,
      templateVersion: REPORT_TEMPLATE_VERSION,
      isDefault: true,
      visibility: "ORGANISATION",
      revision: 1,
      updatedAt: nowIso(),
      updatedBy: u.id,
    };
    s.studioReports.push(r);
    audit(s, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "studio_report", entityId: r.id, action: "report.created", summary: `Report “${r.name}” created from template ${REPORT_TEMPLATE_VERSION} (rev 1).` });
    return r;
  });
}

export function getReport(u: User, id: string) {
  return scoped(u, (read().studioReports ?? []).find((r) => r.id === id));
}

function checkState(state: unknown) {
  if (!state || typeof state !== "object" || !Array.isArray((state as { pages?: unknown }).pages)) throw new HttpError(422, "INVALID_REPORT_STATE", "Report state is not a valid AG Studio report.");
  const size = JSON.stringify(state).length;
  if (size > MAX_STATE_BYTES) throw new HttpError(413, "REPORT_TOO_LARGE", "Report state exceeds the 512 KB limit.");
}

export async function saveReport(u: User, id: string, body: { reportState: unknown; expectedRevision: number; name?: string }) {
  if (!["operator", "admin"].includes(u.role)) throw new HttpError(403, "FORBIDDEN", "You can view this report but not edit it.");
  checkState(body.reportState);
  if (!Number.isInteger(body.expectedRevision)) throw new HttpError(422, "VALIDATION_ERROR", "expectedRevision is required.");
  return mutate((s) => {
    const r = scoped(u, (s.studioReports ?? []).find((x) => x.id === id));
    if (r.revision !== body.expectedRevision) throw new HttpError(409, "REPORT_CONFLICT", `This report was saved elsewhere (revision ${r.revision}). Reload to see the latest version.`, { currentRevision: String(r.revision) });
    r.reportState = body.reportState;
    if (body.name) r.name = body.name.slice(0, 80);
    r.revision += 1;
    r.updatedAt = nowIso();
    r.updatedBy = u.id;
    r.isDefault = false;
    r.agStudioVersion = AG_STUDIO_VERSION;
    audit(s, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "studio_report", entityId: r.id, action: "report.saved", summary: `Report “${r.name}” saved (rev ${r.revision}).` });
    return r;
  });
}

export async function resetReport(u: User, id: string) {
  if (!["operator", "admin"].includes(u.role)) throw new HttpError(403, "FORBIDDEN", "You cannot reset this report.");
  return mutate((s) => {
    const r = scoped(u, (s.studioReports ?? []).find((x) => x.id === id));
    r.reportState = defaultEventPerformanceReport();
    r.templateVersion = REPORT_TEMPLATE_VERSION;
    r.isDefault = true;
    r.revision += 1;
    r.updatedAt = nowIso();
    r.updatedBy = u.id;
    audit(s, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "studio_report", entityId: r.id, action: "report.reset", summary: `Report “${r.name}” reset to template ${REPORT_TEMPLATE_VERSION} (rev ${r.revision}).` });
    return r;
  });
}
