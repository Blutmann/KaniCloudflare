import {
  type BenefitUsageMode,
  calculateBenefitAmounts,
  normalizeBenefitCode,
} from "./kani-benefit-codes";

const KANI_META_PREFIX = "[[KANI_META:";
const KANI_META_SUFFIX = "]]";

interface BenefitCodeMeta {
  usageMode?: BenefitUsageMode;
  validFrom?: string | null;
  validUntil?: string | null;
  timesUsed?: number;
  deletedAt?: string | null;
  [key: string]: unknown;
}

function parseMeta(rawNote: string | null | undefined): {
  cleanNote: string | null;
  meta: BenefitCodeMeta | null;
} {
  if (!rawNote || typeof rawNote !== "string") return { cleanNote: null, meta: null };
  const idx = rawNote.lastIndexOf(KANI_META_PREFIX);
  if (idx === -1 || !rawNote.endsWith(KANI_META_SUFFIX)) {
    return { cleanNote: rawNote.trim() || null, meta: null };
  }
  const cleanPart = rawNote.slice(0, idx).trim();
  const jsonPart = rawNote.slice(idx + KANI_META_PREFIX.length, rawNote.length - KANI_META_SUFFIX.length);
  try {
    const parsed = JSON.parse(jsonPart) as BenefitCodeMeta;
    return { cleanNote: cleanPart || null, meta: parsed && typeof parsed === "object" ? parsed : null };
  } catch {
    return { cleanNote: rawNote.trim() || null, meta: null };
  }
}

function encodeMeta(cleanNote: string | null | undefined, meta: BenefitCodeMeta): string {
  const base = (cleanNote ?? "").trim();
  const json = JSON.stringify(meta);
  return base ? `${base}\n${KANI_META_PREFIX}${json}${KANI_META_SUFFIX}` : `${KANI_META_PREFIX}${json}${KANI_META_SUFFIX}`;
}

/**
 * Prepares (validates and locks if SINGLE_USE) a benefit code for an online payment attempt.
 * Pure DB helper with no TanStack Start server request imports so it can be imported safely
 * from payment/webhook modules without triggering client bundle import-protection errors.
 */
