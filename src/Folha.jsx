// ══════════════════════════════════════════════════════════════
//  MÓDULO FOLHA
//  Abre o sistema "Controle de Folha e Recibos" (o mesmo de antes,
//  com todas as telas) dentro do CaixaFácil, salvando na nuvem.
//  O sistema fica em public/folha-app.html
//  Os dados de cada unidade ficam na tabela app_state,
//  na linha "folha_state_<id da unidade>".
// ══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase, isSupabaseReady } from "./supabase";

/* Unidades que o usuário pode ver.
   Se o conferente NÃO tem linha em folha_conferentes_unidades, vê todas. Admin vê todas. */
async function carregarUnidades(currentUser) {
  const { data: unidades, error } = await supabase
    .from("folha_unidades")
    .select("*")
    .order("ordem", { ascending: true });
  if (error) throw new Error("Erro ao carregar unidades: " + error.message);

  const lista = (unidades || []).filter((u) => u.ativa !== false);
  if (currentUser?.admin) return lista;

  const { data: vinc, error: e2 } = await supabase
    .from("folha_conferentes_unidades")
    .select("unidade_id")
    .eq("conferente_id", currentUser?.id);
  if (e2) throw new Error("Erro ao carregar acessos: " + e2.message);
  if (!vinc || vinc.length === 0) return lista;
  const ids = new Set(vinc.map((v) => v.unidade_id));
  return lista.filter((u) => ids.has(u.id));
}

export default function FolhaModulo({ currentUser }) {
  const [unidades, setUnidades] = useState([]);
  const [unidadeId, setUnidadeId] = useState(() => {
    try { return localStorage.getItem("folha_unidade_sel") || ""; } catch { return ""; }
  });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!isSupabaseReady()) {
      setErro("Sem conexão com a nuvem. O módulo Folha só funciona online.");
      setCarregando(false);
      return;
    }
    (async () => {
      try {
        const lista = await carregarUnidades(currentUser);
        setUnidades(lista);
        if (lista.length > 0 && !lista.some((u) => u.id === unidadeId)) setUnidadeId(lista[0].id);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (unidadeId) { try { localStorage.setItem("folha_unidade_sel", unidadeId); } catch {} }
  }, [unidadeId]);

  if (carregando) return <div style={{ ...card, textAlign: "center", color: "#94A3B8" }}>☁️ Carregando módulo Folha...</div>;
  if (erro) return <div style={{ ...card, ...alertaErro }}>⚠️ {erro}</div>;
  if (unidades.length === 0) return <div style={{ ...card, ...alertaErro }}>⚠️ Nenhuma unidade disponível para o seu usuário. Fale com o administrador.</div>;

  const unidade = unidades.find((u) => u.id === unidadeId) || unidades[0];
  const url = `/folha-app.html?unidade=${encodeURIComponent(unidade.id)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#F1F5F9" }}>📋 Folha</span>
          {unidades.length > 1 ? (
            <select value={unidade.id} onChange={(e) => setUnidadeId(e.target.value)} style={selectStyle}>
              {unidades.map((u) => <option key={u.id} value={u.id}>🏢 {u.nome}</option>)}
            </select>
          ) : (
            <span style={unidadePill}>🏢 {unidade.nome}</span>
          )}
        </div>
        <a href={url} target="_blank" rel="noreferrer" style={linkTelaCheia}>⛶ Abrir em tela cheia</a>
      </div>

      {/* Ocupa a largura toda da janela para o sistema ter espaço para o menu lateral */}
      <div style={{ width: "100vw", marginLeft: "calc(50% - 50vw)", borderTop: "1px solid #1E293B" }}>
        <iframe
          key={unidade.id}
          src={url}
          title="Folha de Pagamento"
          style={{ width: "100%", height: "calc(100vh - 150px)", minHeight: 520, border: "none", display: "block", background: "#0a1410" }}
        />
      </div>
    </div>
  );
}

const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
const alertaErro = { background: "#450a0a", border: "1px solid #EF444455", color: "#FCA5A5", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
const unidadePill = { fontSize: 12, color: "#F97316", background: "#F9731622", border: "1px solid #F9731555", borderRadius: 8, padding: "5px 10px", fontWeight: 700 };
const selectStyle = { background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "7px 10px", color: "#F1F5F9", fontSize: 13 };
const linkTelaCheia = { fontSize: 12, color: "#94A3B8", border: "1px solid #334155", borderRadius: 8, padding: "6px 12px", textDecoration: "none", fontWeight: 600 };
