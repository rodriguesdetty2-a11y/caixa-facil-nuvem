// Funções de autenticação simples usando SHA-256
// (adequado para sistema interno pequeno com usuários confiáveis)

import { supabase } from "./supabase";

// Gera o hash SHA-256 da senha (não armazenamos a senha em texto puro)
export async function hashSenha(senha) {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Carrega o usuário logado do localStorage (persiste entre sessões)
export function carregarUsuarioLogado() {
  try {
    const s = localStorage.getItem("caixafacil_usuario_logado");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

// Salva o usuário logado no localStorage
export function salvarUsuarioLogado(usuario) {
  try {
    localStorage.setItem("caixafacil_usuario_logado", JSON.stringify(usuario));
  } catch {}
}

// Remove o usuário logado (logout)
export function removerUsuarioLogado() {
  try {
    localStorage.removeItem("caixafacil_usuario_logado");
  } catch {}
}

// Verifica se já tem algum conferente cadastrado (para primeira configuração)
export async function temConferentes() {
  if (!supabase) return false;
  const { count, error } = await supabase
    .from("conferentes")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("[Auth] Erro ao verificar conferentes:", error);
    return false;
  }
  return (count || 0) > 0;
}

// Cria um novo conferente
export async function criarConferente({ nome, usuario, senha, admin = false }) {
  if (!supabase) return { error: "Sem conexão com a nuvem" };
  const senha_hash = await hashSenha(senha);
  const { data, error } = await supabase
    .from("conferentes")
    .insert({
      nome: nome.trim(),
      usuario: usuario.trim().toLowerCase(),
      senha_hash,
      admin,
      ativo: true,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Esse nome de usuário já existe. Escolha outro." };
    return { error: error.message };
  }
  return { data };
}

// Faz login (verifica usuário + senha)
export async function fazerLogin(usuario, senha) {
  if (!supabase) return { error: "Sem conexão com a nuvem" };
  const senha_hash = await hashSenha(senha);
  const { data, error } = await supabase
    .from("conferentes")
    .select("id, nome, usuario, admin, ativo")
    .eq("usuario", usuario.trim().toLowerCase())
    .eq("senha_hash", senha_hash)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Usuário ou senha incorretos" };
  if (!data.ativo) return { error: "Este usuário está desativado. Fale com o administrador." };
  salvarUsuarioLogado(data);
  return { data };
}

// Lista todos os conferentes (para tela de gerenciamento)
export async function listarConferentes() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("conferentes")
    .select("id, nome, usuario, admin, ativo, criado_em")
    .order("criado_em", { ascending: true });
  if (error) {
    console.error("[Auth] Erro ao listar:", error);
    return [];
  }
  return data || [];
}

// Atualiza um conferente (nome, admin, ativo)
export async function atualizarConferente(id, mudancas) {
  if (!supabase) return { error: "Sem conexão com a nuvem" };
  const { error } = await supabase
    .from("conferentes")
    .update(mudancas)
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// Muda a senha de um conferente
export async function mudarSenha(id, novaSenha) {
  if (!supabase) return { error: "Sem conexão com a nuvem" };
  const senha_hash = await hashSenha(novaSenha);
  const { error } = await supabase
    .from("conferentes")
    .update({ senha_hash })
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

// Remove um conferente
export async function removerConferente(id) {
  if (!supabase) return { error: "Sem conexão com a nuvem" };
  const { error } = await supabase
    .from("conferentes")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}
