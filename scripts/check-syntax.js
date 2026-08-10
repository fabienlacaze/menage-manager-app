#!/usr/bin/env node
// Garde-fou pre-push : verifie que TOUT le JS servi au navigateur parse.
// Une erreur de syntaxe dans un <script> inline d'index.html = ecran noir total
// (le bloc entier est rejete au parse). C'est arrive de la v9.104 a la v9.107.
//
// Usage :  npm run syntax:check     (~1s, a lancer avant chaque push)

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSyntax } from './audit/syntax.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = await checkSyntax({ root });

console.log(`[SYNTAX] ${r.message}`);
if (r.details) console.log(r.details);

if (r.status === 'fail') {
  console.error('\nNE PAS PUSHER : l\'application sera un ecran noir.');
  process.exit(1);
}
process.exit(0);