export async function prepareBenefitCodeForPaymentAttempt(
  db: any,
  code: string,
  attemptId: string,
  ttlSeconds = 600,
): Promise<{ codeId?: string; code: string; usageMode: BenefitUsageMode }> {
  const normalized = normalizeBenefitCode(code);
  let usageMode: BenefitUsageMode = "SINGLE_USE";
  let codeId: string | undefined;

  if (db && typeof db.from === "function") {
    try {
      const { data: row } = await db
        .from("benefit_codes")
        .select("*")
        .eq("code", normalized)
        .maybeSingle();

      if (row) {
        codeId = row.id;
        const { meta } = parseMeta(row.internal_note);
        usageMode = (row.usage_mode || meta?.usageMode || "SINGLE_USE") as BenefitUsageMode;
        const deletedAt = row.deleted_at ?? meta?.deletedAt ?? null;
        const validFrom = row.valid_from ?? meta?.validFrom ?? null;
        const validUntil = row.valid_until ?? meta?.validUntil ?? null;

        if (deletedAt || row.status === "DISABLED") {
          throw new Error("BENEFIT_CODE_LOCKED_OR_INVALID");
        }
        if (validFrom && new Date(validFrom).getTime() > Date.now()) {
          throw new Error("BENEFIT_CODE_LOCKED_OR_INVALID");
        }
        if (validUntil && new Date(validUntil).getTime() < Date.now()) {
          throw new Error("BENEFIT_CODE_LOCKED_OR_INVALID");
        }

        if (usageMode === "REUSABLE") {
          if (row.status !== "ACTIVE") {
            await db
              .from("benefit_codes")
              .update({
                status: "ACTIVE",
                locked_at: null,
                locked_expires_at: null,
                locked_attempt_id: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);
          }
          return { codeId, code: normalized, usageMode: "REUSABLE" };
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === "BENEFIT_CODE_LOCKED_OR_INVALID") throw e;
    }
  }

  const { data: locked, error: lockErr } = await db.rpc("lock_benefit_code_attempt", {
    p_code: normalized,
    p_attempt_id: attemptId,
    p_ttl_seconds: ttlSeconds,
  });
  if (lockErr || !locked) {
    throw new Error("BENEFIT_CODE_LOCKED_OR_INVALID");
  }
  return { codeId, code: normalized, usageMode };
}

/**
 * Consumes or records usage of a benefit code upon verified online payment confirmation.
 */
export async function consumeBenefitCodeForPaymentAttempt(
  db: any,
  appointmentId: string,
  attemptId: string,
): Promise<void> {
  try {
    await db.rpc("admin_consume_benefit_code_for_attempt", {
      p_appointment_id: appointmentId,
      p_attempt_id: attemptId,
    });
  } catch {
    // Fallback below handles live DB column mismatch or reusable codes
  }

  if (!db || typeof db.from !== "function") return;

  try {
    const { data: appt } = await db
      .from("appointments")
      .select("id, client_id, service_price_ars, deposit_amount_ars, benefit_code_id, benefit_code, benefit_type")
      .eq("id", appointmentId)
      .maybeSingle();

    if (!appt) return;

    let codeRow: any = null;
    if (appt.benefit_code_id) {
      const { data } = await db.from("benefit_codes").select("*").eq("id", appt.benefit_code_id).maybeSingle();
      codeRow = data;
    } else if (appt.benefit_code) {
      const { data } = await db.from("benefit_codes").select("*").eq("code", appt.benefit_code).maybeSingle();
      codeRow = data;
    }

    if (!codeRow) return;

    const { cleanNote, meta } = parseMeta(codeRow.internal_note);
    const usageMode = (codeRow.usage_mode || meta?.usageMode || "SINGLE_USE") as BenefitUsageMode;
    const servicePrice = Number(appt.service_price_ars ?? 25000);
    const depositAmount = Number(appt.deposit_amount_ars ?? 5000);
    const calc = calculateBenefitAmounts(servicePrice, depositAmount, codeRow.type, codeRow.code);

    await db
      .from("appointments")
      .update({
        benefit_code_id: codeRow.id,
        benefit_code: codeRow.code,
        benefit_type: codeRow.type,
        benefit_original_price_ars: calc.originalPriceArs,
        benefit_discount_amount_ars: calc.discountAmountArs,
        benefit_final_price_ars: calc.finalPriceArs,
        benefit_online_deposit_ars: calc.onlineDepositArs,
        benefit_in_person_balance_ars: calc.inPersonBalanceArs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", appointmentId);

    const nowIso = new Date().toISOString();
    const isReusable = usageMode === "REUSABLE";
    const prevTimesUsed = Number(codeRow.times_used ?? meta?.timesUsed ?? 0);
    const nextTimesUsed = prevTimesUsed + 1;

    const codeUpdate: Record<string, any> = {
      status: isReusable ? "ACTIVE" : "CONSUMED",
      consumed_at: nowIso,
      consumed_appointment_id: appointmentId,
      consumed_client_id: appt.client_id ?? null,
      original_price_ars: calc.originalPriceArs,
      discount_amount_ars: calc.discountAmountArs,
      final_price_ars: calc.finalPriceArs,
      online_deposit_ars: calc.onlineDepositArs,
      in_person_balance_ars: calc.inPersonBalanceArs,
      locked_at: null,
      locked_expires_at: null,
      locked_attempt_id: null,
      updated_at: nowIso,
    };

    if (meta) {
      codeUpdate.internal_note = encodeMeta(cleanNote, {
        ...meta,
        timesUsed: nextTimesUsed,
      });
    }

    await db.from("benefit_codes").update(codeUpdate).eq("id", codeRow.id);
  } catch (err) {
    console.warn("[Kani Benefit Codes] Payment consume warning:", err);
  }
}
