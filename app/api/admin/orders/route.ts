import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminSecurity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type OrderStatus = "pending" | "processed";
type OrderMethod = "EUR" | "UI";

const ORDER_SELECT =
  "id,created_at,user_id,account_email,admin_email,product_key,product_name,method,amount_eur,amount_eur_tax_behavior,amount_ui,status";

function cleanSearch(value: string | null) {
  return String(value || "")
    .trim()
    .replaceAll(",", " ")
    .slice(0, 120);
}

function cleanStatus(value: unknown): "all" | OrderStatus {
  return value === "pending" || value === "processed" ? value : "all";
}

function cleanMethod(value: unknown): "all" | OrderMethod {
  return value === "EUR" || value === "UI" ? value : "all";
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const status = cleanStatus(url.searchParams.get("status"));
  const method = cleanMethod(url.searchParams.get("method"));
  const q = cleanSearch(url.searchParams.get("q"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 500);

  let query = supabaseAdmin
    .from("boutique_orders")
    .select(ORDER_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);
  if (method !== "all") query = query.eq("method", method);
  if (q) {
    query = query.or(
      `account_email.ilike.%${q}%,admin_email.ilike.%${q}%,user_id.ilike.%${q}%,product_name.ilike.%${q}%,product_key.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Impossible de charger les commandes." },
      { status: 500 }
    );
  }

  return NextResponse.json({ orders: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body?.id || "").trim();
  const status = cleanStatus(body?.status);

  if (!id) {
    return NextResponse.json({ error: "Commande introuvable." }, { status: 400 });
  }
  if (status === "all") {
    return NextResponse.json({ error: "Statut invalide." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("boutique_orders")
    .update({ status })
    .eq("id", id)
    .select(ORDER_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Impossible de mettre à jour la commande." },
      { status: 500 }
    );
  }

  return NextResponse.json({ order: data });
}
