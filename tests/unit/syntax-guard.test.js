// Verifie le garde-fou SYNTAX (scripts/audit/syntax.js).
//
// Contexte : de la v9.104 a la v9.107, index.html contenait deux caracteres
// LITTERAUX U+2028 / U+2029 dans une classe de regex. Ce sont des terminateurs
// de ligne en JS -> "Invalid regular expression: missing /" -> le <script>
// inline entier est rejete au parse -> ecran noir total en production.
// Ces tests tournent sur des fixtures temporaires, jamais sur le vrai index.html.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkSyntax } from '../../scripts/audit/syntax.js';

const LS = ' '; // LINE SEPARATOR
const PS = ' '; // PARAGRAPH SEPARATOR

const page = (script) => `<!doctype html><html><head>
<script>${script}</script>
</head><body></body></html>`;

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lokizio-syntax-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('garde-fou SYNTAX', () => {
  it('accepte un index.html sain', async () => {
    writeFileSync(join(root, 'index.html'), page(`
      function _jsAttr(s) { return String(s).replace(/[\\r\\n\\u2028\\u2029]+/g, ' '); }
    `));
    const r = await checkSyntax({ root });
    expect(r.status).toBe('pass');
    expect(r.metrics.errors).toBe(0);
  });

  it('rejette le bug exact de la v9.104 (U+2028/U+2029 dans une regex inline)', async () => {
    writeFileSync(join(root, 'index.html'), page(`
      function _jsAttr(s) { return String(s).replace(/[\\r\\n${LS}${PS}]+/g, ' '); }
    `));
    const r = await checkSyntax({ root });
    expect(r.status).toBe('fail');
    expect(r.details).toMatch(/Invalid regular expression/);
    expect(r.details).toMatch(/index\.html/);
  });

  it('rejette une erreur de syntaxe ordinaire dans un script inline', async () => {
    writeFileSync(join(root, 'index.html'), page('function boom( { return 1; }'));
    const r = await checkSyntax({ root });
    expect(r.status).toBe('fail');
    expect(r.metrics.errors).toBe(1);
  });

  it('rejette une erreur de syntaxe dans un fichier .js', async () => {
    writeFileSync(join(root, 'index.html'), page('var ok = 1;'));
    writeFileSync(join(root, 'broken.js'), 'const x = ;');
    const r = await checkSyntax({ root });
    expect(r.status).toBe('fail');
    expect(r.details).toMatch(/broken\.js/);
  });

  it('ignore le JSON-LD et les blocs non-JS', async () => {
    writeFileSync(join(root, 'index.html'),
      `<!doctype html><html><head>
       <script type="application/ld+json">{"@context":"https://schema.org"}</script>
       </head><body></body></html>`);
    const r = await checkSyntax({ root });
    expect(r.status).toBe('pass');
  });

  it('ne signale pas les invisibles legitimes (emoji ZWJ, BOM de CSV)', async () => {
    writeFileSync(join(root, 'index.html'), page(`
      var chef = '\u{1F468}‍\u{1F373}';
      var csv = '﻿' + 'col1,col2';
    `));
    const r = await checkSyntax({ root });
    expect(r.status).toBe('pass');
    expect(r.metrics.invisibles).toBe(0);
  });

  it('signale un invisible dangereux qui parse quand meme (ZWSP dans une chaine)', async () => {
    writeFileSync(join(root, 'index.html'), page("var role = 'admin​';"));
    const r = await checkSyntax({ root });
    expect(r.status).toBe('warn');
    expect(r.metrics.invisibles).toBe(1);
  });
});
