// Photo consent banner — RGPD art. 6 (consent base).
// Exposes:
//   window.requirePhotoConsent(context)  — Promise<boolean>  (must be true before upload)
//   window.checkActivePhotoConsent(context)  — quick cache check
//
// Once given, consent is stored in public.photo_consents with policy_version,
// IP and user_agent for forensics. Users can withdraw at any time via Mon
// compte > Mes consentements (window.showMyConsents / window.withdrawPhotoConsent).

(function () {
  const CONSENT_CACHE_KEY = 'lokizio_photo_consent_';
  const POLICY_VERSION = (window && window.APP_VERSION) ? ('v' + window.APP_VERSION) : 'v9.76';

  async function checkActivePhotoConsent(context) {
    try {
      // Fast cache check first (avoids DB round-trip on every upload)
      const cached = localStorage.getItem(CONSENT_CACHE_KEY + context);
      if (cached === '1') return true;
      // Authoritative check
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return false;
      const { data, error } = await sb.from('photo_consents')
        .select('id')
        .eq('user_id', user.id)
        .eq('context', context)
        .is('withdrawn_at', null)
        .limit(1)
        .maybeSingle();
      if (error) { console.warn('photo_consents check:', error); return false; }
      if (data) {
        localStorage.setItem(CONSENT_CACHE_KEY + context, '1');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('checkActivePhotoConsent:', e);
      return false;
    }
  }

  // Show the consent modal and resolve with true on accept, false on refuse.
  async function requirePhotoConsent(context) {
    const has = await checkActivePhotoConsent(context);
    if (has) return true;

    const contextLabels = {
      cleaning_qc: 'Photos de controle qualite (preuve de prestation menage)',
      profile_avatar: 'Photo de profil',
      property_listing: 'Photos d\'un bien',
      marketplace_profile: 'Photos de profil annuaire',
    };
    const contextLabel = contextLabels[context] || 'photos';

    return new Promise(resolve => {
      let html = '<div style="padding:6px;max-width:520px;width:90vw;">';
      html += '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px;">&#128247; Consentement photo</div>';
      html += '<div style="font-size:11px;color:var(--text3);margin-bottom:14px;line-height:1.5;">Avant d\'uploader, on a besoin de ton accord explicite. Conformement au RGPD (art. 6, base juridique = consentement).</div>';

      html += '<div style="background:rgba(108,99,255,0.10);border:1px solid rgba(108,99,255,0.30);border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--text2);line-height:1.6;">';
      html += '<div style="font-weight:700;color:var(--text);margin-bottom:6px;">Type de photos</div>';
      html += '<div>' + esc(contextLabel) + '</div>';
      html += '</div>';

      html += '<div style="font-size:11px;color:var(--text3);line-height:1.6;margin-bottom:14px;">';
      html += '<div style="font-weight:700;color:var(--text2);margin-bottom:4px;">&#128737; Tes droits</div>';
      html += '• <b>Acces / suppression</b> : Mon compte > Mes donnees<br>';
      html += '• <b>Retrait du consentement</b> : Mon compte > Mes consentements<br>';
      html += '• <b>Conservation</b> : 3 ans ou jusqu\'au retrait<br>';
      html += '• <b>Destinataires</b> : uniquement les membres de ton organisation et les clients destinataires des prestations<br>';
      html += '• <b>Hebergement</b> : Supabase (region UE). Un acces depuis les Etats-Unis par Supabase Inc. reste possible, encadre par les Clauses Contractuelles Types (voir privacy.html)';
      html += '</div>';

      html += '<div style="font-size:10px;color:var(--text3);line-height:1.5;margin-bottom:14px;padding:8px 10px;background:var(--surface2);border-radius:6px;">';
      html += 'Politique complete: <a href="/lokizio/privacy.html" target="_blank" style="color:var(--accent2);">privacy.html</a>';
      html += '</div>';

      html += '<div style="display:flex;gap:8px;">';
      html += '<button class="btn btnOutline" style="flex:1;padding:11px;" onclick="window._pcResolve(false)">Refuser</button>';
      html += '<button class="btn btnPrimary" style="flex:1;padding:11px;font-weight:700;" onclick="window._pcResolve(true,\'' + esc(context) + '\')">&#10003; J\'accepte</button>';
      html += '</div>';
      html += '</div>';
      showMsg(html, true);

      window._pcResolve = async function (accepted, ctxIfAccepted) {
        closeMsg();
        if (!accepted) { resolve(false); return; }
        try {
          const { data: { user } } = await sb.auth.getUser();
          if (!user) { resolve(false); return; }
          await sb.from('photo_consents').insert({
            user_id: user.id,
            context: ctxIfAccepted,
            user_agent: navigator.userAgent.slice(0, 200),
            policy_version: POLICY_VERSION,
          });
          localStorage.setItem(CONSENT_CACHE_KEY + ctxIfAccepted, '1');
          resolve(true);
        } catch (e) {
          console.error('photo consent persist:', e);
          // Still resolve true — we don't want to break the UX if logging fails.
          resolve(true);
        }
      };
    });
  }

  // ── Retrait du consentement (RGPD art. 7.3 : aussi simple que le recueil) ──
  const CONTEXT_LABELS = {
    cleaning_qc: 'Photos de controle qualite (preuve de prestation menage)',
    profile_avatar: 'Photo de profil',
    property_listing: 'Photos d\'un bien',
    marketplace_profile: 'Photos de profil annuaire',
  };

  // Withdraw all active photo consents for a given context.
  // Sets withdrawn_at = now() (append-only proof kept) and invalidates the local cache.
  // NB: does NOT delete existing photo files (proof-of-service photos may belong to the
  // org/clients or be legally useful). Withdrawal stops any NEW upload requiring consent;
  // existing files are removed via "Supprimer mon compte" or the storage cleanup path.
  async function withdrawPhotoConsent(context) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { if (typeof showToast === 'function') showToast('Non connecte'); return false; }
      const { error } = await sb.from('photo_consents')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('context', context)
        .is('withdrawn_at', null);
      if (error) { console.error('withdrawPhotoConsent:', error); if (typeof showToast === 'function') showToast('Erreur: ' + error.message); return false; }
      localStorage.removeItem(CONSENT_CACHE_KEY + context);
      if (typeof showToast === 'function') showToast('Consentement retire');
      return true;
    } catch (e) {
      console.error('withdrawPhotoConsent:', e);
      if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || e));
      return false;
    }
  }

  // "Mon compte > Mes consentements" — list active/withdrawn photo consents + RGPD acceptance proof.
  async function showMyConsents() {
    if (typeof showToast === 'function') showToast('Chargement de vos consentements...');
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { if (typeof showToast === 'function') showToast('Non connecte'); return; }

      const [{ data: photos }, rgpdRes] = await Promise.all([
        sb.from('photo_consents').select('*').eq('user_id', user.id).order('given_at', { ascending: false }),
        sb.from('rgpd_consents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      const rgpd = (rgpdRes && rgpdRes.data) || [];

      // Keep only the most relevant row per context (active preferred, else latest).
      const byContext = {};
      (photos || []).forEach(p => {
        const cur = byContext[p.context];
        if (!cur) { byContext[p.context] = p; return; }
        const pActive = !p.withdrawn_at, curActive = !cur.withdrawn_at;
        if (pActive && !curActive) byContext[p.context] = p;
      });

      let html = '<div style="padding:6px;max-width:560px;width:90vw;max-height:84vh;overflow:auto;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
      html += '<div style="font-size:16px;font-weight:700;color:var(--accent);">&#128737; Mes consentements</div>';
      html += '<button class="btn btnSmall btnOutline" style="padding:6px 12px;font-size:11px;" onclick="closeMsg()">Fermer</button>';
      html += '</div>';
      html += '<div style="font-size:11px;color:var(--text3);line-height:1.5;margin-bottom:14px;padding:10px;background:rgba(108,99,255,0.08);border-radius:8px;">Retirer un consentement est possible a tout moment (RGPD art. 7.3), sans affecter la liceite du traitement anterieur. Le retrait empeche toute nouvelle utilisation ; les fichiers deja envoyes se suppriment via <b>Supprimer mon compte</b>.</div>';

      // ── Photo consents ──
      html += '<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">&#128247; Consentements photo</div>';
      const ctxKeys = Object.keys(byContext);
      if (!ctxKeys.length) {
        html += '<div style="font-size:12px;color:var(--text3);padding:12px;background:var(--surface2);border-radius:8px;margin-bottom:14px;">Aucun consentement photo enregistre.</div>';
      } else {
        ctxKeys.forEach(ctx => {
          const p = byContext[ctx];
          const active = !p.withdrawn_at;
          const label = CONTEXT_LABELS[ctx] || ctx;
          const when = p.given_at ? new Date(p.given_at).toLocaleDateString('fr-FR') : '';
          html += '<div style="padding:11px 12px;margin-bottom:8px;background:var(--surface2);border-left:3px solid ' + (active ? '#34d399' : '#94a3b8') + ';border-radius:6px;">';
          html += '<div style="display:flex;align-items:center;gap:8px;">';
          html += '<div style="flex:1;min-width:0;">';
          html += '<div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(label) + '</div>';
          html += '<div style="font-size:10px;color:var(--text3);margin-top:2px;">' + (active ? ('Accorde le ' + esc(when)) : ('Retire le ' + esc(new Date(p.withdrawn_at).toLocaleDateString('fr-FR')))) + '</div>';
          html += '</div>';
          if (active) {
            html += '<button class="btn btnSmall btnOutline" style="padding:5px 10px;font-size:10px;flex-shrink:0;" onclick="window._withdrawConsent(\'' + esc(ctx) + '\')">Retirer</button>';
          } else {
            html += '<span style="font-size:10px;color:var(--text3);flex-shrink:0;">Retire</span>';
          }
          html += '</div></div>';
        });
      }

      // ── RGPD acceptance proof (read-only) ──
      html += '<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:14px 0 8px;">&#9878;&#65039; Acceptation CGU / Confidentialite</div>';
      if (!rgpd.length) {
        html += '<div style="font-size:12px;color:var(--text3);padding:12px;background:var(--surface2);border-radius:8px;">Aucune trace d\'acceptation enregistree.</div>';
      } else {
        rgpd.forEach(r => {
          const when = r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '';
          html += '<div style="padding:10px 12px;margin-bottom:6px;background:var(--surface2);border-radius:6px;font-size:11px;color:var(--text2);line-height:1.5;">';
          html += '<div><b>' + esc(r.consent_type || 'Consentement') + '</b> &middot; ' + esc(when) + '</div>';
          html += '<div style="font-size:10px;color:var(--text3);">CGU ' + esc(r.cgu_version || '?') + ' &middot; Confidentialite ' + esc(r.privacy_version || '?') + '</div>';
          html += '</div>';
        });
        html += '<div style="font-size:10px;color:var(--text3);margin-top:4px;line-height:1.4;">L\'acceptation des CGU/Confidentialite est necessaire a l\'utilisation du service (base contractuelle) : elle se conserve comme preuve et se leve en supprimant le compte.</div>';
      }

      html += '</div>';
      showMsg(html, true);
    } catch (e) {
      console.error('showMyConsents:', e);
      if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || e));
    }
  }

  window._withdrawConsent = async function (ctx) {
    const label = CONTEXT_LABELS[ctx] || ctx;
    const ok = await customConfirm('Retirer votre consentement pour : <b>' + esc(label) + '</b> ?<br><br>Aucune nouvelle photo de ce type ne pourra etre demandee sans un nouvel accord.', 'Retirer');
    if (!ok) return;
    const done = await withdrawPhotoConsent(ctx);
    if (done) setTimeout(showMyConsents, 300);
  };

  window.requirePhotoConsent = requirePhotoConsent;
  window.checkActivePhotoConsent = checkActivePhotoConsent;
  window.withdrawPhotoConsent = withdrawPhotoConsent;
  window.showMyConsents = showMyConsents;
})();
