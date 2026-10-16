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
  const [aberta, setAberta] = useState(true);

  // Enquanto a Folha está aberta em tela cheia, trava a rolagem do CaixaFácil por trás
  useEffect(() => {
    if (!aberta) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [aberta]);

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

  const seletorUnidade = unidades.length > 1 ? (
    <select value={unidade.id} onChange={(e) => setUnidadeId(e.target.value)} style={selectStyle}>
      {unidades.map((u) => <option key={u.id} value={u.id}>🏢 {u.nome}</option>)}
    </select>
  ) : (
    <span style={unidadePill}>🏢 {unidade.nome}</span>
  );

  // Folha minimizada: mostra o CaixaFácil normal com um botão para reabrir
  if (!aberta) {
    return (
      <div style={{ ...card, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 40 }}>📋</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#F1F5F9" }}>Folha de Pagamento</div>
        {seletorUnidade}
        <button onClick={() => setAberta(true)} style={btnAbrir}>📋 Abrir a Folha</button>
        <div style={{ fontSize: 12, color: "#64748B" }}>Para voltar ao caixa, use as abas lá em cima.</div>
      </div>
    );
  }

  // Folha aberta: ocupa a tela inteira, com uma barrinha fina no topo
  return (
    <div style={overlay}>
      <div style={barra}>
        <button onClick={() => setAberta(false)} style={btnVoltar}>← Voltar ao CaixaFácil</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#F1F5F9", whiteSpace: "nowrap" }}>📋 Folha</span>
          {seletorUnidade}
        </div>
        <a href={url} target="_blank" rel="noreferrer" style={linkTelaCheia} title="Abre a Folha sozinha em outra aba do navegador">⛶ Outra aba</a>
      </div>
      <iframe
        key={unidade.id}
        src={url}
        title="Folha de Pagamento"
        style={{ flex: 1, width: "100%", border: "none", display: "block", background: "#0a1410" }}
      />
    </div>
  );
}

const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
const alertaErro = { background: "#450a0a", border: "1px solid #EF444455", color: "#FCA5A5", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
const unidadePill = { fontSize: 12, color: "#F97316", background: "#F9731622", border: "1px solid #F9731555", borderRadius: 8, padding: "5px 10px", fontWeight: 700 };
const selectStyle = { background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "7px 10px", color: "#F1F5F9", fontSize: 13 };
const overlay = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", background: "#0a1410" };
const barra = { height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 10px", background: "#020817", borderBottom: "1px solid #1E293B" };
const btnVoltar = { background: "#10B981", border: "none", borderRadius: 8, color: "#022c22", fontWeight: 800, fontSize: 13, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" };
const btnAbrir = { background: "#10B981", border: "none", borderRadius: 10, color: "#022c22", fontWeight: 800, fontSize: 15, padding: "12px 24px", cursor: "pointer" };
const linkTelaCheia = { fontSize: 12, color: "#94A3B8", border: "1px solid #334155", borderRadius: 8, padding: "6px 12px", textDecoration: "none", fontWeight: 600 };
