// Legal & RGPD module
// Depends on globals: sb, API, customConfirm, showMsg, closeMsg, showToast
// Exposes: showLegalSettingsModal, saveLegalSettings, exportMyData

async function showLegalSettingsModal() {
  try {
    const { data: s } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
    const v = s || {};
    const fields = [
      ['company_name', 'Nom / Raison sociale', 'ex. Fabien Lacaze, ou ACME SAS'],
      ['legal_status', 'Statut juridique', 'ex. Micro-entrepreneur'],
      ['siret', 'SIRET', '14 chiffres'],
      ['tva_number', 'N° TVA intracom', 'Optionnel'],
      ['address', t('legal.address.label'), 'Rue, code postal, ville'],
      ['director_name', 'Directeur publication', 'Nom prenom'],
      ['contact_email', t('legal.rgpd_email.label'), 'rgpd@...'],
      ['mediator', 'Mediateur agreé (CGV)', 'ex. CNPM Mediation Consommation'],
      ['price_pro', 'Prix Pro / mois (€)', '9'],
      ['price_business', 'Prix Business / mois (€)', '19'],
    ];
    let h = '<div style="font-size:15px;font-weight:700;margin-bottom:8px;">&#9878;&#65039; Informations legales</div>';
    h += '<div style="font-size:11px;color:var(--text3);margin-bottom:12px;">Ces informations apparaitront dans les pages Mentions, CGU, CGV, Privacy automatiquement.</div>';
    h += '<div style="display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;">';
    fields.forEach(([k, label, placeholder]) => {
      const val = v[k] == null ? '' : v[k];
      const isNum = k.startsWith('price_');
      h += '<div><label style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px;">' + label + '</label>';
      h += '<input id="ls_' + k + '" type="' + (isNum ? 'number' : 'text') + '"' + (isNum ? ' step="0.01"' : '') + ' value="' + String(val).replace(/"/g, '&quot;') + '" placeholder="' + placeholder + '" style="width:100%;padding:8px;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:6px;font-size:13px;box-sizing:border-box;"></div>';
    });
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btnOutline" style="flex:1;padding:10px;" onclick="closeMsg()">Annuler</button>';
    h += '<button class="btn btnPrimary" style="flex:1;padding:10px;" onclick="saveLegalSettings()">&#128190; Enregistrer</button>';
    h += '</div>';
    showMsg(h, true);
  } catch(e) { console.error(e); showToast('Erreur: ' + e.message); }
}

async function saveLegalSettings() {
  const payload = { id: 1, updated_at: new Date().toISOString() };
  ['company_name','legal_status','siret','tva_number','address','director_name','contact_email','mediator'].forEach(k => {
    const el = document.getElementById('ls_' + k);
    if (el) payload[k] = (el.value || '').trim() || null;
  });
  ['price_pro','price_business'].forEach(k => {
    const el = document.getElementById('ls_' + k);
    if (el) payload[k] = el.value ? parseFloat(el.value) : null;
  });
  const { error } = await sb.from('app_settings').upsert(payload, { onConflict: 'id' });
  if (error) { showToast('Erreur: ' + error.message); return; }
  closeMsg();
  showToast('Informations legales sauvegardees');
}

async function exportMyData() {
  const ok = await customConfirm('Telecharger toutes vos donnees personnelles (format JSON) ? Cet export respecte le droit a la portabilite RGPD (art. 20).', 'Exporter');
  if (!ok) return;
  showToast('Preparation de l\'export...');
  try {
    const user = (await sb.auth.getUser()).data.user;
    if (!user) return;
    const org = API.getOrg();
    const orgId = org?.id;
    const dataset = { exported_at: new Date().toISOString(), user_id: user.id, email: user.email };

    // Toutes les tables susceptibles de contenir des donnees personnelles du sujet.
    // NB: chaque SELECT reste borne par la RLS Postgres (l'utilisateur ne voit que ses lignes).
    // Les consentements (photo_consents, rgpd_consents) sont inclus — art. 15 (acces complet).
    const tables = ['members','marketplace_profiles','organizations','properties','invoices','billing_settings','billing_runs','service_requests','plannings','cleaning_validations','connection_requests','messages','push_subscriptions','email_log','subscriptions','user_data','profiles','reviews','user_feedback','photo_consents','rgpd_consents','provider_charter_signatures','provider_kyc_documents'];
    const incompleteSections = [];
    for (const t of tables) {
      try {
        const { data, error } = await sb.from(t).select('*').limit(5000);
        if (error) { dataset[t] = { error: error.message }; incompleteSections.push(t); }
        else { dataset[t] = data || []; }
      } catch(e) { dataset[t] = { error: String(e.message || e) }; incompleteSections.push(t); }
    }
    // Signaler explicitement a l'utilisateur toute section non exportee (art. 15 : export exact).
    if (incompleteSections.length) {
      dataset._sections_incompletes = incompleteSections;
      dataset._avertissement = 'Certaines sections n\'ont pas pu etre exportees (droits d\'acces / RLS). Pour un export exhaustif garanti, contactez l\'editeur via la politique de confidentialite.';
    }

    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lokizio-export-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(incompleteSections.length
      ? ('Export telecharge (' + incompleteSections.length + ' section(s) incomplete(s) — voir _avertissement dans le fichier)')
      : 'Export telecharge');
  } catch(e) { console.error('exportMyData:', e); showToast('Erreur: ' + (e.message || String(e))); }
}

// Export to window
window.showLegalSettingsModal = showLegalSettingsModal;
window.saveLegalSettings = saveLegalSettings;
window.exportMyData = exportMyData;
