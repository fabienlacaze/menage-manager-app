// SYNTAX checker - parse REELLEMENT tout le JS qui part en production.
//
// Pourquoi ce checker existe (v9.108) : la v9.104 a introduit deux caracteres
// LITTERAUX U+2028 / U+2029 dans une classe de regex d'index.html - l'auteur
// voulait ecrire les echappements \u2028 \u2029 et a insere les vrais
// caracteres. En JS, U+2028 et U+2029 SONT des terminateurs de ligne : une
// regex litterale ne peut pas en contenir -> "Invalid regular expression:
// missing /" -> le <script> inline entier est rejete au parse -> ecran noir en
// production pendant 3 versions (9.104 -> 9.107).
//
// Le checker LINT ne lit que des lignes a coups de regex, et seulement les .js :
// il ne voyait ni l'erreur de syntaxe, ni index.html ou vit l'essentiel du code.
// Ici on demande au moteur JS lui-meme de parser chaque script, inline compris.
//
// REGLE : ce fichier reste en ASCII pur (echappements \uXXXX uniquement),
// sinon il se casse exactement comme le bug qu'il traque.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { listJsFiles } from './_util.js';

// Caracteres qui cassent (ou peuvent casser) un parse JS sans etre visibles a
// l'oeil nu dans un editeur.
const INVISIBLE = /[\u2028\u2029\ufeff\u200b-\u200d\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const NAMES = {
  '\u2028': 'U+2028 LINE SEPARATOR',
  '\u2029': 'U+2029 PARAGRAPH SEPARATOR',
  '\ufeff': 'U+FEFF BOM / ZWNBSP',
  '\u200b': 'U+200B ZERO WIDTH SPACE',
  '\u200c': 'U+200C ZERO WIDTH NON-JOINER',
  '\u200d': 'U+200D ZERO WIDTH JOINER',
};
const charName = (ch) =>
  NAMES[ch] || 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

// HTML dont on veut parser les <script> inline.
const HTML_FILES = ['index.html', 'privacy.html', 'legal.html', 'terms.html', 'offline.html'];
// .js hors du filtre de listJsFiles mais bel et bien servis au navigateur.
const EXTRA_JS = ['sw.js', 'supabase_config.js', 'app.bundle.min.js'];

// Parse un bout de code comme le ferait le navigateur pour un <script> classique.
// Repli pour les rares fichiers a import/export (vm.Script les refuse par nature).
function parseError(code, filename) {
  try {
    new vm.Script(code, { filename });
    return null;
  } catch (err) {
    if (/import statement|Unexpected token 'export'|import\.meta|await is only valid/.test(err.message)) {
      try {
        new vm.Script('async function __m(){' + code + '\n}', { filename });
        return null; // module-ish mais syntaxiquement sain
      } catch { /* on conserve l'erreur d'origine */ }
    }
    return err.message;
  }
}

// Numero de ligne 1-based en comptant \n, \r, U+2028 et U+2029 : c'est ce que
// fait le navigateur, donc les numeros collent a ceux de la console DevTools.
function lineOf(text, offset) {
  return text.slice(0, offset).split(/\r\n|\r|\n|\u2028|\u2029/).length;
}

// Deux usages LEGITIMES d'invisibles dans ce projet - les signaler en
// permanence rendrait l'alerte inutile (on finit par ne plus la lire) :
//   - U+200D / U+200C entre deux pictogrammes = emoji compose ("\u200d" dans
//     un chef "\ud83d\udc68\u200d\ud83c\udf73") ;
//   - U+FEFF juste apres un guillemet ouvrant = BOM volontaire en tete d'un CSV
//     genere, sans lequel Excel affiche les accents de travers.
const PICTO = /\p{Extended_Pictographic}/u;
function isBenign(text, index, ch) {
  if (ch === '\u200d' || ch === '\u200c') {
    return PICTO.test(text.slice(Math.max(0, index - 2), index))
        && PICTO.test(text.slice(index + 1, index + 3));
  }
  if (ch === '\ufeff') return /['"`]$/.test(text.slice(Math.max(0, index - 1), index));
  return false;
}

export async function checkSyntax({ root }) {
  const errors = [];
  const invisibles = [];
  let parsed = 0;

  const scanInvisible = (text, label) => {
    for (const m of text.matchAll(INVISIBLE)) {
      if (m.index === 0 && m[0] === '\ufeff') continue; // BOM en tete de fichier : tolere
      if (isBenign(text, m.index, m[0])) continue;
      invisibles.push({ where: label + ':' + lineOf(text, m.index), char: charName(m[0]) });
    }
  };

  const seen = new Set();
  const jsFiles = [...listJsFiles(root), ...EXTRA_JS.map((f) => join(root, f))];

  for (const file of jsFiles) {
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    let code;
    try { code = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = file.replace(root, '').replace(/^[\\/]/, '').replaceAll('\\', '/');
    parsed++;

    const msg = parseError(code, rel);
    if (msg) errors.push({ where: rel, msg });
    scanInvisible(code, rel);
  }

  for (const name of HTML_FILES) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    let html;
    try { html = readFileSync(file, 'utf8'); } catch { continue; }

    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1] || '';
      if (/\bsrc\s*=/i.test(attrs)) continue; // fichier externe : deja parse plus haut
      const type = (attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || 'text/javascript';
      if (!/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue; // json-ld, templates...

      const startLine = lineOf(html, m.index + m[0].indexOf('>') + 1);
      parsed++;
      const msg = parseError(m[2] || '', name + ' (inline @L' + startLine + ')');
      if (msg) errors.push({ where: name + ':' + startLine + ' (inline)', msg });
    }

    scanInvisible(html, name);
  }

  const details = [
    ...errors.map((e) => 'SYNTAX ' + e.where + ' - ' + e.msg),
    ...invisibles.map((i) => 'INVISIBLE ' + i.where + ' - ' + i.char),
  ].join('\n');

  if (errors.length) {
    return {
      status: 'fail',
      message: errors.length + ' script(s) ne parsent PAS - ecran noir garanti (' + parsed + ' parses)',
      metrics: { parsed, errors: errors.length, invisibles: invisibles.length },
      details,
    };
  }
  if (invisibles.length) {
    return {
      status: 'warn',
      message: parsed + ' scripts OK, mais ' + invisibles.length + ' caractere(s) invisible(s)',
      metrics: { parsed, errors: 0, invisibles: invisibles.length },
      details,
    };
  }
  return {
    status: 'pass',
    message: parsed + ' scripts parses (inline + fichiers) - aucune erreur de syntaxe',
    metrics: { parsed, errors: 0, invisibles: 0 },
    details: '',
  };
}
