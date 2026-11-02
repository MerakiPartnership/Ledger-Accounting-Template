"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { assertEntityCreator } from "@/lib/ledger/access";

const { bkLedgerEntities } = schema;

export async function createEntity(formData: FormData) {
  // AUTHORITATIVE guard: only the owner may create entities, verified against
  // the server-side session email — never client input. Admin/all-entity
  // access does not qualify. (The page guard is just UX; this is the check.)
  await assertEntityCreator();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Entity name is required");

  const legalName = String(formData.get("legalName") ?? "").trim() || name;
  const taxType = String(formData.get("taxType") ?? "partnership").trim();
  const valuationMethod = String(formData.get("valuationMethod") ?? "income").trim();

  // Partners: submitted as partner_name_0, partner_pct_0, partner_name_1, ...
  const owners: { name: string; pct: number }[] = [];
  for (let i = 0; ; i++) {
    const pName = String(formData.get(`partner_name_${i}`) ?? "").trim();
    const pPct = parseFloat(String(formData.get(`partner_pct_${i}`) ?? ""));
    if (!pName) break;
    if (pName && Number.isFinite(pPct) && pPct > 0) owners.push({ name: pName, pct: pPct });
  }

  // Use a synthetic wave-style realm id — no QBO connection.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const realmId = `user:${slug}-${Date.now()}`;

  const [entity] = await db
    .insert(bkLedgerEntities)
    .values({
      realmId,
      name,
      legalName,
      taxType,
      valuationMethod: valuationMethod as "income" | "market" | "none",
      owners: owners.length ? owners : null,
    })
    .returning({ id: bkLedgerEntities.id });

  redirect(`/ledger/${entity.id}`);
}

export async function deleteEntity(formData: FormData) {
  await assertEntityCreator();

  const entityId = String(formData.get("entityId") ?? "").trim();
  if (!entityId) throw new Error("Entity ID is required");

  // Verify entity exists
  const [entity] = await db
    .select({ id: bkLedgerEntities.id, name: bkLedgerEntities.name })
    .from(bkLedgerEntities)
    .where(eq(bkLedgerEntities.id, entityId))
    .limit(1);
  if (!entity) throw new Error("Entity not found");

  // Delete all entity-scoped data in dependency order.
  // Parameterized to avoid injection; .catch() handles tables that may not exist.
  await db.transaction(async (tx) => {
    const del = (table: string) =>
      tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE entity_id = ${entityId}`);

    // Leaf tables first (no inbound FKs from other bk_ tables)
    await del("bk_review_holds").catch(() => {});
    await del("bk_categorization_events").catch(() => {});
    await del("bk_rule_audit").catch(() => {});
    await del("bk_rules").catch(() => {});
    await del("bk_journal_edits").catch(() => {});
    await del("bk_utility_readings").catch(() => {});
    await del("bk_utility_groups").catch(() => {});
    await del("bk_documents").catch(() => {});
    await del("bk_valuation_components").catch(() => {});
    await del("bk_loans").catch(() => {});
    await del("bk_audit_log").catch(() => {});
    await del("bk_entity_access").catch(() => {});

    // Plaid data
    await del("bk_plaid_transactions").catch(() => {});
    await del("bk_plaid_accounts").catch(() => {});
    await del("bk_plaid_items").catch(() => {});

    // Reconciliation — journal lines reference entries, not entity directly
    await tx.execute(
      sql`DELETE FROM bk_journal_lines WHERE entry_id IN (SELECT id FROM bk_journal_entries WHERE entity_id = ${entityId})`
    ).catch(() => {});
    await del("bk_reconciliation_lines").catch(() => {});
    await del("bk_reconciliations").catch(() => {});
    await del("bk_journal_entries").catch(() => {});
    await del("bk_accounts").catch(() => {});

    // Finally the entity itself
    await tx.execute(
      sql`DELETE FROM bk_ledger_entities WHERE id = ${entityId}`
    );
  });

  revalidatePath("/ledger");
  redirect("/ledger");
}
