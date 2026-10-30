import { NextResponse } from "next/server";

/**
 * Temporary one-shot migration endpoint — runs ALL idempotent schema migrations
 * from scripts/add-*.mjs in one hit. Remove after first successful run.
 */
export async function POST() {
  const log: string[] = [];
  const push = (s: string) => { log.push(s); };

  try {
    const { db } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");

    // ── 1. bk_app_users: missing columns ─────────────────────────────────────
    await db.execute(sql`ALTER TABLE bk_app_users
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS display_name text,
      ADD COLUMN IF NOT EXISTS last_name text,
      ADD COLUMN IF NOT EXISTS created_by text`);
    push("1. bk_app_users columns added");

    // ── 2. bk_ledger_entities: nickname + valuation + ownership ──────────────
    await db.execute(sql`ALTER TABLE bk_ledger_entities
      ADD COLUMN IF NOT EXISTS nickname text,
      ADD COLUMN IF NOT EXISTS valuation_method text NOT NULL DEFAULT 'income',
      ADD COLUMN IF NOT EXISTS market_value_cents bigint,
      ADD COLUMN IF NOT EXISTS market_value_source text,
      ADD COLUMN IF NOT EXISTS market_value_as_of date,
      ADD COLUMN IF NOT EXISTS property_address text,
      ADD COLUMN IF NOT EXISTS valuation_url text,
      ADD COLUMN IF NOT EXISTS parent_entity_id uuid,
      ADD COLUMN IF NOT EXISTS ownership_pct numeric`);
    push("2. bk_ledger_entities columns added");

    // ── 3. bk_entity_access: access_level ────────────────────────────────────
    await db.execute(sql`ALTER TABLE bk_entity_access
      ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'read'`);
    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bk_entity_access_level_ck') THEN
        ALTER TABLE bk_entity_access
          ADD CONSTRAINT bk_entity_access_level_ck CHECK (access_level IN ('read','write'));
      END IF;
    END $$`);
    push("3. bk_entity_access.access_level added");

    // ── 4. bk_app_users: role constraint ─────────────────────────────────────
    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bk_app_users_role_ck') THEN
        ALTER TABLE bk_app_users
          ADD CONSTRAINT bk_app_users_role_ck
          CHECK (role IN ('owner','admin','accountant','business_partner','member'));
      END IF;
    END $$`);
    push("4. bk_app_users role constraint added");

    // ── 5. bk_audit_log ──────────────────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_email text NOT NULL,
      actor_role text NOT NULL,
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      action_type text NOT NULL,
      object_table text,
      object_id text,
      description text NOT NULL,
      before_json jsonb,
      after_json jsonb,
      affected_ledger boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      reviewed boolean NOT NULL DEFAULT false,
      reviewed_at timestamptz,
      reviewed_by text
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_audit_log_entity_reviewed_idx
      ON bk_audit_log (entity_id, reviewed)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_audit_log_reviewed_created_idx
      ON bk_audit_log (reviewed, created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_audit_log_actor_idx
      ON bk_audit_log (actor_email)`);
    await db.execute(sql`ALTER TABLE bk_audit_log ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_audit_log FROM anon, authenticated`);
    push("5. bk_audit_log created + RLS");

    // ── 6. bk_rules + bk_categorization_events + bk_rule_edits ──────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope text NOT NULL,
      entity_id uuid REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text,
      enabled boolean NOT NULL DEFAULT true,
      auto_apply boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'active',
      origin text NOT NULL DEFAULT 'manual',
      rank integer NOT NULL DEFAULT 100,
      predicate jsonb NOT NULL,
      action jsonb NOT NULL,
      proposed_from_txn_id uuid,
      applied_count integer NOT NULL DEFAULT 0,
      corrected_count integer NOT NULL DEFAULT 0,
      confirmed_count integer NOT NULL DEFAULT 0,
      last_applied_at timestamptz,
      created_by text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT bk_rules_scope_entity_ck CHECK ((scope = 'global') = (entity_id IS NULL))
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_rules_scope_enabled_status_idx
      ON bk_rules (scope, enabled, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_rules_entity_idx ON bk_rules (entity_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_rules_origin_status_idx
      ON bk_rules (origin, status)`);

    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_categorization_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      plaid_txn_id uuid REFERENCES bk_plaid_transactions(id) ON DELETE SET NULL,
      journal_entry_id uuid REFERENCES bk_journal_entries(id) ON DELETE SET NULL,
      rule_id uuid REFERENCES bk_rules(id) ON DELETE SET NULL,
      decision_source text NOT NULL,
      outcome text NOT NULL,
      action_kind text,
      confidence numeric,
      reason text,
      detail jsonb,
      created_by text,
      created_at timestamptz DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_entity_idx
      ON bk_categorization_events (entity_id, created_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_txn_idx
      ON bk_categorization_events (plaid_txn_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_rule_idx
      ON bk_categorization_events (rule_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_entry_idx
      ON bk_categorization_events (journal_entry_id)`);

    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_rule_edits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id uuid NOT NULL REFERENCES bk_rules(id) ON DELETE CASCADE,
      entity_id uuid,
      field text NOT NULL,
      old_value text,
      new_value text,
      edited_at timestamptz DEFAULT now(),
      edited_by text
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_rule_edits_rule_idx ON bk_rule_edits (rule_id)`);

    await db.execute(sql`ALTER TABLE bk_plaid_transactions
      ADD COLUMN IF NOT EXISTS review_reason text`);
    await db.execute(sql`ALTER TABLE bk_plaid_transactions
      ADD COLUMN IF NOT EXISTS matched_rule_id uuid`);
    // FK for matched_rule_id — idempotent via DO block
    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bk_plaid_transactions_matched_rule_id_fkey') THEN
        ALTER TABLE bk_plaid_transactions
          ADD CONSTRAINT bk_plaid_transactions_matched_rule_id_fkey
          FOREIGN KEY (matched_rule_id) REFERENCES bk_rules(id) ON DELETE SET NULL;
      END IF;
    END $$`);

    for (const t of ["bk_rules", "bk_categorization_events", "bk_rule_edits"]) {
      await db.execute(sql.raw(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`));
      await db.execute(sql.raw(`REVOKE ALL ON ${t} FROM anon, authenticated`));
    }
    push("6. rules engine tables created + RLS");

    // ── 7. bk_reconciliations ────────────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_reconciliations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      account_id uuid NOT NULL REFERENCES bk_accounts(id) ON DELETE CASCADE,
      statement_date date NOT NULL,
      statement_balance_cents bigint NOT NULL,
      beginning_balance_cents bigint NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'in_progress',
      notes text,
      created_by text,
      created_at timestamptz DEFAULT now(),
      completed_at timestamptz
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_reconciliations_entity_idx
      ON bk_reconciliations (entity_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_reconciliations_account_date_idx
      ON bk_reconciliations (account_id, statement_date)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS bk_reconciliations_one_open_uq
      ON bk_reconciliations (account_id) WHERE status = 'in_progress'`);
    await db.execute(sql`ALTER TABLE bk_journal_lines
      ADD COLUMN IF NOT EXISTS reconciliation_id uuid`);
    // FK for reconciliation_id
    await db.execute(sql`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bk_journal_lines_reconciliation_id_fkey') THEN
        ALTER TABLE bk_journal_lines
          ADD CONSTRAINT bk_journal_lines_reconciliation_id_fkey
          FOREIGN KEY (reconciliation_id) REFERENCES bk_reconciliations(id) ON DELETE SET NULL;
      END IF;
    END $$`);
    await db.execute(sql`ALTER TABLE bk_journal_entries
      ADD COLUMN IF NOT EXISTS created_by text`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_journal_lines_reconciliation_idx
      ON bk_journal_lines (reconciliation_id) WHERE reconciliation_id IS NOT NULL`);
    await db.execute(sql`ALTER TABLE bk_reconciliations ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_reconciliations FROM anon, authenticated`);
    push("7. bk_reconciliations created + RLS");

    // ── 8. bk_loans: liability engine columns ────────────────────────────────
    await db.execute(sql`ALTER TABLE bk_loans
      ADD COLUMN IF NOT EXISTS payee_aliases jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await db.execute(sql`ALTER TABLE bk_loans
      ADD COLUMN IF NOT EXISTS expected_payment_cents bigint`);
    await db.execute(sql`ALTER TABLE bk_loans
      ADD COLUMN IF NOT EXISTS recognized_count integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE bk_loans
      ADD COLUMN IF NOT EXISTS last_recognized_date date`);
    push("8. bk_loans liability columns added");

    // ── 9. bk_loans: rate precision widening ─────────────────────────────────
    try {
      const rateCol = await db.execute(sql`SELECT data_type, numeric_scale FROM information_schema.columns
        WHERE table_name = 'bk_loans' AND column_name = 'annual_rate_bps'`);
      if (rateCol.length > 0) {
        const r = rateCol[0] as Record<string, unknown>;
        if (r.data_type !== "numeric" || Number(r.numeric_scale ?? 0) < 3) {
          await db.execute(sql`ALTER TABLE bk_loans
            ALTER COLUMN annual_rate_bps TYPE numeric(8,3)
            USING annual_rate_bps::numeric(8,3)`);
          push("9. bk_loans.annual_rate_bps widened to numeric(8,3)");
        } else {
          push("9. bk_loans.annual_rate_bps already numeric — skipped");
        }
      } else {
        push("9. bk_loans.annual_rate_bps column not found — skipped");
      }
    } catch {
      push("9. bk_loans rate precision — skipped (non-critical)");
    }

    // ── 10. bk_review_holds ──────────────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_review_holds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      amount_cents bigint,
      amount_max_cents bigint,
      vendor_text text,
      note text,
      expires_at timestamptz NOT NULL,
      match_count integer NOT NULL DEFAULT 0,
      last_matched_txn_id uuid,
      last_matched_at timestamptz,
      acknowledged_at timestamptz,
      acknowledged_by text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bk_review_holds_criteria_ck CHECK (amount_cents IS NOT NULL OR vendor_text IS NOT NULL)
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_review_holds_open_idx
      ON bk_review_holds (entity_id) WHERE acknowledged_at IS NULL`);
    await db.execute(sql`ALTER TABLE bk_review_holds ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_review_holds FROM anon, authenticated`);
    push("10. bk_review_holds created + RLS");

    // ── 11. bk_account_recon ─────────────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_account_recon (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL,
      account_qbo_id text NOT NULL,
      as_of_date date NOT NULL,
      actual_balance_cents bigint NOT NULL,
      note text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_account_recon_lookup_idx
      ON bk_account_recon (entity_id, account_qbo_id, as_of_date DESC)`);
    await db.execute(sql`ALTER TABLE bk_account_recon ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_account_recon FROM anon, authenticated`);
    push("11. bk_account_recon created + RLS");

    // ── 12. bk_account_recon_state ───────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_account_recon_state (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      account_id uuid NOT NULL UNIQUE REFERENCES bk_accounts(id) ON DELETE CASCADE,
      off_since timestamptz,
      last_in_sync_at timestamptz,
      last_residual_cents bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await db.execute(sql`ALTER TABLE bk_account_recon_state ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_account_recon_state FROM anon, authenticated`);
    push("12. bk_account_recon_state created + RLS");

    // ── 13. bk_plaid_accounts: sync_excluded ─────────────────────────────────
    await db.execute(sql`ALTER TABLE bk_plaid_accounts
      ADD COLUMN IF NOT EXISTS sync_excluded boolean NOT NULL DEFAULT false`);
    push("13. bk_plaid_accounts.sync_excluded added");

    // ── 14. bk_valuation_components + bk_valuation_estimates ─────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_valuation_components (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      label text NOT NULL,
      address text,
      zillow_url text,
      redfin_url text,
      chosen_source text,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_valuation_components_entity_idx
      ON bk_valuation_components(entity_id)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_valuation_estimates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      component_id uuid NOT NULL REFERENCES bk_valuation_components(id) ON DELETE CASCADE,
      source text NOT NULL,
      value_cents bigint NOT NULL,
      as_of date,
      url text,
      reasoning text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT bk_valuation_estimates_component_source_uq UNIQUE (component_id, source)
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_valuation_estimates_component_idx
      ON bk_valuation_estimates(component_id)`);
    // Component fact columns
    await db.execute(sql`ALTER TABLE bk_valuation_components
      ADD COLUMN IF NOT EXISTS property_type text,
      ADD COLUMN IF NOT EXISTS units text,
      ADD COLUMN IF NOT EXISTS beds text,
      ADD COLUMN IF NOT EXISTS baths text,
      ADD COLUMN IF NOT EXISTS sqft text,
      ADD COLUMN IF NOT EXISTS monthly_rent text,
      ADD COLUMN IF NOT EXISTS condition text,
      ADD COLUMN IF NOT EXISTS facts_note text`);
    push("14. valuation components + estimates created");

    // ── 15. bk_utility_groups + bk_utility_matchers ──────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_utility_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id uuid NOT NULL REFERENCES bk_ledger_entities(id) ON DELETE CASCADE,
      name text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      tracking_start date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (entity_id, name)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_utility_matchers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES bk_utility_groups(id) ON DELETE CASCADE,
      category text NOT NULL,
      match_contains text NOT NULL,
      plaid_account_id uuid NOT NULL REFERENCES bk_plaid_accounts(id) ON DELETE CASCADE,
      optional boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (group_id, category, match_contains)
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_utility_matchers_group_idx
      ON bk_utility_matchers (group_id)`);
    await db.execute(sql`ALTER TABLE bk_utility_groups ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_utility_groups FROM anon, authenticated`);
    await db.execute(sql`ALTER TABLE bk_utility_matchers ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_utility_matchers FROM anon, authenticated`);
    push("15. utility tracker tables created + RLS");

    // ── 16. AI pipeline columns + tables ─────────────────────────────────────
    await db.execute(sql`ALTER TABLE bk_categorization_events
      ADD COLUMN IF NOT EXISTS suggested_account_id uuid,
      ADD COLUMN IF NOT EXISTS posted_account_id uuid,
      ADD COLUMN IF NOT EXISTS merchant_key text,
      ADD COLUMN IF NOT EXISTS amount_cents bigint,
      ADD COLUMN IF NOT EXISTS bucket_key text,
      ADD COLUMN IF NOT EXISTS model text,
      ADD COLUMN IF NOT EXISTS prompt_version text,
      ADD COLUMN IF NOT EXISTS suggested_payee text,
      ADD COLUMN IF NOT EXISTS would_auto_post boolean,
      ADD COLUMN IF NOT EXISTS decided_at timestamptz,
      ADD COLUMN IF NOT EXISTS decided_by text`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_bucket_idx
      ON bk_categorization_events (bucket_key, outcome)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_categorization_events_merchant_idx
      ON bk_categorization_events (merchant_key)`);

    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_merchant_intel (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_key text NOT NULL UNIQUE,
      display_name text,
      business_type text,
      likely_category text,
      notes text,
      source text NOT NULL DEFAULT 'web',
      confidence numeric,
      owner_category text,
      sample_raw text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )`);
    await db.execute(sql`ALTER TABLE bk_merchant_intel ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_merchant_intel FROM anon, authenticated`);

    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_autopost_buckets (
      bucket_key text PRIMARY KEY,
      status text NOT NULL DEFAULT 'shadow',
      outcomes integer NOT NULL DEFAULT 0,
      correct integer NOT NULL DEFAULT 0,
      measured_precision numeric,
      unlocked_at timestamptz,
      locked_at timestamptz,
      lock_reason text,
      updated_at timestamptz DEFAULT now()
    )`);
    await db.execute(sql`ALTER TABLE bk_autopost_buckets ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_autopost_buckets FROM anon, authenticated`);

    await db.execute(sql`ALTER TABLE bk_plaid_transactions
      ADD COLUMN IF NOT EXISTS suggested_payee text,
      ADD COLUMN IF NOT EXISTS suggestion_bucket text`);
    push("16. AI pipeline tables + columns created + RLS");

    // ── 17. bk_rate_limits ───────────────────────────────────────────────────
    await db.execute(sql`CREATE TABLE IF NOT EXISTS bk_rate_limits (
      key text NOT NULL,
      window_start bigint NOT NULL,
      count integer NOT NULL DEFAULT 0,
      reset_at timestamptz NOT NULL,
      PRIMARY KEY (key, window_start)
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS bk_rate_limits_reset_idx
      ON bk_rate_limits (reset_at)`);
    await db.execute(sql`ALTER TABLE bk_rate_limits ENABLE ROW LEVEL SECURITY`);
    await db.execute(sql`REVOKE ALL ON bk_rate_limits FROM anon, authenticated`);
    push("17. bk_rate_limits created + RLS");

    return NextResponse.json({ status: "ok", steps: log.length, log });
  } catch (e: unknown) {
    return NextResponse.json({
      status: "error",
      completedSteps: log.length,
      log,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
