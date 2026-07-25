// ============================================================================
//  Config de Supabase.  Rellena con tu proyecto: Supabase > Settings > API.
//
//  La "anon public" key es PÚBLICA por diseño (va en apps cliente y está
//  protegida por RLS). NUNCA pongas aquí la clave "service_role".
// ============================================================================

export const SUPABASE_URL = 'https://qmdgbdgezlcoydmsimal.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZGdiZGdlemxjb3lkbXNpbWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNzEyOTYsImV4cCI6MjA5OTc0NzI5Nn0.SIlNpwGyZS4WqOXHKh46j3ypylm9n84-wuTpAaczyPo';

// True cuando ya se han rellenado (para no intentar red con placeholders).
export const SUPABASE_READY =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;
