import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  resolveProfessionalCompanyNameFromProfile,
  sanitizeProfessionalIdentityText,
  sanitizeProfessionalIdentityValue,
} from "../lib/professionalBusinessIdentity.ts";

type JsonRow = Record<string, unknown>;

function loadLocalEnv() {
  const path = resolve(process.cwd(), ".env.local");
  let source = "";
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function readAll(
  client: SupabaseClient,
  table: string,
  columns: string,
) {
  const pageSize = 500;
  const rows: JsonRow[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(start, start + pageSize - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data as unknown as JsonRow[] : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

loadLocalEnv();

const apply = process.argv.includes("--apply");
const supabaseUrl = String(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
).trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [profiles, businesses, memories] = await Promise.all([
  readAll(supabase, "profiles", "user_id,company_legal_name"),
  readAll(
    supabase,
    "business_profiles",
    "user_id,business_description",
  ),
  readAll(supabase, "business_ai_memories", "account_id,memory"),
]);

const companyNames = new Map<string, string>();
for (const profile of profiles) {
  const userId = String(profile.user_id || "").trim();
  const companyName = resolveProfessionalCompanyNameFromProfile(
    profile.company_legal_name,
  );
  if (userId && companyName) companyNames.set(userId, companyName);
}

const businessRepairs = businesses.flatMap((business) => {
  const userId = String(business.user_id || "").trim();
  const companyName = companyNames.get(userId) || "";
  if (!userId || !companyName) return [];

  const businessDescription = sanitizeProfessionalIdentityText(
    business.business_description,
    companyName,
  );
  const patch: JsonRow = {};
  if (businessDescription !== String(business.business_description || "")) {
    patch.business_description = businessDescription;
  }
  return Object.keys(patch).length ? [{ userId, patch }] : [];
});

const memoryRepairs = memories.flatMap((row) => {
  const accountId = String(row.account_id || "").trim();
  const companyName = companyNames.get(accountId) || "";
  if (!accountId || !companyName) return [];
  const memory = sanitizeProfessionalIdentityValue(row.memory, companyName);
  return JSON.stringify(memory) !== JSON.stringify(row.memory)
    ? [{ accountId, memory }]
    : [];
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  scanned: {
    profiles: profiles.length,
    businessProfiles: businesses.length,
    aiMemories: memories.length,
  },
  repairs: {
    businessProfiles: businessRepairs.length,
    aiMemories: memoryRepairs.length,
  },
}, null, 2));

if (apply) {
  for (const repair of businessRepairs) {
    const { error } = await supabase
      .from("business_profiles")
      .update({ ...repair.patch, updated_at: new Date().toISOString() })
      .eq("user_id", repair.userId);
    if (error) throw error;
  }

  for (const repair of memoryRepairs) {
    const { error } = await supabase
      .from("business_ai_memories")
      .update({ memory: repair.memory })
      .eq("account_id", repair.accountId);
    if (error) throw error;
  }

  console.log(JSON.stringify({
    applied: true,
    businessProfiles: businessRepairs.length,
    aiMemories: memoryRepairs.length,
  }));
}
