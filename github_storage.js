/**
 * github_storage.js - Persist JSON data to GitHub repo (data-store branch)
 * Uses GitHub Contents API with a PAT. Runs entirely in the browser.
 */

const GitHubStorage = (function() {
  const REPO = 'fabienlacaze/menage-manager';
  const BRANCH = 'data-store';
  const API_BASE = `https://api.github.com/repos/${REPO}/contents`;

  // SHA cache for updates
  const shas = {};

  function getPAT() {
    return localStorage.getItem('mm_github_pat') || '';
  }

  function headers() {
    return {
      'Authorization': `token ${getPAT()}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'MenageManager/2.0'
    };
  }

  async function read(filename) {
    const pat = getPAT();
    if (!pat) return null;
    try {
      const resp = await fetch(`${API_BASE}/${filename}?ref=${BRANCH}`, { headers: headers() });
      if (!resp.ok) return null;
      const info = await resp.json();
      shas[filename] = info.sha;
      const content = atob(info.content.replace(/\n/g, ''));
      // Handle UTF-8 properly
      const bytes = Uint8Array.from(content, c => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    } catch (e) {
      console.warn(`GitHub read ${filename}:`, e);
      return null;
    }
  }

  async function write(filename, data) {
    const pat = getPAT();
    if (!pat) return null;
    try {
      // Encode to base64 with UTF-8 support
      const text = JSON.stringify(data, null, 2);
      const bytes = new TextEncoder().encode(text);
      const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
      const contentB64 = btoa(binary);

      const body = {
        message: `auto: update ${filename}`,
        content: contentB64,
        branch: BRANCH
      };
      if (shas[filename]) body.sha = shas[filename];

      const resp = await fetch(`${API_BASE}/${filename}`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        // If conflict (sha mismatch), re-read and retry once
        if (resp.status === 409 || resp.status === 422) {
          const current = await read(filename);
          if (shas[filename]) {
            body.sha = shas[filename];
            const resp2 = await fetch(`${API_BASE}/${filename}`, {
              method: 'PUT',
              headers: { ...headers(), 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (resp2.ok) {
              const result = await resp2.json();
              shas[filename] = result.content.sha;
              return result;
            }
          }
        }
        console.warn(`GitHub write ${filename}: HTTP ${resp.status}`);
        return null;
      }

      const result = await resp.json();
      shas[filename] = result.content.sha;
      return result;
    } catch (e) {
      console.warn(`GitHub write ${filename}:`, e);
      return null;
    }
  }

  function hasPAT() {
    return !!getPAT();
  }

  function setPAT(pat) {
    localStorage.setItem('mm_github_pat', pat);
  }

  return { read, write, hasPAT, setPAT, getPAT };
})();
