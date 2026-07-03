import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCors(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || "";

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authHeader}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) throw new Error("Non authentifie: " + (authError?.message || "no user"));

    const { deleteData, cancelSubscription, stripeSubscriptionId } = await req.json();
    const userId = user.id;

    const headers = {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    // Best-effort helpers (RGPD art. 17 — droit a l'effacement).
    // Une table absente ou une ligne verrouillee ne doit PAS interrompre la suppression globale.
    const del = async (q: string) => {
      try { await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { method: "DELETE", headers }); }
      catch (_) { /* table peut ne pas exister dans cet environnement — on continue */ }
    };
    const patchNull = async (q: string, body: Record<string, unknown>) => {
      try { await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { method: "PATCH", headers, body: JSON.stringify(body) }); }
      catch (_) { /* on continue */ }
    };

    if (cancelSubscription && stripeSubscriptionId) {
      await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${STRIPE_SECRET}` },
      });
    }

    if (deleteData) {
      // ── (1) Donnees des organisations DONT l'utilisateur est proprietaire (owner) ──
      const orgResp = await fetch(`${SUPABASE_URL}/rest/v1/organizations?owner_id=eq.${userId}&select=id`, { headers });
      const orgs = await orgResp.json();

      for (const org of orgs) {
        await del(`messages?org_id=eq.${org.id}`);
        await del(`invoices?org_id=eq.${org.id}`);
        const propsResp = await fetch(`${SUPABASE_URL}/rest/v1/properties?org_id=eq.${org.id}&select=id`, { headers });
        const props = await propsResp.json();
        for (const prop of props) {
          await del(`cleaning_validations?property_id=eq.${prop.id}`);
          await del(`plannings?property_id=eq.${prop.id}`);
        }
        await del(`billing_runs?org_id=eq.${org.id}`);
        await del(`billing_settings?org_id=eq.${org.id}`);
        await del(`service_requests?org_id=eq.${org.id}`);
        await del(`properties?org_id=eq.${org.id}`);
        await del(`members?org_id=eq.${org.id}`);
        await del(`organizations?id=eq.${org.id}`);
      }

      // ── (2) Donnees personnelles du sujet, TOUS ROLES confondus (provider / tenant / membre) ──
      //     Ces tables n'etaient PAS couvertes auparavant => profils/photos/consentements/avis
      //     restaient orphelins apres suppression du compte auth (finding audit RGPD #2 / blocker #4).
      await del(`user_data?user_id=eq.${userId}`);
      await del(`subscriptions?user_id=eq.${userId}`);
      await del(`profiles?id=eq.${userId}`);
      await del(`marketplace_profiles?user_id=eq.${userId}`);
      await del(`photo_consents?user_id=eq.${userId}`);
      await del(`rgpd_consents?user_id=eq.${userId}`);
      await del(`push_subscriptions?user_id=eq.${userId}`);
      await del(`connection_requests?sender_id=eq.${userId}`);
      await del(`connection_requests?receiver_id=eq.${userId}`);
      await del(`provider_charter_signatures?user_id=eq.${userId}`);
      await del(`user_feedback?user_id=eq.${userId}`);
      await del(`reviews?provider_user_id=eq.${userId}`);
      await del(`billing_settings?user_id=eq.${userId}`);
      await del(`email_log?sender_id=eq.${userId}`);

      // ── (3) Anonymisation des donnees a CONSERVATION LEGALE (on ne supprime pas la ligne) ──
      //     Factures : conservation 10 ans (art. L123-22 C. commerce) — art. 17.3.b RGPD.
      //     On dissocie l'identite (created_by) sans detruire la piece comptable de l'org tierce.
      await patchNull(`invoices?created_by=eq.${userId}`, { created_by: null });
      //     Messages/demandes ou l'utilisateur intervient hors de ses propres orgs : on dissocie l'identite.
      await patchNull(`messages?sender_id=eq.${userId}`, { sender_id: null });
      await patchNull(`messages?recipient_user_id=eq.${userId}`, { recipient_user_id: null });
      await patchNull(`service_requests?assigned_provider_user_id=eq.${userId}`, { assigned_provider_user_id: null });
      await patchNull(`cleaning_validations?provider_user_id=eq.${userId}`, { provider_user_id: null });
      //     Signalements DSA : conserves pour la moderation, mais on dissocie l'identite du sujet.
      await patchNull(`profile_reports?reporter_user_id=eq.${userId}`, { reporter_user_id: null });
      await patchNull(`profile_reports?reported_user_id=eq.${userId}`, { reported_user_id: null });

      // ── (4) NON supprime volontairement (conservation legale, hors droit a l'effacement art. 17.3.b) ──
      //     provider_kyc_documents (10 ans anti-blanchiment), aml_alerts (LCB-FT/TRACFIN),
      //     audit_log (~5 ans, recommandation CNIL), security_incidents (preuve art. 33).
      //     Le sujet en est informe dans la politique de confidentialite (conservation legale).
    }

    // Garde-fou : neutraliser les FK sans ON DELETE (sinon la suppression du compte auth echoue).
    await patchNull(`security_incidents?reported_by=eq.${userId}`, { reported_by: null });
    await patchNull(`platform_config?updated_by=eq.${userId}`, { updated_by: null });

    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
