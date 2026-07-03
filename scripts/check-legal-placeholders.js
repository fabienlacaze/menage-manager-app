#!/usr/bin/env node
/**
 * Garde-fou legal (audit commercialisation) — echoue si une page legale publique
 * contient encore un placeholder [A COMPLETER]. A lancer AVANT tout deploiement
 * commercial (et a brancher dans la CI une fois les mentions reellement remplies).
 *
 * Usage: node scripts/check-legal-placeholders.js   (npm run legal:check)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['cgu.html', 'cgv.html', 'mentions.html', 'privacy.html'];
const RE = /\[\s*[AÀ]\s*COMPL[EÉ]TER/i;

let fail = 0;
for (const p of PAGES) {
  const fp = join(root, p);
  if (!existsSync(fp)) { console.warn(`! page legale absente: ${p}`); continue; }
  readFileSync(fp, 'utf8').split(/\r?\n/).forEach((l, i) => {
    if (RE.test(l)) { console.error(`PLACEHOLDER  ${p}:${i + 1}  ${l.trim().slice(0, 90)}`); fail++; }
  });
}
if (fail > 0) {
  console.error(`\n${fail} placeholder(s) [A COMPLETER] dans les pages legales.`);
  console.error('NE PAS commercialiser tant qu elles ne sont pas remplies (identite editeur, SIRET, contact RGPD, mediateur...).');
  process.exit(1);
}
console.log('OK: aucune page legale avec placeholder [A COMPLETER].');
