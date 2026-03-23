/**
 * supabase_config.js - Supabase client initialization
 */
const SUPABASE_URL = 'https://mrvejwyvhuivmipfwlzz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AivB6qTeQWqmr-RliuMRiw_GJFNO_ha';

let supabaseClient;
try {
  const mod = window.supabase;
  supabaseClient = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Supabase client initialized', supabaseClient.auth ? 'with auth' : 'WITHOUT auth');
} catch (e) {
  console.error('Supabase init error:', e);
}
// Expose as global
const supabase = supabaseClient;
