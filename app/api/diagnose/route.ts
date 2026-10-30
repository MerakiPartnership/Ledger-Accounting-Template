import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId");

  if (!entityId) {
    // List entities so user can pick one
    try {
      const { listEntities } = await import("@/lib/ledger/reports");
      const entities = await listEntities();
      return NextResponse.json({
        status: "ok",
        entities: entities.map((e) => ({ id: e.id, name: e.name })),
        hint: "Add ?entityId=<id> to diagnose a specific entity page",
      });
    } catch (e: unknown) {
      return NextResponse.json({
        status: "error",
        step: "listEntities",
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined,
      });
    }
  }

  const results: Record<string, string> = {};

  // Run each query the entity overview page runs, one by one
  const steps: [string, () => Promise<unknown>][] = [];

  try {
    const reports = await import("@/lib/ledger/reports");
    const { getEntityActivities } = await import("@/lib/ledger/manage-accounts");
    const { listLoans, computePaydownFromGL } = await import("@/lib/ledger/loans");
    const { getValuationComponents } = await import("@/lib/ledger/valuation");
    const { netAssetValue } = await import("@/lib/ledger/net-asset");

    steps.push(
      ["getEntity", () => reports.getEntity(entityId)],
      ["ledgerStats", () => reports.ledgerStats(entityId)],
      ["getEntityActivities", () => getEntityActivities(entityId)],
      ["accountBalances", () => reports.accountBalances(entityId, { end: "2026-12-31" })],
      ["balanceSheet", () => reports.balanceSheet(entityId, "2026-12-31")],
      ["capitalStructure", () => reports.capitalStructure(entityId, "2026-12-31")],
      ["capitalByOwner", () => reports.capitalByOwner(entityId, "2026-12-31")],
      ["listLoans", () => listLoans(entityId)],
      ["equityCashFlowSeries", () => reports.equityCashFlowSeries(entityId, "2026-12-31")],
      ["plSummary", () => reports.plSummary(entityId, { start: "2026-01-01", end: "2026-12-31" })],
      ["annualOperating", () => reports.annualOperating(entityId, [2026], { activity: "Real Estate" })],
      ["getValuationComponents", () => getValuationComponents(entityId)],
      ["netAssetValue", () => netAssetValue(entityId, "2026-12-31")],
    );

    for (const [name, fn] of steps) {
      try {
        await fn();
        results[name] = "OK";
      } catch (e: unknown) {
        results[name] = e instanceof Error ? e.message : String(e);
      }
    }

    const failed = Object.entries(results).filter(([, v]) => v !== "OK");
    return NextResponse.json({
      status: failed.length ? "errors_found" : "all_ok",
      results,
      failedSteps: failed.map(([k]) => k),
    });
  } catch (e: unknown) {
    return NextResponse.json({
      status: "import_error",
      error: e instanceof Error ? e.message : String(e),
      results,
    });
  }
}
