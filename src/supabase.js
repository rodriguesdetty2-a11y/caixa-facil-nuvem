// Cliente Supabase — será usado no próximo passo.
// As credenciais vêm das variáveis de ambiente configuradas no Netlify
// (Site configuration → Environment variables).

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null

export const isSupabaseReady = () => supabase !== null
