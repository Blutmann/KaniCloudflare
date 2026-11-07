import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import {
  planStaffInvitations,
  prepareStaffAccounts,
  sendStaffInvitations,
} from "../src/lib/kani-staff-provisioning.server.ts";

const rosterFile = process.argv.find((arg, i) => i > 1 && !arg.startsWith("--"));
if (!rosterFile) {
  console.log(
    "Usage: node scripts/invite-kani-staff.mjs <private-roster.json> [--prepare | --send]. Default: read-only plan. --prepare creates unconfirmed accounts without mail or passwords.",
  );
  process.exit(0);
}
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey)
  throw new Error(
    "Set SUPABASE_SERVICE_ROLE_KEY privately in this process; never pass it on the command line.",
  );
const db = createClient("https://iockpxtkflyjfagkvgnr.supabase.co", serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const roster = JSON.parse(await readFile(rosterFile, "utf8"));
if (process.argv.includes("--prepare") && process.argv.includes("--send"))
  throw new Error("Choose one provisioning mode");
if (process.argv.includes("--prepare")) {
  const outcomes = await prepareStaffAccounts(db, roster);
  console.log(JSON.stringify(outcomes, null, 2));
  if (outcomes.some((row) => ["ACCOUNT_CREATION_FAILED", "PROFILE_PENDING"].includes(row.status)))
    process.exitCode = 1;
} else if (!process.argv.includes("--send")) {
  const plan = await planStaffInvitations(db, roster);
  console.log(
    JSON.stringify(
      plan.map((item) => ({
        name: item.row.name,
        role: item.row.role,
        existingIdentity: Boolean(item.userId),
        profileExists: item.profileExists,
        invitationPending: item.invitationPending,
      })),
      null,
      2,
    ),
  );
} else {
  const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!managementToken)
    throw new Error(
      "A private Supabase management token is required to verify Auth mail and redirect configuration.",
    );
  const response = await fetch(
    "https://api.supabase.com/v1/projects/iockpxtkflyjfagkvgnr/config/auth",
    { headers: { authorization: `Bearer ${managementToken}` } },
  );
  if (!response.ok)
    throw new Error("Cannot verify Supabase Auth configuration; no invitation was sent.");
  const outcomes = await sendStaffInvitations(db, roster, await response.json());
  console.log(JSON.stringify(outcomes, null, 2));
  if (outcomes.some((row) => ["INVITATION_FAILED", "PROFILE_PENDING"].includes(row.status)))
    process.exitCode = 1;
}
