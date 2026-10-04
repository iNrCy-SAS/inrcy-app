import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTxMail } from "@/lib/txMailer";
import { BOUTIQUE_PRICE_TAX_BEHAVIOR, boutiqueOrderAmounts, boutiqueOrderPriceLabel, findBoutiqueProduct } from "@/lib/boutique/products";
import { optionalEnv } from "@/lib/env";

// Ensure this route runs on the Node.js runtime (SMTP requires TCP sockets).
export const runtime = "nodejs";
// Avoid any accidental caching of POST responses in some hosting setups.
export const dynamic = "force-dynamic";

type ProfileContactRow = { contact_email?: string | null };
type LoyaltyBalanceRow = { balance?: number | null };
type BoutiqueOrderInsert = {
  user_id: string;
  account_email: string | null;
  admin_email: string | null;
  product_key: string;
  product_name: string;
  method: "EUR" | "UI";
  amount_eur: number | null;
  amount_eur_tax_behavior: "exclusive";
  amount_ui: number | null;
  status: string;
  idempotency_key: string | null;
};

type OrderBody = {
  productKey: string;
  method: "EUR" | "UI";
  idempotencyKey?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function asString(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request) {
  let body: OrderBody;
  try {
    body = (await req.json()) as OrderBody;
  } catch {
    return badRequest("Body JSON invalide.");
  }

  const productKey = asString(body?.productKey);
  const method = body?.method;
  const idempotencyKey = asString(body?.idempotencyKey) || asString(req.headers.get("x-idempotency-key"));

  if (!productKey) return badRequest("productKey manquant.");
  if (method !== "EUR" && method !== "UI") return badRequest("method invalide.");

  const product = findBoutiqueProduct(productKey);
  if (!product) return badRequest("Produit inconnu.");

  const supabase = await createSupabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  }

  const user = userData.user;
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  // Admin email = email pro renseigné dans le profil (si dispo)
  const [profileRes, balanceRes] = await Promise.all([
    supabase.from("profiles").select("contact_email").eq("user_id", activeUserId).maybeSingle(),
    supabase.from("loyalty_balance").select("balance").eq("user_id", activeUserId).maybeSingle(),
  ]);

  const profileData = (profileRes.data ?? null) as ProfileContactRow | null;
  const balanceData = (balanceRes.data ?? null) as LoyaltyBalanceRow | null;
  const adminEmail = asString(profileData?.contact_email) || null;
  const uiBalanceRaw = Number(balanceData?.balance ?? 0);
  const uiBalance = Number.isFinite(uiBalanceRaw) ? uiBalanceRaw : 0;

  // UI orders must have sufficient balance (server-side guard)
  if (method === "UI" && uiBalance < product.priceUi) {
    return NextResponse.json(
      { ok: false, error: "Solde UI insuffisant pour cette commande." },
      { status: 400 }
    );
  }

  // Idempotency: prevent double-click duplicates.
  if (idempotencyKey) {
    const { data: existing, error: existErr } = await supabaseAdmin
      .from("boutique_orders")
      .select("id,status")
      .eq("user_id", activeUserId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (!existErr && existing?.id) {
      return NextResponse.json({ ok: true, orderId: existing.id, status: existing.status, deduped: true });
    }
  }

  // Insert order row first (safety/audit). Use service role to avoid any RLS friction.
  const orderAmounts = boutiqueOrderAmounts(product, method);
  const insertPayload: BoutiqueOrderInsert = {
    user_id: activeUserId,
    account_email: user.email ?? null,
    admin_email: adminEmail,
    product_key: product.key,
    product_name: product.title,
    method,
    amount_eur: orderAmounts.amountEurHt,
    amount_eur_tax_behavior: BOUTIQUE_PRICE_TAX_BEHAVIOR,
    amount_ui: orderAmounts.amountUi,
    status: "pending",
    idempotency_key: idempotencyKey || null,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("boutique_orders")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr || !inserted?.id) {
    console.error("[boutique/order] insert failed:", insErr);
    return NextResponse.json({ ok: false, error: "Impossible de créer la commande." }, { status: 500 });
  }

  const orderId = inserted.id as string;

  // Recipient for boutique orders (configurable via env)
  const boutiqueTo = optionalEnv("BOUTIQUE_EMAIL", "boutique@inrcy.com");

  const subject = `Commande Boutique iNrCy #${orderId.slice(0, 8)} — ${product.title} (${method === "EUR" ? "€" : "UI"})`;

  const commonLines = [
    `Commande : #${orderId}`,
    `Produit : ${product.title} (${product.key})`,
    `Mode : ${method === "EUR" ? "€" : "UI"}`,
    `Prix : ${boutiqueOrderPriceLabel(product, method)}`,
    ``,
    `Compte :`,
    `- Email compte (auth) : ${user.email ?? "(non disponible)"}`,
    `- Email admin (profil) : ${adminEmail ?? "(non disponible)"}`,
    `- Établissement ID : ${activeUserId}`,
    `- Solde UI (indicatif) : ${uiBalance}`,
  ];

  const boutiqueText = [
    `Bonjour,`,
    ``,
    `Nouvelle commande Boutique iNrCy :`,
    ...commonLines,
    ``,
    `Merci de traiter la commande et de passer le statut à "Traitée" dans Supabase lorsque c'est fait.`,
    ``,
    `Envoyé automatiquement depuis l'application iNrCy.`,
  ].join("\n");

  const clientText = [
    `Bonjour,`,
    ``,
    `Nous avons bien reçu votre demande de commande iNrCy.`,
    ``,
    ...commonLines,
    ``,
    `Statut : En cours`,
    ``,
    `Vous recevrez un message lorsque la commande sera traitée.`,
    ``,
    `— L'équipe iNrCy`,
  ].join("\n");

  let boutiqueSent = false;
  let clientSent = false;
  let lastError: string | null = null;

  try {
    await sendTxMail({
      to: boutiqueTo,
      subject,
      text: boutiqueText,
    });
    boutiqueSent = true;

    // Confirmation client (best effort)
    if (user.email) {
      await sendTxMail({
        to: user.email,
        subject: `Confirmation de commande iNrCy #${orderId.slice(0, 8)}`,
        text: clientText,
      });
      clientSent = true;
    }
  } catch (e: unknown) {
    lastError = e instanceof Error ? e.message : String(e);
    console.error("[boutique/order] sendTxMail failed:", lastError, e);
  }

  // Update order row with mail status (never throws to client)
  await supabaseAdmin
    .from("boutique_orders")
    .update({
      boutique_email_sent: boutiqueSent,
      client_email_sent: clientSent,
      last_error: lastError,
    })
    .eq("id", orderId);

  // If boutique mail failed, the order still exists (audit), but we tell the user.
  if (!boutiqueSent) {
      return NextResponse.json(
      {
        ok: false,
        orderId,
        error: "La commande a bien été enregistrée, mais son envoi par email a échoué pour le moment. Notre équipe peut tout de même la retrouver.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, orderId });
}
