import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseReady } from "./supabase";
import {
  carregarUsuarioLogado,
  salvarUsuarioLogado,
  removerUsuarioLogado,
  temConferentes,
  criarConferente,
  fazerLogin,
  listarConferentes,
  atualizarConferente,
  mudarSenha,
  removerConferente,
} from "./auth";
import FolhaModulo from "./Folha";
import RecibosTab from "./Recibos";

/* ══════════════════════════════════════
   SINCRONIZAÇÃO COM A NUVEM
   - status global (salvando / sincronizado / erro) mostrado no topo
   - evento "caixafacil-sync" pede para todos recarregarem da nuvem
══════════════════════════════════════ */
const syncStatus = { salvando: 0, ultima: null, erro: "" };
const syncOuvintes = new Set();
function avisarSync(mudanca) {
  Object.assign(syncStatus, mudanca);
  syncOuvintes.forEach((f) => f({ ...syncStatus }));
}
function useSyncStatus() {
  const [st, setSt] = useState({ ...syncStatus });
  useEffect(() => { syncOuvintes.add(setSt); return () => syncOuvintes.delete(setSt); }, []);
  return st;
}
const SYNC_INTERVALO_MS = 8000; // busca alterações de outros usuários a cada 8 segundos
function pedirSincronizacao() { window.dispatchEvent(new Event("caixafacil-sync")); }

/* ══════════════════════════════════════
   HOOK PARA ESTADO NA NUVEM (SUPABASE)
   - Lê do Supabase ao carregar
   - Escreve no Supabase a cada mudança
   - A cada 8s (e ao voltar para a tela) busca o que OUTRO usuário salvou
   - Também salva no localStorage como backup
══════════════════════════════════════ */
function useCloudState(key, defaultValue) {
  const [value, setValueRaw] = useState(() => {
    try {
      const s = localStorage.getItem(`caixafacil_${key}`);
      return s ? JSON.parse(s) : defaultValue;
    } catch { return defaultValue; }
  });
  const [loaded, setLoaded] = useState(!isSupabaseReady());
  const ultimoJson = useRef(null);   // último valor que esta tela leu ou gravou na nuvem
  const pendentes = useRef(0);       // gravações ainda em andamento desta chave

  const buscarDaNuvem = useCallback(async () => {
    if (!isSupabaseReady() || pendentes.current > 0) return;
    const { data, error } = await supabase.from("app_state").select("value").eq("key", key).maybeSingle();
    if (error) {
      console.error(`[Supabase] Erro ao carregar ${key}:`, error);
      avisarSync({ erro: "Sem conexão com a nuvem" });
      return;
    }
    if (pendentes.current > 0) return; // começou a gravar enquanto buscava
    if (data?.value !== undefined && data?.value !== null) {
      const json = JSON.stringify(data.value);
      if (json !== ultimoJson.current) {
        ultimoJson.current = json;
        setValueRaw(data.value);
        try { localStorage.setItem(`caixafacil_${key}`, json); } catch {}
      }
    }
    avisarSync({ ultima: new Date(), erro: "" });
  }, [key]);

  // Carrega do Supabase ao montar
  useEffect(() => {
    if (!isSupabaseReady()) { setLoaded(true); return; }
    let cancelled = false;
    buscarDaNuvem().finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [buscarDaNuvem]);

  // Busca alterações de outros usuários: a cada 8s, ao voltar para a janela e no botão "Sincronizar"
  useEffect(() => {
    if (!isSupabaseReady()) return;
    const tick = () => { if (document.visibilityState !== "hidden") buscarDaNuvem(); };
    const id = setInterval(tick, SYNC_INTERVALO_MS);
    window.addEventListener("focus", tick);
    window.addEventListener("caixafacil-sync", buscarDaNuvem);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      window.removeEventListener("caixafacil-sync", buscarDaNuvem);
    };
  }, [buscarDaNuvem]);

  const setValue = useCallback((v) => {
    setValueRaw((prev) => {
      const val = typeof v === "function" ? v(prev) : v;
      const json = JSON.stringify(val);
      if (json === ultimoJson.current) return val; // nada mudou
      ultimoJson.current = json;
      try { localStorage.setItem(`caixafacil_${key}`, json); } catch {}
      if (isSupabaseReady()) {
        pendentes.current += 1;
        avisarSync({ salvando: syncStatus.salvando + 1 });
        supabase
          .from("app_state")
          .upsert({ key, value: val }, { onConflict: "key" })
          .then(({ error }) => {
            pendentes.current -= 1;
            if (error) {
              console.error(`[Supabase] Erro ao salvar ${key}:`, error);
              avisarSync({ salvando: Math.max(0, syncStatus.salvando - 1), erro: "Não salvou na nuvem" });
            } else {
              avisarSync({ salvando: Math.max(0, syncStatus.salvando - 1), ultima: new Date(), erro: "" });
            }
          });
      }
      return val;
    });
  }, [key]);

  return [value, setValue, loaded];
}

/* Selo de sincronização + botão "Sincronizar" (topo da tela) */
function SyncBadge() {
  const st = useSyncStatus();
  const [girando, setGirando] = useState(false);
  const sincronizar = () => {
    setGirando(true);
    pedirSincronizacao();
    setTimeout(() => setGirando(false), 1200);
  };
  let texto, cor, fundo;
  if (st.erro) { texto = "⚠️ " + st.erro; cor = "#FCA5A5"; fundo = "#450a0a"; }
  else if (st.salvando > 0) { texto = "⏳ Salvando na nuvem..."; cor = "#FDE68A"; fundo = "#422006"; }
  else {
    const hora = st.ultima ? st.ultima.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    texto = "☁️ Sincronizado" + (hora ? " " + hora : ""); cor = "#06B6D4"; fundo = "#083344";
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ fontSize: 11, color: cor, background: fundo, border: `1px solid ${cor}55`, borderRadius: 8, padding: "5px 10px", whiteSpace: "nowrap" }}>{texto}</div>
      <button onClick={sincronizar} title="Buscar agora o que outros usuários lançaram"
        style={{ fontSize: 11, fontWeight: 700, color: "#F1F5F9", background: "#0E7490", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
        {girando ? "🔄 Atualizando..." : "🔄 Sincronizar"}
      </button>
    </div>
  );
}

// Dado o campo "conferente" de uma prestação e a lista atual de conferentes,
// devolve o NOME ATUALIZADO. Se o conferente foi removido ou não existe, usa o nome gravado.
function nomeConferenteAtual(conferenteGravado, listaConferentes) {
  if (!conferenteGravado) return null;
  if (!listaConferentes || listaConferentes.length === 0) return conferenteGravado.nome;
  const atual = listaConferentes.find((c) => c.id === conferenteGravado.id);
  return atual ? atual.nome : conferenteGravado.nome;
}

const PAYMENT_TYPES_PADRAO = [
  { key: "deposito",   label: "Depósito",       icon: "🏦", color: "#3B82F6" },
  { key: "moeda",      label: "Moeda",           icon: "🪙", color: "#F59E0B" },
  { key: "dinheiro",   label: "Dinheiro",        icon: "💵", color: "#10B981" },
  { key: "vasilhame",  label: "Vasilhame",       icon: "🫙", color: "#8B5CF6" },
  { key: "cartao_gas", label: "Gás do Povo",     icon: "⛽", color: "#06B6D4" },
  { key: "pix",        label: "PIX",             icon: "⚡", color: "#EC4899" },
  { key: "credito",    label: "Cartão Crédito",  icon: "💳", color: "#F97316" },
  { key: "debito",     label: "Cartão Débito",   icon: "🟢", color: "#14B8A6" },
];

const CORES_OPCOES = [
  "#3B82F6","#F59E0B","#10B981","#8B5CF6",
  "#06B6D4","#EC4899","#F97316","#14B8A6",
  "#EF4444","#A3E635","#FB923C","#E879F9",
];

const fmt = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parse = (v) => {
  if (v === "" || v === undefined || v === null) return 0;
  return parseFloat(String(v).replace(",", ".")) || 0;
};

const sumList = (list) => (list || [""]).reduce((s, v) => s + parse(v), 0);
const initValores = (formas) => Object.fromEntries(formas.map((pt) => [pt.key, [""]]));

/* ══════════════════════════════════════
   CALCULADORA DE CÉDULAS E MOEDAS
══════════════════════════════════════ */
const CEDULAS = [
  { valor: 200, label: "R$ 200", cor: "#F97316", emoji: "🟠" },
  { valor: 100, label: "R$ 100", cor: "#3B82F6", emoji: "🔵" },
  { valor: 50,  label: "R$ 50",  cor: "#10B981", emoji: "🟢" },
  { valor: 20,  label: "R$ 20",  cor: "#F59E0B", emoji: "🟡" },
  { valor: 10,  label: "R$ 10",  cor: "#8B5CF6", emoji: "🟣" },
  { valor: 5,   label: "R$ 5",   cor: "#06B6D4", emoji: "🔷" },
  { valor: 2,   label: "R$ 2",   cor: "#EF4444", emoji: "🔴" },
  { valor: 1,   label: "R$ 1",   cor: "#94A3B8", emoji: "⚪" },
  { valor: 0.50, label: "R$ 0,50", cor: "#A3E635", emoji: "🟩" },
  { valor: 0.25, label: "R$ 0,25", cor: "#FB923C", emoji: "🟧" },
  { valor: 0.10, label: "R$ 0,10", cor: "#E879F9", emoji: "🌸" },
  { valor: 0.05, label: "R$ 0,05", cor: "#67E8F9", emoji: "🔹" },
];

function CalculadoraTab() {
  const [qtd, setQtd] = useState({});

  const total = CEDULAS.reduce((s, c) => s + (parse(qtd[c.valor] || 0) * c.valor), 0);
  const totalNotas = CEDULAS.filter((c) => c.valor >= 2).reduce((s, c) => s + parse(qtd[c.valor] || 0), 0);
  const totalMoedas = CEDULAS.filter((c) => c.valor < 2).reduce((s, c) => s + parse(qtd[c.valor] || 0), 0);

  const limpar = () => setQtd({});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ ...cardTitle, marginBottom: 0 }}>💵 Calculadora de Cédulas e Moedas</h2>
          <button style={{ ...btn, background: "#374151", fontSize: 12, padding: "7px 14px" }} onClick={limpar}>🔄 Limpar</button>
        </div>

        {/* Total geral — fica no topo e acompanha a rolagem */}
        <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#062A22", border: "2px solid #10B981AA", borderRadius: 14, padding: "12px 18px", marginBottom: 18, boxShadow: "0 6px 18px #0009", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "#6EE7B7", fontWeight: 700, letterSpacing: 0.5 }}>💰 TOTAL GERAL</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: "#10B981", lineHeight: 1.1 }}>{fmt(total)}</div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8" }}>💵 Notas</div>
              <div style={{ fontWeight: 800, color: "#60A5FA", fontSize: 15 }}>
                {fmt(CEDULAS.filter((c) => c.valor >= 2).reduce((s, c) => s + (parse(qtd[c.valor] || 0) * c.valor), 0))}
              </div>
              <div style={{ fontSize: 10, color: "#64748B" }}>{totalNotas} cédulas</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8" }}>🪙 Moedas</div>
              <div style={{ fontWeight: 800, color: "#FBBF24", fontSize: 15 }}>
                {fmt(CEDULAS.filter((c) => c.valor < 2).reduce((s, c) => s + (parse(qtd[c.valor] || 0) * c.valor), 0))}
              </div>
              <div style={{ fontSize: 10, color: "#64748B" }}>{totalMoedas} moedas</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8" }}>📦 Peças</div>
              <div style={{ fontWeight: 800, color: "#34D399", fontSize: 15 }}>{totalNotas + totalMoedas}</div>
              <div style={{ fontSize: 10, color: "#64748B" }}>no total</div>
            </div>
          </div>
        </div>

        {/* Cédulas */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          💵 Cédulas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {CEDULAS.filter((c) => c.valor >= 2).map((c) => {
            const q = parse(qtd[c.valor] || 0);
            const subtotal = q * c.valor;
            return (
              <div key={c.valor} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 10, alignItems: "center", background: "#1E293B", borderRadius: 10, padding: "10px 14px", border: `1px solid ${q > 0 ? c.cor + "66" : "#334155"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{c.emoji}</span>
                  <span style={{ fontWeight: 800, color: c.cor, fontSize: 15 }}>{c.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "#334155", color: "#F1F5F9", fontSize: 18, cursor: "pointer", fontWeight: 700 }}
                    onClick={() => setQtd((prev) => ({ ...prev, [c.valor]: Math.max(0, (parse(prev[c.valor] || 0) - 1)) }))}>−</button>
                  <input
                    style={{ ...inputStyle, textAlign: "center", width: 70, padding: "7px 8px", fontSize: 16, fontWeight: 700 }}
                    type="number" min="0" step="1"
                    value={qtd[c.valor] || ""}
                    placeholder="0"
                    onChange={(e) => setQtd((prev) => ({ ...prev, [c.valor]: e.target.value }))}
                  />
                  <button style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: c.cor, color: "#fff", fontSize: 18, cursor: "pointer", fontWeight: 700 }}
                    onClick={() => setQtd((prev) => ({ ...prev, [c.valor]: (parse(prev[c.valor] || 0) + 1) }))}>+</button>
                </div>
                <div style={{ textAlign: "right", fontWeight: 800, color: q > 0 ? c.cor : "#334155", fontSize: 15 }}>
                  {q > 0 ? fmt(subtotal) : "—"}
                  {q > 0 && <div style={{ fontSize: 10, color: "#64748B", fontWeight: 400 }}>{q} × {c.label}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Moedas */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          🪙 Moedas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {CEDULAS.filter((c) => c.valor < 2).map((c) => {
            const q = parse(qtd[c.valor] || 0);
            const subtotal = q * c.valor;
            return (
              <div key={c.valor} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 10, alignItems: "center", background: "#1E293B", borderRadius: 10, padding: "10px 14px", border: `1px solid ${q > 0 ? c.cor + "66" : "#334155"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{c.emoji}</span>
                  <span style={{ fontWeight: 800, color: c.cor, fontSize: 15 }}>{c.label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "#334155", color: "#F1F5F9", fontSize: 18, cursor: "pointer", fontWeight: 700 }}
                    onClick={() => setQtd((prev) => ({ ...prev, [c.valor]: Math.max(0, (parse(prev[c.valor] || 0) - 1)) }))}>−</button>
                  <input
                    style={{ ...inputStyle, textAlign: "center", width: 70, padding: "7px 8px", fontSize: 16, fontWeight: 700 }}
                    type="number" min="0" step="1"
                    value={qtd[c.valor] || ""}
                    placeholder="0"
                    onChange={(e) => setQtd((prev) => ({ ...prev, [c.valor]: e.target.value }))}
                  />
                  <button style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: c.cor, color: "#fff", fontSize: 18, cursor: "pointer", fontWeight: 700 }}
                    onClick={() => setQtd((prev) => ({ ...prev, [c.valor]: (parse(prev[c.valor] || 0) + 1) }))}>+</button>
                </div>
                <div style={{ textAlign: "right", fontWeight: 800, color: q > 0 ? c.cor : "#334155", fontSize: 15 }}>
                  {q > 0 ? fmt(subtotal) : "—"}
                  {q > 0 && <div style={{ fontSize: 10, color: "#64748B", fontWeight: 400 }}>{q} × {c.label}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA BACKUP
══════════════════════════════════════ */
function BackupTab({ dados, onImportar }) {
  const fileRef = useRef();

  const exportar = () => {
    const agora = new Date();
    const nomeArquivo = `caixafacil_backup_${agora.toLocaleDateString("pt-BR").replace(/\//g, "-")}_${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h")}.json`;
    const json = JSON.stringify({ ...dados, versao: "1.0", exportadoEm: agora.toISOString() }, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.vendedores && !parsed.historico && !parsed.cadastros) {
          return alert("❌ Arquivo inválido! Certifique-se de usar um backup do CaixaFácil.");
        }
        if (confirm(`Importar backup de ${parsed.exportadoEm ? new Date(parsed.exportadoEm).toLocaleString("pt-BR") : "data desconhecida"}?\n\nIsso vai substituir todos os dados atuais!`)) {
          onImportar(parsed);
        }
      } catch {
        alert("❌ Erro ao ler o arquivo. Verifique se é um backup válido do CaixaFácil.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const totalDados = {
    vendedores: dados.vendedores?.length || 0,
    historico: dados.historico?.length || 0,
    cadastros: dados.cadastros?.length || 0,
    formas: dados.formas?.length || 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>💾 Backup dos Dados</h2>
        <div style={{ fontSize: 13, color: "#64748B", marginBottom: 24 }}>
          Salve um arquivo de backup no seu computador para não perder seus dados. Você pode restaurar a qualquer momento.
        </div>

        {/* Resumo dos dados atuais */}
        <div style={{ background: "#0D1527", border: "1px solid #1E293B", borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
            📊 Dados atuais no sistema
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
            {[
              { label: "👥 Vendedores cadastrados", valor: totalDados.cadastros, cor: "#10B981" },
              { label: "📥 Entradas do dia", valor: totalDados.vendedores, cor: "#3B82F6" },
              { label: "📅 Fechamentos", valor: totalDados.historico, cor: "#7C3AED" },
              { label: "💳 Formas de pagamento", valor: totalDados.formas, cor: "#F97316" },
            ].map((item) => (
              <div key={item.label} style={{ background: "#1E293B", borderRadius: 10, padding: "12px 14px", textAlign: "center", border: `1px solid ${item.cor}33` }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: item.cor }}>{item.valor}</div>
                <div style={{ fontSize: 10, color: "#64748B", marginTop: 3 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Exportar */}
        <div style={{ background: "linear-gradient(135deg,#052e1630,#10B98120)", border: "2px solid #10B98155", borderRadius: 14, padding: "20px 24px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#10B981", fontSize: 15, marginBottom: 6 }}>📤 Exportar Backup</div>
          <div style={{ color: "#64748B", fontSize: 12, marginBottom: 14 }}>
            Salva um arquivo <strong>.json</strong> no seu computador com todos os dados: vendedores, histórico, cadastros e configurações.
          </div>
          <button style={{ ...btn, background: "#10B981", fontSize: 14, padding: "12px 24px", width: "100%" }} onClick={exportar}>
            💾 Baixar Backup Agora
          </button>
        </div>

        {/* Importar */}
        <div style={{ background: "linear-gradient(135deg,#1e3a5f30,#3B82F620)", border: "2px solid #3B82F655", borderRadius: 14, padding: "20px 24px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#3B82F6", fontSize: 15, marginBottom: 6 }}>📥 Restaurar Backup</div>
          <div style={{ color: "#64748B", fontSize: 12, marginBottom: 14 }}>
            ⚠️ Isso vai <strong>substituir todos os dados atuais</strong> pelo conteúdo do arquivo de backup. Use somente para recuperar dados perdidos.
          </div>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importar} />
          <button style={{ ...btn, background: "#3B82F6", fontSize: 14, padding: "12px 24px", width: "100%" }} onClick={() => fileRef.current.click()}>
            📂 Selecionar Arquivo de Backup
          </button>
        </div>

        {/* Dicas */}
        <div style={{ background: "#1E293B", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 10 }}>💡 Dicas de backup</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              "Faça backup todo dia antes de fechar o sistema",
              "Salve em pasta segura: Documentos ou Google Drive",
              "Se trocar de computador, importe o backup no novo",
              "O arquivo tem o nome com a data e hora do backup",
              "Guarde vários backups de datas diferentes",
            ].map((dica, i) => (
              <div key={i} style={{ fontSize: 12, color: "#94A3B8", display: "flex", gap: 8 }}>
                <span style={{ color: "#F59E0B" }}>•</span> {dica}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA CONFIGURAÇÕES
══════════════════════════════════════ */
function ConfigTab({ formas, setFormas }) {
  const [novoLabel, setNovoLabel] = useState("");
  const [novoIcon, setNovoIcon] = useState("💰");
  const [novaCor, setNovaCor] = useState("#3B82F6");

  const adicionar = () => {
    if (!novoLabel.trim()) return alert("Digite o nome da forma de pagamento.");
    const key = "custom_" + Date.now();
    setFormas((prev) => [...prev, { key, label: novoLabel.trim(), icon: novoIcon, color: novaCor }]);
    setNovoLabel("");
    setNovoIcon("💰");
    setNovaCor("#3B82F6");
  };

  const remover = (key) => {
    if (confirm("Remover esta forma de pagamento?"))
      setFormas((prev) => prev.filter((f) => f.key !== key));
  };

  const restaurar = () => {
    if (confirm("Restaurar as formas de pagamento padrão? As personalizadas serão removidas."))
      setFormas(PAYMENT_TYPES_PADRAO);
  };

  const ICONES = ["💰","🏦","💵","🪙","💳","⚡","🫙","⛽","🟢","🔵","🔴","🟡","🟠","🟣","⚪","🏧","📱","💎","🎯","📦"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>⚙️ Configurar Formas de Pagamento</h2>
        <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>
          Adicione novas formas de pagamento ou remova as que não usa.
        </div>

        {/* Lista atual */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
            Formas ativas ({formas.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {formas.map((f) => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#1E293B", borderRadius: 10, padding: "12px 16px", border: `1px solid ${f.color}44` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: f.color + "22", border: `1px solid ${f.color}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                    {f.icon}
                  </div>
                  <span style={{ fontWeight: 700, color: f.color, fontSize: 14 }}>{f.label}</span>
                </div>
                <button
                  style={{ background: "#7F1D1D", border: "none", borderRadius: 8, color: "#FCA5A5", cursor: "pointer", padding: "6px 12px", fontSize: 12, fontWeight: 700 }}
                  onClick={() => remover(f.key)}
                >
                  🗑️ Remover
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Adicionar nova */}
        <div style={{ background: "#0D1527", border: "1px solid #1E293B", borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", marginBottom: 14 }}>➕ Adicionar Nova Forma</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Nome</label>
              <input
                style={inputStyle}
                placeholder="Ex: Transferência, Boleto..."
                value={novoLabel}
                onChange={(e) => setNovoLabel(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Ícone</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ICONES.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setNovoIcon(ic)}
                    style={{ fontSize: 18, background: novoIcon === ic ? "#334155" : "transparent", border: novoIcon === ic ? "2px solid #10B981" : "1px solid #334155", borderRadius: 6, cursor: "pointer", width: 34, height: 34 }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Cor</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CORES_OPCOES.map((cor) => (
                <button
                  key={cor}
                  onClick={() => setNovaCor(cor)}
                  style={{ width: 30, height: 30, borderRadius: "50%", background: cor, border: novaCor === cor ? "3px solid #fff" : "2px solid transparent", cursor: "pointer", outline: novaCor === cor ? `2px solid ${cor}` : "none" }}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          {novoLabel && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "#1E293B", borderRadius: 8, border: `1px solid ${novaCor}55`, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{novoIcon}</span>
              <span style={{ color: novaCor, fontWeight: 700 }}>{novoLabel}</span>
            </div>
          )}

          <button style={{ ...btn, background: "#10B981", width: "100%" }} onClick={adicionar}>
            ➕ Adicionar Forma de Pagamento
          </button>
        </div>

        <button
          style={{ ...btn, background: "#374151", fontSize: 12, width: "100%" }}
          onClick={restaurar}
        >
          🔄 Restaurar Formas Padrão
        </button>
      </div>
    </div>
  );
}
function MultiValueField({ pt, values, onChange }) {
  const total = sumList(values);
  const addLine = () => onChange([...values, ""]);
  const removeLine = (i) => { const n = values.filter((_, idx) => idx !== i); onChange(n.length === 0 ? [""] : n); };
  const updateLine = (i, val) => { const n = [...values]; n[i] = val; onChange(n); };

  return (
    <div style={{ background: "#0D1527", border: `1px solid ${pt.color}44`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: pt.color, fontWeight: 700, fontSize: 13 }}>{pt.icon} {pt.label}</span>
        <span style={{ background: pt.color + "22", color: pt.color, fontWeight: 800, fontSize: 13, padding: "3px 10px", borderRadius: 20, border: `1px solid ${pt.color}44` }}>
          {fmt(total)}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {values.map((val, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#475569", minWidth: 18, textAlign: "right" }}>{i + 1}.</span>
            <input
              style={{ ...inputStyle, borderColor: pt.color + "55", flex: 1, textAlign: "right", fontSize: 14, padding: "7px 10px" }}
              type="number" step="0.01" min="0" placeholder="0,00"
              value={val} onChange={(e) => updateLine(i, e.target.value)}
            />
            {values.length > 1 && (
              <button style={{ background: "#7F1D1D", border: "none", borderRadius: 6, color: "#FCA5A5", cursor: "pointer", width: 26, height: 26, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                onClick={() => removeLine(i)}>×</button>
            )}
          </div>
        ))}
      </div>
      <button style={{ marginTop: 8, width: "100%", background: "transparent", border: `1px dashed ${pt.color}55`, borderRadius: 7, color: pt.color, cursor: "pointer", padding: "5px", fontSize: 12, fontWeight: 600 }}
        onClick={addLine}>+ adicionar valor</button>
      {values.filter((v) => parse(v) > 0).length > 1 && (
        <div style={{ marginTop: 6, textAlign: "right", fontSize: 11, color: "#64748B" }}>
          {values.filter((v) => parse(v) > 0).length} valores · soma: {fmt(total)}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   ABA 1 — ENTRADA
══════════════════════════════════════ */
function EntradaTab({ vendedores, setVendedores, formas, cadastros }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [valores, setValores] = useState(initValores(formas));
  const [editId, setEditId] = useState(null);

  const totalEntrada = formas.reduce((s, pt) => s + sumList(valores[pt.key]), 0);

  const selecionarCadastro = (id) => {
    const c = cadastros.find((x) => x.id === Number(id));
    if (c) { setNome(c.nome); setTelefone(c.telefone || ""); }
  };

  const salvar = () => {
    if (!nome.trim()) return alert("Digite o nome do vendedor.");
    const totaisPorForma = {};
    const detalhesPorForma = {};
    formas.forEach((pt) => {
      const lista = (valores[pt.key] || [""]).filter((v) => parse(v) > 0);
      totaisPorForma[pt.key] = sumList(lista);
      detalhesPorForma[pt.key] = lista;
    });
    const entrada = {
      id: editId || Date.now(),
      nome,
      telefone: telefone.replace(/\D/g, ""),
      valores: totaisPorForma,
      detalhes: detalhesPorForma,
      total: totalEntrada,
      data: new Date().toLocaleString("pt-BR"),
      prestacao: null,
    };
    if (editId) {
      setVendedores((prev) => prev.map((v) => (v.id === editId ? { ...entrada, prestacao: v.prestacao } : v)));
      setEditId(null);
    } else {
      setVendedores((prev) => [...prev, entrada]);
    }
    setNome("");
    setTelefone("");
    setValores(initValores(formas));
  };

  const editar = (v) => {
    setEditId(v.id);
    setNome(v.nome);
    setTelefone(v.telefone || "");
    const r = initValores(formas);
    formas.forEach((pt) => {
      const lista = v.detalhes?.[pt.key];
      r[pt.key] = lista && lista.length > 0 ? lista.map(String) : [""];
    });
    setValores(r);
  };

  const remover = (id) => {
    if (confirm("Remover este vendedor?"))
      setVendedores((prev) => prev.filter((v) => v.id !== id));
  };

  const setForma = (key, newList) => setValores((prev) => ({ ...prev, [key]: newList }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>{editId ? "✏️ Editando Vendedor" : "➕ Nova Entrada"}</h2>
        {cadastros.length > 0 && !editId && (
          <div style={{ marginBottom: 14, background: "#0D1527", border: "1px solid #10B98133", borderRadius: 10, padding: "10px 14px" }}>
            <label style={{ ...labelStyle, color: "#10B981" }}>⚡ Selecionar vendedor cadastrado</label>
            <select style={inputStyle} defaultValue="" onChange={(e) => selecionarCadastro(e.target.value)}>
              <option value="">-- Escolha para preencher automaticamente --</option>
              {cadastros.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.telefone ? ` · ${c.telefone}` : ""}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Nome do Vendedor</label>
            <input style={inputStyle} placeholder="Ex: João Silva" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>📱 WhatsApp (com DDD)</label>
            <input style={inputStyle} placeholder="Ex: 87999998888" value={telefone}
              onChange={(e) => setTelefone(e.target.value)} type="tel" maxLength={15} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
          {formas.map((pt) => (
            <MultiValueField key={pt.key} pt={pt} values={valores[pt.key] || [""]} onChange={(list) => setForma(pt.key, list)} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={totalPill}>
            Total da entrada: <strong style={{ color: "#10B981", marginLeft: 8, fontSize: 18 }}>{fmt(totalEntrada)}</strong>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {editId && (
              <button style={{ ...btn, background: "#374151" }} onClick={() => { setEditId(null); setNome(""); setValores(initValores(formas)); }}>Cancelar</button>
            )}
            <button style={{ ...btn, background: "#10B981" }} onClick={salvar}>
              {editId ? "Atualizar" : "💾 Salvar Entrada"}
            </button>
          </div>
        </div>
      </div>

      {vendedores.length > 0 && (
        <div style={card}>
          <h2 style={cardTitle}>📋 Vendedores Cadastrados ({vendedores.length})</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {vendedores.map((v, i) => (
              <div key={v.id} style={itemCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#F1F5F9" }}>👤 {v.nome}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      {v.data}{v.telefone ? ` · 📱 ${v.telefone}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {v.prestacao && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                        background: v.prestacao.status === "ok" ? "#10B98122" : v.prestacao.status === "sobrou" ? "#3B82F622" : "#EF444422",
                        color: v.prestacao.status === "ok" ? "#10B981" : v.prestacao.status === "sobrou" ? "#3B82F6" : "#EF4444",
                        border: `1px solid ${v.prestacao.status === "ok" ? "#10B98155" : v.prestacao.status === "sobrou" ? "#3B82F655" : "#EF444455"}`,
                      }}>
                        {v.prestacao.status === "ok" ? "✅ Conferiu" : v.prestacao.status === "sobrou" ? `📈 Sobrou ${fmt(Math.abs(v.prestacao.diferenca))}` : `⚠️ Faltou ${fmt(Math.abs(v.prestacao.diferenca))}`}
                      </span>
                    )}
                    {v.telefone && v.prestacao && (
                      <button
                        style={{ ...miniBtn, background: "#25D366", fontSize: 13 }}
                        title="Enviar mensagem no WhatsApp"
                        onClick={() => {
                          const tel = "55" + v.telefone.replace(/\D/g, "");
                          const diff = Math.abs(v.prestacao.diferenca);
                          let msg = "";
                          if (v.prestacao.status === "ok") {
                            msg = `Olá ${v.nome}! ✅ Sua prestação de contas está *correta*. Total: ${fmt(v.total)}. Obrigado!`;
                          } else if (v.prestacao.status === "faltou") {
                            msg = `Olá ${v.nome}! ⚠️ Sua prestação de contas está com *falta de ${fmt(diff)}*.\nEsperado: ${fmt(v.total)}\nEntregue: ${fmt(v.prestacao.totalEntregue)}\nPor favor, verifique e entre em contato.`;
                          } else {
                            msg = `Olá ${v.nome}! 📈 Sua prestação de contas ficou com *saldo positivo de ${fmt(diff)}*.\nEsperado: ${fmt(v.total)}\nEntregue: ${fmt(v.prestacao.totalEntregue)}\nObrigado!`;
                          }
                          window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, "_blank");
                        }}
                      >
                        📲 WhatsApp
                      </button>
                    )}
                    <span style={{ color: "#10B981", fontWeight: 800, fontSize: 16 }}>{fmt(v.total)}</span>
                    <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => editar(v)}>✏️</button>
                    <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => remover(v.id)}>🗑️</button>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {formas.filter((pt) => (v.valores[pt.key] || 0) > 0).map((pt) => {
                    const qtd = v.detalhes?.[pt.key]?.length || 1;
                    return (
                      <span key={pt.key} style={{ ...tagPill, borderColor: pt.color + "88", color: pt.color }}>
                        {pt.icon} {pt.label}: {fmt(v.valores[pt.key])}{qtd > 1 ? ` (${qtd}x)` : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   ABA 2 — PRESTAÇÃO DE CONTAS
══════════════════════════════════════ */
function PrestaContasTab({ vendedores, setVendedores, formas, cadastros, currentUser, conferentesLista }) {
  const [selectedId, setSelectedId] = useState("");
  const [entregue, setEntregue] = useState(initValores(formas));
  const [confirmado, setConfirmado] = useState(false);

  const vendedor = vendedores.find((v) => v.id === Number(selectedId));
  const algumPreenchido = formas.some((pt) => (entregue[pt.key] || [""]).some((v) => parse(v) > 0));

  const totalEsperado = vendedor ? formas.reduce((s, pt) => s + (vendedor.valores[pt.key] || 0), 0) : 0;
  const totalEntregue = formas.reduce((s, pt) => s + sumList(entregue[pt.key] || [""]), 0);
  const difTotal = totalEntregue - totalEsperado;
  const totalOk = Math.abs(difTotal) < 0.01;
  const totalSobrou = difTotal > 0.01;

  const setForma = (key, newList) => setEntregue((prev) => ({ ...prev, [key]: newList }));

  const limpar = () => { setEntregue(initValores(formas)); setConfirmado(false); };

  const confirmar = () => {
    if (!algumPreenchido) return alert("Preencha pelo menos um valor antes de confirmar.");
    const prestacaoPorForma = {};
    formas.forEach((pt) => {
      prestacaoPorForma[pt.key] = sumList(entregue[pt.key] || [""]);
    });
    const resultado = {
      totalEntregue,
      totalEsperado,
      diferenca: difTotal,
      status: totalOk ? "ok" : totalSobrou ? "sobrou" : "faltou",
      porForma: prestacaoPorForma,
      data: new Date().toLocaleString("pt-BR"),
      // NOVO: quem conferiu
      conferente: currentUser ? {
        id: currentUser.id,
        nome: currentUser.nome,
        usuario: currentUser.usuario,
      } : null,
      conferidoEm: new Date().toISOString(),
    };
    setVendedores((prev) =>
      prev.map((v) => v.id === Number(selectedId) ? { ...v, prestacao: resultado } : v)
    );
    setConfirmado(true);
  };

  // Carrega prestação já salva ao selecionar vendedor
  const aoSelecionarVendedor = (id) => {
    setSelectedId(id);
    setConfirmado(false);
    const v = vendedores.find((x) => x.id === Number(id));
    if (v?.prestacao) {
      // Reconstrói entregue a partir do salvo
      const reconstruido = initValores(formas);
      formas.forEach((pt) => {
        const val = v.prestacao.porForma?.[pt.key] || 0;
        reconstruido[pt.key] = val > 0 ? [String(val)] : [""];
      });
      setEntregue(reconstruido);
      setConfirmado(true);
    } else {
      setEntregue(initValores(formas));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>🧾 Prestação de Contas</h2>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>👤 Selecionar Vendedor</label>
          {vendedores.length === 0 ? (
            <div style={{ color: "#FCA5A5", fontSize: 13, padding: "12px 14px", background: "#1E293B", borderRadius: 8, border: "1px solid #7F1D1D" }}>
              ⚠️ Cadastre um vendedor na aba <strong>"Entrada"</strong> primeiro.
            </div>
          ) : (
            <select style={inputStyle} value={selectedId} onChange={(e) => aoSelecionarVendedor(e.target.value)}>
              <option value="">-- Selecione o vendedor --</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome} — entrada: {fmt(v.total)}{v.prestacao ? (v.prestacao.status === "ok" ? " ✅" : v.prestacao.status === "sobrou" ? " 📈" : " ⚠️") : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ⚠️ Aviso de saldo (devedor ou positivo) do vendedor selecionado */}
        {vendedor && (() => {
          const cadastro = (cadastros || []).find((c) => c.nome.trim().toLowerCase() === vendedor.nome.trim().toLowerCase());
          if (!cadastro) return null;
          const saldo = cadastro.saldo || 0;
          const temSaldo = Math.abs(saldo) >= 0.01;
          if (!temSaldo) return null;
          const devedor = saldo < 0;
          const cor = devedor ? "#EF4444" : "#3B82F6";
          const bg = devedor ? "#450a0a" : "#1e3a5f";
          return (
            <div style={{ background: bg, border: `2px solid ${cor}`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ fontSize: 32 }}>{devedor ? "⚠️" : "📈"}</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: cor, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>
                  {devedor ? "⚠️ ATENÇÃO — Saldo Devedor" : "📈 Saldo Positivo (crédito a receber)"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#F1F5F9" }}>
                  {vendedor.nome} {devedor ? "está devendo" : "tem crédito de"} <span style={{ color: cor }}>{fmt(Math.abs(saldo))}</span>
                </div>
                <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4 }}>
                  {devedor
                    ? "💡 Confira se o vendedor vai pagar essa diferença hoje junto com a prestação."
                    : "💡 Esse valor pode ser compensado se faltar algo na prestação de hoje."
                  }
                </div>
              </div>
            </div>
          );
        })()}

        {/* Banner de prestação já confirmada */}
        {vendedor && confirmado && (
          <div style={{ background: "#0D1F0D", border: "1px solid #10B98155", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#10B981", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div>✅ Prestação confirmada. Para corrigir um valor, clique em Editar.</div>
              {vendedor.prestacao?.conferente && (
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                  🕵️ Conferido por <strong style={{ color: "#F1F5F9" }}>{nomeConferenteAtual(vendedor.prestacao.conferente, conferentesLista)}</strong>
                  {vendedor.prestacao.conferidoEm && <> em {new Date(vendedor.prestacao.conferidoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
                </div>
              )}
            </div>
            <button style={{ ...btn, background: "#2563EB", fontSize: 11, padding: "5px 12px" }} onClick={() => setConfirmado(false)}>✏️ Editar</button>
          </div>
        )}

        {vendedor && (
          <>
            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                <thead>
                  <tr>
                    <th style={th}>Forma</th>
                    <th style={{ ...th, color: "#94A3B8", textAlign: "right" }}>📥 Entrada</th>
                    <th style={{ ...th, color: "#F97316", textAlign: "center" }}>📤 Entregando</th>
                    <th style={{ ...th, textAlign: "right" }}>⚖️ Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {formas.map((pt, i) => {
                    const esperado = vendedor.valores[pt.key] || 0;
                    const lista = entregue[pt.key] || [""];
                    const recebido = sumList(lista);
                    const dif = recebido - esperado;
                    const preenchido = lista.some((v) => parse(v) > 0);
                    const ok = preenchido && Math.abs(dif) < 0.01;
                    const sobrou = dif > 0.01;
                    const difColor = !preenchido ? "#334155" : ok ? "#10B981" : sobrou ? "#3B82F6" : "#EF4444";
                    const rowBg = i % 2 === 0 ? "#0F172A" : "#0D1527";

                    return (
                      <tr key={pt.key} style={{ background: rowBg }}>
                        <td style={{ ...td, color: pt.color, fontWeight: 700, whiteSpace: "nowrap" }}>{pt.icon} {pt.label}</td>
                        <td style={{ ...td, color: esperado > 0 ? "#CBD5E1" : "#334155", textAlign: "right" }}>
                          {esperado > 0 ? fmt(esperado) : <span style={{ fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ ...td, padding: "6px 8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {lista.map((val, j) => (
                              <div key={j} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ fontSize: 10, color: "#475569", minWidth: 14, textAlign: "right" }}>{j + 1}.</span>
                                <input
                                  style={{ ...inputStyle, borderColor: pt.color + "66", fontSize: 13, padding: "5px 8px", textAlign: "right", flex: 1, minWidth: 80 }}
                                  type="number" step="0.01" min="0" placeholder="0,00"
                                  value={val}
                                  disabled={confirmado}
                                  onChange={(e) => { const n = [...lista]; n[j] = e.target.value; setForma(pt.key, n); }}
                                />
                                {lista.length > 1 && !confirmado && (
                                  <button style={{ background: "#7F1D1D", border: "none", borderRadius: 5, color: "#FCA5A5", cursor: "pointer", width: 22, height: 22, fontSize: 13, flexShrink: 0 }}
                                    onClick={() => { const n = lista.filter((_, idx) => idx !== j); setForma(pt.key, n.length === 0 ? [""] : n); }}>×</button>
                                )}
                              </div>
                            ))}
                            {!confirmado && (
                              <button style={{ background: "transparent", border: `1px dashed ${pt.color}44`, borderRadius: 5, color: pt.color, cursor: "pointer", padding: "3px", fontSize: 11, fontWeight: 600 }}
                                onClick={() => setForma(pt.key, [...lista, ""])}>+ valor</button>
                            )}
                            {lista.filter((v) => parse(v) > 0).length > 1 && (
                              <div style={{ textAlign: "right", fontSize: 10, color: pt.color, fontWeight: 700 }}>Soma: {fmt(recebido)}</div>
                            )}
                          </div>
                        </td>
                        <td style={{ ...td, color: difColor, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>
                          {!preenchido ? <span style={{ color: "#1E293B" }}>—</span>
                            : ok ? <span>✅ OK</span>
                            : <div><div>{sobrou ? "+" : ""}{fmt(dif)}</div><div style={{ fontSize: 10, fontWeight: 500 }}>{sobrou ? "📈 sobrou" : "⚠️ faltou"}</div></div>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "#1A2332", borderTop: "2px solid #334155" }}>
                    <td style={{ ...td, fontWeight: 800, color: "#F1F5F9", fontSize: 14 }}>TOTAL</td>
                    <td style={{ ...td, fontWeight: 800, color: "#94A3B8", textAlign: "right", fontSize: 14 }}>{fmt(totalEsperado)}</td>
                    <td style={{ ...td, fontWeight: 800, color: "#F97316", textAlign: "right", fontSize: 14 }}>{fmt(totalEntregue)}</td>
                    <td style={{ ...td, fontWeight: 800, textAlign: "right", fontSize: 14, color: algumPreenchido ? (totalOk ? "#10B981" : totalSobrou ? "#3B82F6" : "#EF4444") : "#334155" }}>
                      {algumPreenchido ? (difTotal >= 0 ? "+" : "") + fmt(difTotal) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Resultado + botão confirmar */}
            {algumPreenchido && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{
                  borderRadius: 14, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                  background: totalOk ? "linear-gradient(135deg,#052e1620,#10B98125)" : totalSobrou ? "linear-gradient(135deg,#1e3a5f20,#3B82F625)" : "linear-gradient(135deg,#450a0a20,#EF444425)",
                  border: `2px solid ${totalOk ? "#10B981" : totalSobrou ? "#3B82F6" : "#EF4444"}`,
                }}>
                  <div style={{ fontSize: 36 }}>{totalOk ? "✅" : totalSobrou ? "📈" : "⚠️"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3, color: totalOk ? "#10B981" : totalSobrou ? "#3B82F6" : "#EF4444" }}>
                      {totalOk ? "CONFERIU! Os valores batem." : totalSobrou ? `SOBROU ${fmt(Math.abs(difTotal))}` : `FALTOU ${fmt(Math.abs(difTotal))}`}
                    </div>
                    <div style={{ color: "#94A3B8", fontSize: 12 }}>Esperado: {fmt(totalEsperado)} · Entregue: {fmt(totalEntregue)}</div>
                  </div>
                  {confirmado && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button style={{ ...btn, background: "#2563EB", fontSize: 11, padding: "5px 12px" }} onClick={() => setConfirmado(false)}>✏️ Editar</button>
                      {vendedor?.telefone && (
                        <button
                          style={{ ...btn, background: "#25D366", fontSize: 11, padding: "5px 12px" }}
                          onClick={() => {
                            const tel = "55" + vendedor.telefone.replace(/\D/g, "");
                            const diff = fmt(Math.abs(difTotal));
                            let msg = "";
                            if (totalOk) {
                              msg = `Olá ${vendedor.nome}! ✅ Sua prestação de contas está *correta*.\nTotal esperado: ${fmt(totalEsperado)}\nObrigado! 😊`;
                            } else if (!totalSobrou) {
                              msg = `Olá ${vendedor.nome}! ⚠️ Sua prestação de contas está com *falta de ${diff}*.\n\nEsperado: ${fmt(totalEsperado)}\nEntregue: ${fmt(totalEntregue)}\nDiferença: -${diff}\n\nPor favor, verifique e entre em contato.`;
                            } else {
                              msg = `Olá ${vendedor.nome}! 📈 Sua prestação ficou com *saldo positivo de ${diff}*.\n\nEsperado: ${fmt(totalEsperado)}\nEntregue: ${fmt(totalEntregue)}\nDiferença: +${diff}\n\nObrigado! 😊`;
                            }
                            window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, "_blank");
                          }}
                        >
                          📲 WhatsApp
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {!confirmado && (
                  <button
                    style={{ ...btn, background: "#10B981", fontSize: 15, padding: "14px", width: "100%", borderRadius: 10 }}
                    onClick={confirmar}
                  >
                    ✔️ Confirmar Prestação de Contas
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {!selectedId && vendedores.length > 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "28px 0", fontSize: 13 }}>
            Selecione um vendedor acima para começar
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA 3 — RESUMO GERAL
══════════════════════════════════════ */
function ResumoTab({ vendedores, formas, conferentesLista }) {
  if (vendedores.length === 0) {
    return (
      <div style={card}>
        <h2 style={cardTitle}>📊 Resumo Geral</h2>
        <div style={{ textAlign: "center", color: "#475569", padding: "40px 0", fontSize: 14 }}>
          Nenhum vendedor cadastrado ainda.
        </div>
      </div>
    );
  }

  // Totais esperados (entrada) por forma
  const esperadoPorForma = {};
  formas.forEach((pt) => {
    esperadoPorForma[pt.key] = vendedores.reduce((s, v) => s + (v.valores[pt.key] || 0), 0);
  });

  // Totais entregues (prestação) por forma
  const entreguePorForma = {};
  formas.forEach((pt) => {
    entreguePorForma[pt.key] = vendedores
      .filter((v) => v.prestacao)
      .reduce((s, v) => s + (v.prestacao.porForma?.[pt.key] || 0), 0);
  });

  const totalEsperado = vendedores.reduce((s, v) => s + v.total, 0);
  const comPrestacao = vendedores.filter((v) => v.prestacao);
  const totalEntregue = comPrestacao.reduce((s, v) => s + v.prestacao.totalEntregue, 0);
  const difGeral = totalEntregue - totalEsperado;
  const difGeralOk = Math.abs(difGeral) < 0.01;
  const difGeralSobrou = difGeral > 0.01;

  const totalDifPos = comPrestacao.filter((v) => v.prestacao.status === "sobrou").reduce((s, v) => s + Math.abs(v.prestacao.diferenca), 0);
  const totalDifNeg = comPrestacao.filter((v) => v.prestacao.status === "faltou").reduce((s, v) => s + Math.abs(v.prestacao.diferenca), 0);
  const qtdOk = comPrestacao.filter((v) => v.prestacao.status === "ok").length;
  const qtdSobrou = comPrestacao.filter((v) => v.prestacao.status === "sobrou").length;
  const qtdFaltou = comPrestacao.filter((v) => v.prestacao.status === "faltou").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>📊 Resumo Geral — Todos os Vendedores</h2>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
          {vendedores.length} vendedor(es) · {comPrestacao.length} com prestação confirmada
        </div>

        {/* ── Painel principal: Esperado x Entregue x Diferença ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14, marginBottom: 24 }}>
          {/* Esperado */}
          <div style={{ background: "linear-gradient(135deg,#1e3a5f30,#3B82F620)", border: "2px solid #3B82F666", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>📥 Total Esperado</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#3B82F6" }}>{fmt(totalEsperado)}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>Soma de todas as entradas</div>
          </div>
          {/* Entregue */}
          <div style={{ background: "linear-gradient(135deg,#052e1630,#10B98120)", border: "2px solid #10B98166", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>📤 Total Entregue</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#10B981" }}>{fmt(totalEntregue)}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>Soma das prestações confirmadas</div>
          </div>
          {/* Diferença */}
          <div style={{
            background: difGeralOk ? "linear-gradient(135deg,#052e1630,#10B98120)" : difGeralSobrou ? "linear-gradient(135deg,#1e3a5f30,#3B82F620)" : "linear-gradient(135deg,#450a0a30,#EF444420)",
            border: `2px solid ${difGeralOk ? "#10B98166" : difGeralSobrou ? "#3B82F666" : "#EF444466"}`,
            borderRadius: 14, padding: "18px 20px"
          }}>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>⚖️ Diferença Geral</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: difGeralOk ? "#10B981" : difGeralSobrou ? "#3B82F6" : "#EF4444" }}>
              {comPrestacao.length === 0 ? "—" : (difGeral >= 0 ? "+" : "") + fmt(difGeral)}
            </div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
              {comPrestacao.length === 0 ? "Nenhuma prestação confirmada" : difGeralOk ? "✅ Tudo conferiu!" : difGeralSobrou ? "📈 Entregou a mais" : "⚠️ Entregou a menos"}
            </div>
          </div>
        </div>

        {/* ── Cards por vendedor: Esperado x Entregue x Dif ── */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          👤 Por Vendedor — Esperado x Entregue x Diferença
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {vendedores.map((v) => {
            const p = v.prestacao;
            const statusColor = !p ? "#64748B" : p.status === "ok" ? "#10B981" : p.status === "sobrou" ? "#3B82F6" : "#EF4444";
            const statusIcon = !p ? "⏳" : p.status === "ok" ? "✅" : p.status === "sobrou" ? "📈" : "⚠️";
            const statusLabel = !p ? "Pendente" : p.status === "ok" ? "Conferiu" : p.status === "sobrou" ? "Sobrou" : "Faltou";
            return (
              <div key={v.id} style={{ background: "#1E293B", border: `1px solid ${statusColor}44`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 14 }}>👤 {v.nome}</div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, background: statusColor + "22", border: `1px solid ${statusColor}55`, borderRadius: 20, padding: "3px 12px" }}>
                    {statusIcon} {statusLabel}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B", marginBottom: 3 }}>📥 ESPERADO</div>
                    <div style={{ fontWeight: 800, color: "#3B82F6", fontSize: 15 }}>{fmt(v.total)}</div>
                  </div>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B", marginBottom: 3 }}>📤 ENTREGUE</div>
                    <div style={{ fontWeight: 800, color: p ? "#10B981" : "#475569", fontSize: 15 }}>
                      {p ? fmt(p.totalEntregue) : "—"}
                    </div>
                  </div>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B", marginBottom: 3 }}>⚖️ DIFERENÇA</div>
                    <div style={{ fontWeight: 800, color: statusColor, fontSize: 15 }}>
                      {!p ? "—" : p.status === "ok" ? "R$ 0,00" : (p.diferenca >= 0 ? "+" : "") + fmt(p.diferenca)}
                    </div>
                  </div>
                </div>
                {p?.conferente && (
                  <div style={{ marginTop: 10, fontSize: 11, color: "#94A3B8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", borderTop: "1px solid #334155", paddingTop: 10 }}>
                    <span>🕵️ Conferido por</span>
                    <strong style={{ color: "#F1F5F9" }}>{nomeConferenteAtual(p.conferente, conferentesLista)}</strong>
                    {p.conferidoEm && <span>em {new Date(p.conferidoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Tabela por forma de pagamento: Esperado x Entregue x Dif ── */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          💳 Por Forma de Pagamento — Esperado x Entregue x Diferença
        </div>
        <div style={{ overflowX: "auto", marginBottom: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
            <thead>
              <tr>
                <th style={th}>Forma de Pagamento</th>
                <th style={{ ...th, color: "#3B82F6", textAlign: "right" }}>📥 Esperado</th>
                <th style={{ ...th, color: "#10B981", textAlign: "right" }}>📤 Entregue</th>
                <th style={{ ...th, textAlign: "right" }}>⚖️ Diferença</th>
              </tr>
            </thead>
            <tbody>
              {formas.map((pt, i) => {
                const esp = esperadoPorForma[pt.key];
                const ent = entreguePorForma[pt.key];
                const dif = ent - esp;
                const ok = Math.abs(dif) < 0.01;
                const sobrou = dif > 0.01;
                const difColor = comPrestacao.length === 0 ? "#334155" : ok ? "#10B981" : sobrou ? "#3B82F6" : "#EF4444";
                const rowBg = i % 2 === 0 ? "#0F172A" : "#0D1527";
                return (
                  <tr key={pt.key} style={{ background: rowBg }}>
                    <td style={{ ...td, color: pt.color, fontWeight: 700 }}>{pt.icon} {pt.label}</td>
                    <td style={{ ...td, textAlign: "right", color: esp > 0 ? "#3B82F6" : "#334155", fontWeight: 600 }}>{esp > 0 ? fmt(esp) : "—"}</td>
                    <td style={{ ...td, textAlign: "right", color: ent > 0 ? "#10B981" : "#334155", fontWeight: 600 }}>{comPrestacao.length > 0 ? fmt(ent) : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: difColor }}>
                      {comPrestacao.length === 0 ? <span style={{ color: "#334155" }}>—</span>
                        : ok ? <span>✅ OK</span>
                        : <span>{sobrou ? "+" : ""}{fmt(dif)}<br /><span style={{ fontSize: 10, fontWeight: 400 }}>{sobrou ? "📈 sobrou" : "⚠️ faltou"}</span></span>}
                    </td>
                  </tr>
                );
              })}
              {/* Linha total */}
              <tr style={{ background: "#1A2332", borderTop: "2px solid #334155" }}>
                <td style={{ ...td, fontWeight: 800, color: "#F1F5F9", fontSize: 13 }}>TOTAL GERAL</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 900, color: "#3B82F6", fontSize: 14 }}>{fmt(totalEsperado)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 900, color: "#10B981", fontSize: 14 }}>{comPrestacao.length > 0 ? fmt(totalEntregue) : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 900, fontSize: 14, color: difGeralOk ? "#10B981" : difGeralSobrou ? "#3B82F6" : "#EF4444" }}>
                  {comPrestacao.length === 0 ? "—" : difGeralOk ? "✅ OK" : (difGeral >= 0 ? "+" : "") + fmt(difGeral)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ── Placar geral ── */}
        {comPrestacao.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
            <div style={{ background: "#052e16", border: "1px solid #10B98155", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>✅</div>
              <div style={{ color: "#10B981", fontWeight: 800, fontSize: 20 }}>{qtdOk}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>Conferiu exato</div>
            </div>
            <div style={{ background: "#1e3a5f", border: "1px solid #3B82F655", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>📈</div>
              <div style={{ color: "#3B82F6", fontWeight: 800, fontSize: 20 }}>{qtdSobrou}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>Sobraram</div>
              {totalDifPos > 0 && <div style={{ color: "#3B82F6", fontWeight: 700, fontSize: 12, marginTop: 3 }}>+{fmt(totalDifPos)}</div>}
            </div>
            <div style={{ background: "#450a0a", border: "1px solid #EF444455", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>⚠️</div>
              <div style={{ color: "#EF4444", fontWeight: 800, fontSize: 20 }}>{qtdFaltou}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>Faltaram</div>
              {totalDifNeg > 0 && <div style={{ color: "#EF4444", fontWeight: 700, fontSize: 12, marginTop: 3 }}>-{fmt(totalDifNeg)}</div>}
            </div>
            <div style={{ background: "#1C1917", border: "1px solid #78716C55", borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 24 }}>⏳</div>
              <div style={{ color: "#A8A29E", fontWeight: 800, fontSize: 20 }}>{vendedores.length - comPrestacao.length}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>Pendentes</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA 4 — IMPRESSÃO / RELATÓRIO
══════════════════════════════════════ */
function ImpressaoTab({ vendedores, formas, conferentesLista }) {
  const totalPorForma = {};
  formas.forEach((pt) => {
    totalPorForma[pt.key] = vendedores.reduce((s, v) => s + (v.valores[pt.key] || 0), 0);
  });
  const totalGeralGeral = vendedores.reduce((s, v) => s + v.total, 0);
  const comPrestacao = vendedores.filter((v) => v.prestacao);
  const totalDifPos = comPrestacao.filter((v) => v.prestacao.status === "sobrou").reduce((s, v) => s + Math.abs(v.prestacao.diferenca), 0);
  const totalDifNeg = comPrestacao.filter((v) => v.prestacao.status === "faltou").reduce((s, v) => s + Math.abs(v.prestacao.diferenca), 0);
  const dataHoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const horaHoje = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const imprimir = () => {
    const conteudo = document.getElementById("relatorio-print");
    const janelaImpressao = window.open("", "_blank", "width=900,height=700");
    const estilos = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
        .rel-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 18px; }
        .rel-titulo { font-size: 22px; font-weight: 900; }
        .rel-sub { font-size: 12px; color: #555; margin-top: 3px; }
        .rel-secao { margin-bottom: 22px; }
        .rel-secao-titulo { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px; color: #333; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #f0f0f0; padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; border: 1px solid #ddd; }
        td { padding: 7px 10px; border: 1px solid #ddd; vertical-align: middle; }
        .right { text-align: right; }
        .center { text-align: center; }
        .total-row { background: #f9f9f9; font-weight: 800; }
        .status-ok { color: #059669; font-weight: 700; }
        .status-sobrou { color: #2563EB; font-weight: 700; }
        .status-faltou { color: #DC2626; font-weight: 700; }
        .resumo-cards { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
        .resumo-card { flex: 1; min-width: 140px; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; text-align: center; }
        .resumo-card .valor { font-size: 20px; font-weight: 900; margin: 4px 0; }
        .resumo-card .label { font-size: 11px; color: #666; }
        .formas-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
        .forma-card { border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
        .forma-card .forma-label { font-size: 11px; color: #555; margin-bottom: 3px; }
        .forma-card .forma-valor { font-size: 14px; font-weight: 800; }
        .total-geral-box { background: #f0fdf4; border: 2px solid #10B981; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .total-geral-box .tg-label { font-size: 12px; color: #444; }
        .total-geral-box .tg-valor { font-size: 26px; font-weight: 900; color: #059669; }
        .assinatura { margin-top: 40px; display: flex; justify-content: space-around; }
        .assinatura div { text-align: center; border-top: 1px solid #333; padding-top: 6px; width: 180px; font-size: 11px; color: #555; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    `;
    janelaImpressao.document.write("<html><head><title>CaixaFácil - Relatório</title>" + estilos + "</head><body>" + conteudo.innerHTML + "</body></html>");
    janelaImpressao.document.close();
    janelaImpressao.focus();
    setTimeout(() => {
      janelaImpressao.print();
    }, 500);
  };

  if (vendedores.length === 0) {
    return (
      <div style={card}>
        <h2 style={cardTitle}>🖨️ Impressão / Relatório</h2>
        <div style={{ textAlign: "center", color: "#475569", padding: "40px 0", fontSize: 14 }}>
          Nenhum dado para imprimir.<br />
          <span style={{ fontSize: 12, color: "#334155" }}>Cadastre vendedores primeiro.</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Controles de impressão */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 15 }}>🖨️ Relatório de Fechamento</div>
          <div style={{ color: "#64748B", fontSize: 12, marginTop: 3 }}>
            {vendedores.length} vendedor(es) · {comPrestacao.length} prestação(ões) confirmada(s) · {dataHoje} {horaHoje}
          </div>
        </div>
        <button
          style={{ ...btn, background: "#3B82F6", fontSize: 15, padding: "12px 28px", display: "flex", alignItems: "center", gap: 8 }}
          onClick={imprimir}
        >
          🖨️ Imprimir / Salvar PDF
        </button>
      </div>

      {/* Preview do relatório */}
      <div id="relatorio-print" style={{ display: "none" }}>
        {/* Conteúdo HTML puro para impressão */}
        <div className="rel-header">
          <div className="rel-titulo">🏪 CaixaFácil — Relatório de Fechamento</div>
          <div className="rel-sub">Gerado em {dataHoje} às {horaHoje} · {vendedores.length} vendedor(es)</div>
        </div>

        {/* Total geral */}
        <div className="total-geral-box">
          <div>
            <div className="tg-label">TOTAL GERAL DE ENTRADAS</div>
            <div className="tg-valor">{fmt(totalGeralGeral)}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#444" }}>
            <div>{vendedores.length} vendedor(es)</div>
            <div>{comPrestacao.length} prestação(ões) confirmada(s)</div>
          </div>
        </div>

        {/* Totais por forma */}
        <div className="rel-secao">
          <div className="rel-secao-titulo">Totais por Forma de Pagamento</div>
          <div className="formas-grid">
            {formas.map((pt) => (
              <div key={pt.key} className="forma-card">
                <div className="forma-label">{pt.icon} {pt.label}</div>
                <div className="forma-valor">{fmt(totalPorForma[pt.key])}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Resumo prestações */}
        {comPrestacao.length > 0 && (
          <div className="rel-secao">
            <div className="rel-secao-titulo">Resumo das Prestações de Contas</div>
            <div className="resumo-cards">
              <div className="resumo-card">
                <div className="label">✅ Conferiram</div>
                <div className="valor status-ok">{comPrestacao.filter((v) => v.prestacao.status === "ok").length}</div>
                <div className="label">vendedor(es)</div>
              </div>
              <div className="resumo-card">
                <div className="label">📈 Sobraram</div>
                <div className="valor status-sobrou">{comPrestacao.filter((v) => v.prestacao.status === "sobrou").length}</div>
                {totalDifPos > 0 && <div className="label" style={{ color: "#2563EB", fontWeight: 700 }}>+{fmt(totalDifPos)}</div>}
              </div>
              <div className="resumo-card">
                <div className="label">⚠️ Faltaram</div>
                <div className="valor status-faltou">{comPrestacao.filter((v) => v.prestacao.status === "faltou").length}</div>
                {totalDifNeg > 0 && <div className="label" style={{ color: "#DC2626", fontWeight: 700 }}>-{fmt(totalDifNeg)}</div>}
              </div>
              <div className="resumo-card">
                <div className="label">⏳ Pendentes</div>
                <div className="valor" style={{ color: "#92400e" }}>{vendedores.length - comPrestacao.length}</div>
                <div className="label">sem prestação</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabela por vendedor */}
        <div className="rel-secao">
          <div className="rel-secao-titulo">Detalhamento por Vendedor</div>
          <table>
            <thead>
              <tr>
                <th>Vendedor</th>
                {formas.map((pt) => <th key={pt.key} className="right">{pt.label}</th>)}
                <th className="right">Total Entrada</th>
                <th className="center">Prestação</th>
                <th className="right">Diferença</th>
                <th>Conferido por</th>
              </tr>
            </thead>
            <tbody>
              {vendedores.map((v) => {
                const p = v.prestacao;
                return (
                  <tr key={v.id}>
                    <td><strong>{v.nome}</strong><br /><span style={{ fontSize: 10, color: "#777" }}>{v.data}</span></td>
                    {formas.map((pt) => (
                      <td key={pt.key} className="right">
                        {(v.valores[pt.key] || 0) > 0 ? fmt(v.valores[pt.key]) : "—"}
                      </td>
                    ))}
                    <td className="right"><strong>{fmt(v.total)}</strong></td>
                    <td className="center">
                      {!p ? <span style={{ color: "#92400e" }}>Pendente</span>
                        : p.status === "ok" ? <span className="status-ok">✅ OK</span>
                        : p.status === "sobrou" ? <span className="status-sobrou">📈 Sobrou</span>
                        : <span className="status-faltou">⚠️ Faltou</span>}
                    </td>
                    <td className="right">
                      {!p ? "—"
                        : p.status === "ok" ? <span className="status-ok">R$ 0,00</span>
                        : <span className={p.status === "sobrou" ? "status-sobrou" : "status-faltou"}>
                            {p.diferenca >= 0 ? "+" : ""}{fmt(p.diferenca)}
                          </span>}
                    </td>
                    <td style={{ fontSize: 10 }}>
                      {nomeConferenteAtual(p?.conferente, conferentesLista) || "—"}
                      {p?.conferidoEm && <div style={{ fontSize: 9, color: "#777" }}>{new Date(p.conferidoEm).toLocaleDateString("pt-BR")}</div>}
                    </td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td><strong>TOTAL GERAL</strong></td>
                {formas.map((pt) => (
                  <td key={pt.key} className="right"><strong>{totalPorForma[pt.key] > 0 ? fmt(totalPorForma[pt.key]) : "—"}</strong></td>
                ))}
                <td className="right"><strong style={{ color: "#059669" }}>{fmt(totalGeralGeral)}</strong></td>
                <td className="center" style={{ fontSize: 11 }}>{comPrestacao.length}/{vendedores.length}</td>
                <td className="right">
                  {totalDifNeg > 0 && <div className="status-faltou">-{fmt(totalDifNeg)}</div>}
                  {totalDifPos > 0 && <div className="status-sobrou">+{fmt(totalDifPos)}</div>}
                  {totalDifNeg === 0 && totalDifPos === 0 && comPrestacao.length > 0 && <span className="status-ok">✅ OK</span>}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Assinaturas */}
        <div className="assinatura">
          <div>Responsável pelo Caixa</div>
          <div>Gerente / Supervisor</div>
        </div>
      </div>

      {/* Preview visual na tela */}
      <div style={{ ...card, background: "#fff", color: "#111", borderRadius: 12 }}>
        <div style={{ textAlign: "center", borderBottom: "2px solid #333", paddingBottom: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#111" }}>🏪 CaixaFácil — Relatório de Fechamento</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>Gerado em {dataHoje} às {horaHoje} · {vendedores.length} vendedor(es)</div>
        </div>

        {/* Total geral preview */}
        <div style={{ background: "#f0fdf4", border: "2px solid #10B981", borderRadius: 8, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "#444", marginBottom: 2 }}>TOTAL GERAL DE ENTRADAS</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#059669" }}>{fmt(totalGeralGeral)}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#444" }}>
            <div>{vendedores.length} vendedor(es)</div>
            <div>{comPrestacao.length} prestação(ões) confirmada(s)</div>
          </div>
        </div>

        {/* Formas de pagamento preview */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#555", borderBottom: "1px solid #ccc", paddingBottom: 5, marginBottom: 10 }}>Totais por Forma de Pagamento</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }}>
            {formas.map((pt) => (
              <div key={pt.key} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "10px 12px", textAlign: "center", opacity: totalPorForma[pt.key] > 0 ? 1 : 0.35 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>{pt.icon} {pt.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#111" }}>{fmt(totalPorForma[pt.key])}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Resumo prestações preview */}
        {comPrestacao.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#555", borderBottom: "1px solid #ccc", paddingBottom: 5, marginBottom: 10 }}>Resumo das Prestações</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "✅ Conferiram", valor: comPrestacao.filter((v) => v.prestacao.status === "ok").length, cor: "#059669", extra: null },
                { label: "📈 Sobraram", valor: comPrestacao.filter((v) => v.prestacao.status === "sobrou").length, cor: "#2563EB", extra: totalDifPos > 0 ? `+${fmt(totalDifPos)}` : null },
                { label: "⚠️ Faltaram", valor: comPrestacao.filter((v) => v.prestacao.status === "faltou").length, cor: "#DC2626", extra: totalDifNeg > 0 ? `-${fmt(totalDifNeg)}` : null },
                { label: "⏳ Pendentes", valor: vendedores.length - comPrestacao.length, cor: "#92400e", extra: null },
              ].map((item) => (
                <div key={item.label} style={{ flex: 1, minWidth: 110, border: "1px solid #ddd", borderRadius: 8, padding: "10px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#666" }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: item.cor }}>{item.valor}</div>
                  {item.extra && <div style={{ fontSize: 12, fontWeight: 700, color: item.cor }}>{item.extra}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabela preview */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#555", borderBottom: "1px solid #ccc", paddingBottom: 5, marginBottom: 10 }}>Detalhamento por Vendedor</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thP}>Vendedor</th>
                  {formas.map((pt) => <th key={pt.key} style={{ ...thP, textAlign: "right" }}>{pt.icon} {pt.label}</th>)}
                  <th style={{ ...thP, textAlign: "right" }}>Total</th>
                  <th style={{ ...thP, textAlign: "center" }}>Prestação</th>
                  <th style={{ ...thP, textAlign: "right" }}>Diferença</th>
                  <th style={thP}>🕵️ Conferente</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v, i) => {
                  const p = v.prestacao;
                  const cor = !p ? "#92400e" : p.status === "ok" ? "#059669" : p.status === "sobrou" ? "#2563EB" : "#DC2626";
                  return (
                    <tr key={v.id} style={{ background: i % 2 === 0 ? "#f9f9f9" : "#fff" }}>
                      <td style={tdP}><strong>{v.nome}</strong><div style={{ fontSize: 10, color: "#888" }}>{v.data}</div></td>
                      {formas.map((pt) => (
                        <td key={pt.key} style={{ ...tdP, textAlign: "right", color: (v.valores[pt.key] || 0) > 0 ? "#111" : "#ccc" }}>
                          {(v.valores[pt.key] || 0) > 0 ? fmt(v.valores[pt.key]) : "—"}
                        </td>
                      ))}
                      <td style={{ ...tdP, textAlign: "right", fontWeight: 800 }}>{fmt(v.total)}</td>
                      <td style={{ ...tdP, textAlign: "center", color: cor, fontWeight: 700, fontSize: 11 }}>
                        {!p ? "Pendente" : p.status === "ok" ? "✅ OK" : p.status === "sobrou" ? "📈 Sobrou" : "⚠️ Faltou"}
                      </td>
                      <td style={{ ...tdP, textAlign: "right", fontWeight: 700, color: cor }}>
                        {!p ? "—" : p.status === "ok" ? "R$ 0,00" : (p.diferenca >= 0 ? "+" : "") + fmt(p.diferenca)}
                      </td>
                      <td style={{ ...tdP, fontSize: 10, color: "#555" }}>
                        {nomeConferenteAtual(p?.conferente, conferentesLista) || "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#f0f0f0", fontWeight: 800 }}>
                  <td style={tdP}><strong>TOTAL GERAL</strong></td>
                  {formas.map((pt) => (
                    <td key={pt.key} style={{ ...tdP, textAlign: "right", color: totalPorForma[pt.key] > 0 ? "#111" : "#ccc" }}>
                      {totalPorForma[pt.key] > 0 ? fmt(totalPorForma[pt.key]) : "—"}
                    </td>
                  ))}
                  <td style={{ ...tdP, textAlign: "right", color: "#059669", fontSize: 14 }}><strong>{fmt(totalGeralGeral)}</strong></td>
                  <td style={{ ...tdP, textAlign: "center", fontSize: 11, color: "#666" }}>{comPrestacao.length}/{vendedores.length}</td>
                  <td style={{ ...tdP, textAlign: "right" }}>
                    {totalDifNeg > 0 && <div style={{ color: "#DC2626" }}>-{fmt(totalDifNeg)}</div>}
                    {totalDifPos > 0 && <div style={{ color: "#2563EB" }}>+{fmt(totalDifPos)}</div>}
                    {totalDifNeg === 0 && totalDifPos === 0 && comPrestacao.length > 0 && <span style={{ color: "#059669" }}>✅ OK</span>}
                  </td>
                  <td style={tdP}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Assinatura */}
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 32 }}>
          {["Responsável pelo Caixa", "Gerente / Supervisor"].map((label) => (
            <div key={label} style={{ textAlign: "center", borderTop: "1px solid #333", paddingTop: 6, width: 180, fontSize: 11, color: "#666" }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   EDITAR FECHAMENTO
══════════════════════════════════════ */
function EditarFechamento({ fechamento, formas, onSalvar, onCancelar }) {
  const [vendedores, setVendedores] = useState(JSON.parse(JSON.stringify(fechamento.vendedores)));
  const [dataEdit, setDataEdit] = useState(fechamento.dataFormatada);

  const atualizarValorVendedor = (vidx, chave, valor) => {
    setVendedores((prev) => {
      const novo = JSON.parse(JSON.stringify(prev));
      novo[vidx].valores[chave] = valor;
      novo[vidx].total = formas.reduce((s, pt) => s + parse(novo[vidx].valores[pt.key] || 0), 0);
      return novo;
    });
  };

  const removerVendedor = (vidx) => {
    if (confirm("Remover este vendedor do fechamento?"))
      setVendedores((prev) => prev.filter((_, i) => i !== vidx));
  };

  const salvar = () => {
    const totalPorForma = {};
    const entreguePorForma = {};
    formas.forEach((pt) => {
      totalPorForma[pt.key] = vendedores.reduce((s, v) => s + parse(v.valores[pt.key] || 0), 0);
      entreguePorForma[pt.key] = vendedores.filter((v) => v.prestacao).reduce((s, v) => s + (v.prestacao?.porForma?.[pt.key] || 0), 0);
    });
    const comPrestacao = vendedores.filter((v) => v.prestacao);
    const totalEsperado = vendedores.reduce((s, v) => s + v.total, 0);
    const totalEntregue = comPrestacao.reduce((s, v) => s + (v.prestacao?.totalEntregue || 0), 0);
    onSalvar({ ...fechamento, vendedores, totalEsperado, totalEntregue, totalPorForma, entreguePorForma });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...btn, background: "#374151" }} onClick={onCancelar}>← Cancelar</button>
        <button style={{ ...btn, background: "#10B981" }} onClick={salvar}>💾 Salvar Alterações</button>
        <span style={{ fontSize: 12, color: "#64748B" }}>Editando: {fechamento.dataFormatada}</span>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>✏️ Editar Fechamento</h2>
        <div style={{ fontSize: 12, color: "#F59E0B", background: "#451A0320", border: "1px solid #F59E0B44", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
          ⚠️ Você está editando um fechamento salvo. Altere os valores com cuidado.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {vendedores.map((v, vidx) => {
            const p = v.prestacao;
            const cor = !p ? "#64748B" : p.status === "ok" ? "#10B981" : p.status === "sobrou" ? "#3B82F6" : "#EF4444";
            return (
              <div key={v.id} style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 14 }}>👤 {v.nome}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {p && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: cor, background: cor + "22", border: `1px solid ${cor}55`, borderRadius: 20, padding: "2px 10px" }}>
                        {p.status === "ok" ? "✅ OK" : p.status === "sobrou" ? "📈 Sobrou" : "⚠️ Faltou"}
                      </span>
                    )}
                    <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => removerVendedor(vidx)}>🗑️ Remover</button>
                  </div>
                </div>

                {/* Editar valores por forma */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                  {formas.map((pt) => (
                    <div key={pt.key}>
                      <label style={{ ...labelStyle, color: pt.color }}>{pt.icon} {pt.label}</label>
                      <input
                        style={{ ...inputStyle, borderColor: pt.color + "66", textAlign: "right", fontSize: 13, padding: "7px 10px" }}
                        type="number" step="0.01" min="0" placeholder="0,00"
                        value={v.valores[pt.key] || ""}
                        onChange={(e) => atualizarValorVendedor(vidx, pt.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10, textAlign: "right", fontSize: 13, color: "#10B981", fontWeight: 700 }}>
                  Total: {fmt(v.total)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Total geral editado */}
        <div style={{ marginTop: 16, background: "#0F172A", border: "1px solid #334155", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#94A3B8", fontWeight: 700 }}>Total Geral após edição:</span>
          <span style={{ color: "#10B981", fontWeight: 900, fontSize: 18 }}>
            {fmt(vendedores.reduce((s, v) => s + v.total, 0))}
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={onCancelar}>Cancelar</button>
          <button style={{ ...btn, background: "#10B981", flex: 2 }} onClick={salvar}>💾 Salvar Alterações</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA CADASTRO DE VENDEDORES
══════════════════════════════════════ */
function CadastroVendedoresTab({ cadastros, setCadastros }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [saldoInicial, setSaldoInicial] = useState("");
  const [editId, setEditId] = useState(null);
  const [editandoSaldo, setEditandoSaldo] = useState(null);
  const [novoSaldo, setNovoSaldo] = useState("");

  const salvar = () => {
    if (!nome.trim()) return alert("Digite o nome do vendedor.");
    const cadastro = {
      id: editId || Date.now(),
      nome: nome.trim(),
      telefone: telefone.replace(/\D/g, ""),
      saldo: editId ? (cadastros.find(c => c.id === editId)?.saldo || 0) : parse(saldoInicial),
      dataCadastro: editId ? (cadastros.find(c => c.id === editId)?.dataCadastro || new Date().toLocaleDateString("pt-BR")) : new Date().toLocaleDateString("pt-BR"),
    };
    if (editId) {
      setCadastros((prev) => prev.map((c) => c.id === editId ? cadastro : c));
      setEditId(null);
    } else {
      setCadastros((prev) => [...prev, cadastro]);
    }
    setNome(""); setTelefone(""); setSaldoInicial("");
  };

  const editar = (c) => { setEditId(c.id); setNome(c.nome); setTelefone(c.telefone || ""); };
  const remover = (id) => { if (confirm("Remover este vendedor do cadastro?")) setCadastros((prev) => prev.filter((c) => c.id !== id)); };

  const salvarSaldo = (id) => {
    setCadastros((prev) => prev.map((c) => c.id === id ? { ...c, saldo: parse(novoSaldo) } : c));
    setEditandoSaldo(null);
    setNovoSaldo("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Formulário */}
      <div style={card}>
        <h2 style={cardTitle}>{editId ? "✏️ Editando Cadastro" : "➕ Cadastrar Vendedor"}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>👤 Nome</label>
            <input style={inputStyle} placeholder="Ex: João Silva" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>📱 WhatsApp (com DDD)</label>
            <input style={inputStyle} placeholder="Ex: 87999998888" value={telefone} onChange={(e) => setTelefone(e.target.value)} type="tel" maxLength={15} />
          </div>
          {!editId && (
            <div>
              <label style={labelStyle}>⚖️ Saldo Inicial (opcional)</label>
              <input style={inputStyle} placeholder="Ex: -50,00 ou 0" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} type="number" step="0.01" />
              <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Use negativo para dívidas já existentes</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {editId && <button style={{ ...btn, background: "#374151" }} onClick={() => { setEditId(null); setNome(""); setTelefone(""); }}>Cancelar</button>}
          <button style={{ ...btn, background: "#10B981" }} onClick={salvar}>{editId ? "Atualizar" : "💾 Salvar Cadastro"}</button>
        </div>
      </div>

      {/* Lista de cadastros */}
      {cadastros.length > 0 && (
        <div style={card}>
          <h2 style={cardTitle}>👥 Vendedores Cadastrados ({cadastros.length})</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {cadastros.map((c) => {
              const saldoPos = c.saldo > 0.01;
              const saldoNeg = c.saldo < -0.01;
              const saldoOk = Math.abs(c.saldo) < 0.01;
              const saldoCor = saldoOk ? "#10B981" : saldoPos ? "#3B82F6" : "#EF4444";
              return (
                <div key={c.id} style={{ background: "#1E293B", border: `1px solid ${saldoCor}33`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 15 }}>👤 {c.nome}</div>
                      {c.telefone && <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>📱 {c.telefone}</div>}
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 1 }}>Cadastrado em {c.dataCadastro}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* Saldo */}
                      <div style={{ background: saldoCor + "22", border: `1px solid ${saldoCor}55`, borderRadius: 10, padding: "6px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 2 }}>⚖️ SALDO</div>
                        {editandoSaldo === c.id ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input
                              style={{ ...inputStyle, width: 100, padding: "4px 8px", fontSize: 13, textAlign: "right" }}
                              type="number" step="0.01"
                              value={novoSaldo}
                              onChange={(e) => setNovoSaldo(e.target.value)}
                              autoFocus
                            />
                            <button style={{ ...miniBtn, background: "#10B981" }} onClick={() => salvarSaldo(c.id)}>✓</button>
                            <button style={{ ...miniBtn, background: "#374151" }} onClick={() => setEditandoSaldo(null)}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 800, color: saldoCor, fontSize: 14 }}>
                              {saldoOk ? "✅ Zerado" : (c.saldo > 0 ? "+" : "") + fmt(c.saldo)}
                            </span>
                            <button
                              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 12, color: "#64748B" }}
                              title="Editar saldo"
                              onClick={() => { setEditandoSaldo(c.id); setNovoSaldo(String(c.saldo)); }}
                            >✏️</button>
                          </div>
                        )}
                        <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>
                          {saldoNeg ? "⚠️ Deve" : saldoPos ? "📈 A receber" : ""}
                        </div>
                      </div>
                      <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => editar(c)}>✏️</button>
                      <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => remover(c.id)}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cadastros.length === 0 && (
        <div style={{ ...card, textAlign: "center", color: "#475569", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div>Nenhum vendedor cadastrado ainda.</div>
          <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>Cadastre acima para selecionar rapidamente na entrada!</div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   ABA 6 — HISTÓRICO DE FECHAMENTOS
══════════════════════════════════════ */
function HistoricoTab({ historico, setHistorico, formas, abrirFechamento, editarFechamento, conferentesLista }) {
  const [filtro, setFiltro] = useState("todos");
  const [mesSel, setMesSel] = useState("");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");

  const agora = new Date();
  const inicioSemana = new Date(agora);
  inicioSemana.setDate(agora.getDate() - agora.getDay());

  const filtrados = historico.filter((f) => {
    const data = new Date(f.timestamp);
    if (filtro === "hoje") return data.toDateString() === agora.toDateString();
    if (filtro === "semana") return data >= inicioSemana;
    if (filtro === "mes" && mesSel) {
      const [ano, mes] = mesSel.split("-");
      return data.getFullYear() === Number(ano) && data.getMonth() + 1 === Number(mes);
    }
    if (filtro === "periodo" && dataIni && dataFim) {
      const ini = new Date(dataIni + "T00:00:00");
      const fim = new Date(dataFim + "T23:59:59");
      return data >= ini && data <= fim;
    }
    return true;
  });

  // Totais do período filtrado
  const totalPeriodo = filtrados.reduce((s, f) => s + f.totalEsperado, 0);
  const totalEntregue = filtrados.reduce((s, f) => s + (f.totalEntregue || 0), 0);
  const totalDif = totalEntregue - totalPeriodo;

  const removerFechamento = (id) => {
    if (confirm("Remover este fechamento do histórico?"))
      setHistorico((prev) => prev.filter((f) => f.id !== id));
  };

  // 🖨️ Imprimir relatório PDF — individual ou do período filtrado
  const imprimirRelatorio = (fechamentosParaImprimir, tituloRelatorio) => {
    if (!fechamentosParaImprimir || fechamentosParaImprimir.length === 0) {
      return alert("Nenhum fechamento para imprimir neste filtro.");
    }

    const totalEsp = fechamentosParaImprimir.reduce((s, f) => s + f.totalEsperado, 0);
    const totalEnt = fechamentosParaImprimir.reduce((s, f) => s + (f.totalEntregue || 0), 0);
    const totalDifImp = totalEnt - totalEsp;

    const totalPorFormaImp = {};
    formas.forEach((pt) => {
      totalPorFormaImp[pt.key] = fechamentosParaImprimir.reduce((s, f) => s + (f.totalPorForma?.[pt.key] || 0), 0);
    });

    const dataGer = new Date().toLocaleString("pt-BR");

    let html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>${tituloRelatorio}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 20px; }
          .cabecalho { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 16px; }
          .titulo { font-size: 20px; font-weight: 900; }
          .sub { font-size: 11px; color: #555; margin-top: 3px; }
          .totais-geral { display: flex; justify-content: space-around; background: #f0fdf4; border: 2px solid #10B981; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
          .totais-geral .box { text-align: center; }
          .totais-geral .valor { font-size: 18px; font-weight: 900; }
          .totais-geral .label { font-size: 10px; color: #555; margin-top: 2px; text-transform: uppercase; }
          .formas-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
          .forma-box { border: 1px solid #ddd; border-radius: 4px; padding: 8px; text-align: center; }
          .forma-box .nome { font-size: 10px; color: #666; }
          .forma-box .valor { font-size: 13px; font-weight: 800; margin-top: 2px; }
          .fechamento { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; page-break-inside: avoid; }
          .fechamento .data { font-size: 13px; font-weight: 800; color: #111; }
          .fechamento .sub-fech { font-size: 10px; color: #666; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
          th { background: #f0f0f0; padding: 5px 8px; text-align: left; font-weight: 700; border: 1px solid #ddd; }
          td { padding: 5px 8px; border: 1px solid #ddd; }
          .right { text-align: right; }
          .center { text-align: center; }
          .ok { color: #059669; font-weight: 700; }
          .sobrou { color: #2563EB; font-weight: 700; }
          .faltou { color: #DC2626; font-weight: 700; }
          .total-row { background: #f9f9f9; font-weight: 800; }
          .assinatura { margin-top: 30px; display: flex; justify-content: space-around; }
          .assinatura div { text-align: center; border-top: 1px solid #333; padding-top: 5px; width: 180px; font-size: 10px; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <div class="cabecalho">
          <div class="titulo">🏪 CaixaFácil — ${tituloRelatorio}</div>
          <div class="sub">Gerado em ${dataGer} · ${fechamentosParaImprimir.length} fechamento(s)</div>
        </div>

        <div class="totais-geral">
          <div class="box">
            <div class="label">📥 Total Esperado</div>
            <div class="valor" style="color:#3B82F6">${fmt(totalEsp)}</div>
          </div>
          <div class="box">
            <div class="label">📤 Total Entregue</div>
            <div class="valor" style="color:#059669">${fmt(totalEnt)}</div>
          </div>
          <div class="box">
            <div class="label">⚖️ Diferença</div>
            <div class="valor ${Math.abs(totalDifImp) < 0.01 ? "ok" : totalDifImp > 0 ? "sobrou" : "faltou"}">
              ${Math.abs(totalDifImp) < 0.01 ? "✅ OK" : (totalDifImp >= 0 ? "+" : "") + fmt(totalDifImp)}
            </div>
          </div>
        </div>

        <div class="formas-row">
          ${formas.map((pt) => `
            <div class="forma-box">
              <div class="nome">${pt.icon} ${pt.label}</div>
              <div class="valor" style="color:${pt.color}">${fmt(totalPorFormaImp[pt.key] || 0)}</div>
            </div>
          `).join("")}
        </div>

        ${fechamentosParaImprimir.map((f) => `
          <div class="fechamento">
            <div class="data">📅 ${f.dataFormatada}</div>
            <div class="sub-fech">${f.vendedores.length} vendedor(es) · fechado às ${f.horaFormatada}</div>
            <table>
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th class="right">Esperado</th>
                  <th class="right">Entregue</th>
                  <th class="center">Status</th>
                  <th class="right">Diferença</th>
                  <th>Conferido por</th>
                </tr>
              </thead>
              <tbody>
                ${f.vendedores.map((v) => {
                  const p = v.prestacao;
                  const cls = !p ? "" : p.status === "ok" ? "ok" : p.status === "sobrou" ? "sobrou" : "faltou";
                  return `
                    <tr>
                      <td><strong>${v.nome}</strong></td>
                      <td class="right">${fmt(v.total)}</td>
                      <td class="right">${p ? fmt(p.totalEntregue) : "—"}</td>
                      <td class="center ${cls}">
                        ${!p ? "⏳ Pendente" : p.status === "ok" ? "✅ OK" : p.status === "sobrou" ? "📈 Sobrou" : "⚠️ Faltou"}
                      </td>
                      <td class="right ${cls}">
                        ${!p ? "—" : p.status === "ok" ? "R$ 0,00" : (p.diferenca >= 0 ? "+" : "") + fmt(p.diferenca)}
                      </td>
                      <td style="font-size:9px">${nomeConferenteAtual(p?.conferente, conferentesLista) || "—"}</td>
                    </tr>
                  `;
                }).join("")}
                <tr class="total-row">
                  <td><strong>TOTAL</strong></td>
                  <td class="right"><strong>${fmt(f.totalEsperado)}</strong></td>
                  <td class="right"><strong>${fmt(f.totalEntregue || 0)}</strong></td>
                  <td class="center">${f.vendedores.filter((v) => v.prestacao).length}/${f.vendedores.length}</td>
                  <td class="right">
                    ${(() => {
                      const dif = (f.totalEntregue || 0) - f.totalEsperado;
                      if (Math.abs(dif) < 0.01) return '<span class="ok">✅ OK</span>';
                      return `<span class="${dif > 0 ? "sobrou" : "faltou"}">${dif >= 0 ? "+" : ""}${fmt(dif)}</span>`;
                    })()}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        `).join("")}

        <div class="assinatura">
          <div>Responsável pelo Caixa</div>
          <div>Gerente / Supervisor</div>
        </div>
      </body>
      </html>
    `;

    const janela = window.open("", "_blank", "width=900,height=700");
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 500);
  };

  if (historico.length === 0) {
    return (
      <div style={card}>
        <h2 style={cardTitle}>📅 Histórico de Fechamentos</h2>
        <div style={{ textAlign: "center", color: "#475569", padding: "40px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14 }}>Nenhum fechamento salvo ainda.</div>
          <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>
            Lance os vendedores, confira as prestações e clique em<br />
            <strong style={{ color: "#10B981" }}>"📅 Fechar o Dia"</strong> no Resumo Geral.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>📅 Histórico de Fechamentos</h2>

        {/* Filtros */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          {[["todos","🗂️ Todos"],["hoje","📆 Hoje"],["semana","📅 Esta Semana"],["mes","🗓️ Por Mês"],["periodo","📆 Por Período"]].map(([k,l]) => (
            <button key={k} style={{ ...btn, background: filtro === k ? "#10B981" : "#1E293B", fontSize: 12, padding: "7px 14px" }}
              onClick={() => setFiltro(k)}>{l}</button>
          ))}
          {filtro === "mes" && (
            <input type="month" style={{ ...inputStyle, width: "auto", padding: "7px 12px" }}
              value={mesSel} onChange={(e) => setMesSel(e.target.value)} />
          )}
          <span style={{ fontSize: 12, color: "#64748B", marginLeft: "auto" }}>
            {filtrados.length} fechamento(s)
          </span>
        </div>

        {/* Filtro por período (datas inicial e final) */}
        {filtro === "periodo" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "center", background: "#0D1527", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px" }}>
            <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>📅 De:</span>
            <input type="date" style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }} value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>até:</span>
            <input type="date" style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12 }} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            {dataIni && dataFim && (
              <span style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>
                ✅ {new Date(dataIni + "T12:00:00").toLocaleDateString("pt-BR")} até {new Date(dataFim + "T12:00:00").toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        )}

        {/* Botão de imprimir o período filtrado em PDF */}
        {filtrados.length > 0 && (
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
            <button
              style={{ ...btn, background: "#DC2626", fontSize: 13, padding: "10px 18px", display: "flex", alignItems: "center", gap: 8 }}
              onClick={() => {
                let titulo = "Relatório de Fechamentos";
                if (filtro === "hoje") titulo = `Relatório — Hoje (${new Date().toLocaleDateString("pt-BR")})`;
                else if (filtro === "semana") titulo = "Relatório — Esta Semana";
                else if (filtro === "mes" && mesSel) {
                  const [ano, mes] = mesSel.split("-");
                  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
                  titulo = `Relatório — ${meses[Number(mes)-1]}/${ano}`;
                }
                else if (filtro === "periodo" && dataIni && dataFim) {
                  titulo = `Relatório — ${new Date(dataIni + "T12:00:00").toLocaleDateString("pt-BR")} a ${new Date(dataFim + "T12:00:00").toLocaleDateString("pt-BR")}`;
                }
                else titulo = "Relatório — Todos os Fechamentos";
                imprimirRelatorio(filtrados, titulo);
              }}
            >
              🖨️ Imprimir PDF do período ({filtrados.length} fechamento{filtrados.length > 1 ? "s" : ""})
            </button>
          </div>
        )}

        {/* Totais do período */}
        {filtrados.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "#1e3a5f", border: "1px solid #3B82F666", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4, textTransform: "uppercase" }}>📥 Total Esperado</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#3B82F6" }}>{fmt(totalPeriodo)}</div>
            </div>
            <div style={{ background: "#052e16", border: "1px solid #10B98166", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4, textTransform: "uppercase" }}>📤 Total Entregue</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#10B981" }}>{fmt(totalEntregue)}</div>
            </div>
            <div style={{ background: Math.abs(totalDif) < 0.01 ? "#052e16" : totalDif > 0 ? "#1e3a5f" : "#450a0a", border: `1px solid ${Math.abs(totalDif) < 0.01 ? "#10B981" : totalDif > 0 ? "#3B82F6" : "#EF4444"}66`, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4, textTransform: "uppercase" }}>⚖️ Diferença</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: Math.abs(totalDif) < 0.01 ? "#10B981" : totalDif > 0 ? "#3B82F6" : "#EF4444" }}>
                {(totalDif >= 0 ? "+" : "") + fmt(totalDif)}
              </div>
            </div>
          </div>
        )}

        {/* Lista de fechamentos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtrados.length === 0 && (
            <div style={{ textAlign: "center", color: "#475569", padding: "20px 0" }}>
              Nenhum fechamento neste período.
            </div>
          )}
          {filtrados.map((f) => {
            const dif = (f.totalEntregue || 0) - f.totalEsperado;
            const ok = Math.abs(dif) < 0.01;
            const sobrou = dif > 0.01;
            const cor = ok ? "#10B981" : sobrou ? "#3B82F6" : "#EF4444";
            return (
              <div key={f.id} style={{ background: "#1E293B", border: `1px solid ${cor}44`, borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: "#F1F5F9", fontSize: 15 }}>📅 {f.dataFormatada}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      {f.vendedores.length} vendedor(es) · fechado às {f.horaFormatada}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cor, background: cor + "22", border: `1px solid ${cor}55`, borderRadius: 20, padding: "3px 12px" }}>
                      {ok ? "✅ Conferiu" : sobrou ? `📈 +${fmt(Math.abs(dif))}` : `⚠️ -${fmt(Math.abs(dif))}`}
                    </span>
                    <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => abrirFechamento(f)}>👁️ Ver</button>
                    <button style={{ ...miniBtn, background: "#F97316" }} onClick={() => editarFechamento(f)}>✏️ Editar</button>
                    <button
                      style={{ ...miniBtn, background: "#DC2626" }}
                      title="Imprimir PDF deste fechamento"
                      onClick={() => imprimirRelatorio([f], `Fechamento — ${f.dataFormatada}`)}
                    >
                      🖨️ PDF
                    </button>
                    <button style={{ ...miniBtn, background: "#7C3AED" }} onClick={() => {
                      const dataAtual = new Date(f.timestamp).toISOString().split("T")[0];
                      const novaData = prompt("📅 Digite a nova data (AAAA-MM-DD):\n\nData atual: " + dataAtual, dataAtual);
                      if (!novaData) return;
                      const novaDataObj = new Date(novaData + "T12:00:00");
                      if (isNaN(novaDataObj.getTime())) return alert("Data inválida! Use o formato AAAA-MM-DD. Ex: 2026-04-20");
                      setHistorico((prev) => prev.map((item) => item.id === f.id ? {
                        ...item,
                        timestamp: novaDataObj.toISOString(),
                        dataFormatada: novaDataObj.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }),
                      } : item));
                    }}>📅 Data</button>
                    <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => removerFechamento(f.id)}>🗑️</button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B" }}>Esperado</div>
                    <div style={{ fontWeight: 800, color: "#3B82F6", fontSize: 14 }}>{fmt(f.totalEsperado)}</div>
                  </div>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B" }}>Entregue</div>
                    <div style={{ fontWeight: 800, color: "#10B981", fontSize: 14 }}>{fmt(f.totalEntregue || 0)}</div>
                  </div>
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#64748B" }}>Diferença</div>
                    <div style={{ fontWeight: 800, color: cor, fontSize: 14 }}>{(dif >= 0 ? "+" : "") + fmt(dif)}</div>
                  </div>
                </div>
                {/* Formas do dia */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                  {formas.filter((pt) => (f.totalPorForma?.[pt.key] || 0) > 0).map((pt) => (
                    <span key={pt.key} style={{ fontSize: 10, fontWeight: 600, border: `1px solid ${pt.color}66`, color: pt.color, borderRadius: 16, padding: "2px 8px" }}>
                      {pt.icon} {pt.label}: {fmt(f.totalPorForma[pt.key])}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   TELA DE LOGIN
══════════════════════════════════════ */
function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const entrar = async (e) => {
    e?.preventDefault();
    if (!usuario.trim() || !senha) return setErro("Preencha usuário e senha.");
    setCarregando(true);
    setErro("");
    const { data, error } = await fazerLogin(usuario, senha);
    setCarregando(false);
    if (error) return setErro(error);
    onLogin(data);
  };

  return (
    <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={entrar} style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 32, width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏪</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#F1F5F9", margin: 0 }}>CaixaFácil</h1>
          <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>Entre com seu usuário</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>👤 Usuário</label>
          <input
            style={inputStyle}
            type="text"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="seu usuário"
            autoFocus
            autoComplete="username"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>🔑 Senha</label>
          <input
            style={inputStyle}
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="sua senha"
            autoComplete="current-password"
          />
        </div>

        {erro && (
          <div style={{ background: "#450a0a", border: "1px solid #EF444455", borderRadius: 8, padding: "10px 14px", color: "#FCA5A5", fontSize: 13, marginBottom: 16 }}>
            ⚠️ {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={carregando}
          style={{ ...btn, background: "#10B981", width: "100%", fontSize: 15, padding: "12px", opacity: carregando ? 0.6 : 1 }}
        >
          {carregando ? "Entrando..." : "🔓 Entrar"}
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════
   TELA DE CONFIGURAÇÃO INICIAL
   (quando ainda não tem nenhum conferente cadastrado)
══════════════════════════════════════ */
function SetupScreen({ onConfigurado }) {
  const [nome, setNome] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const criar = async (e) => {
    e?.preventDefault();
    if (!nome.trim()) return setErro("Digite seu nome completo.");
    if (!usuario.trim()) return setErro("Digite um nome de usuário.");
    if (senha.length < 4) return setErro("Senha deve ter pelo menos 4 caracteres.");
    if (senha !== senha2) return setErro("As senhas não coincidem.");
    setCarregando(true);
    setErro("");
    const { data, error } = await criarConferente({ nome, usuario, senha, admin: true });
    setCarregando(false);
    if (error) return setErro(error);
    salvarUsuarioLogado({ id: data.id, nome: data.nome, usuario: data.usuario, admin: true, ativo: true });
    onConfigurado({ id: data.id, nome: data.nome, usuario: data.usuario, admin: true, ativo: true });
  };

  return (
    <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={criar} style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 32, width: "100%", maxWidth: 460 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏪</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F1F5F9", margin: 0 }}>Bem-vinda ao CaixaFácil!</h1>
          <div style={{ fontSize: 13, color: "#64748B", marginTop: 6 }}>
            Primeira vez por aqui. Vamos criar sua conta de <strong style={{ color: "#F97316" }}>administradora</strong>.
          </div>
        </div>

        <div style={{ background: "#1E293B", border: "1px solid #F97316", borderRadius: 10, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "#F97316" }}>
          🔐 Como administradora, você poderá criar e gerenciar os outros usuários (conferentes) depois.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>👤 Seu nome completo</label>
          <input style={inputStyle} type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Detty Rodrigues" autoFocus />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>🔖 Nome de usuário (para login)</label>
          <input style={inputStyle} type="text" value={usuario} onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="Ex: detty" autoComplete="off" />
          <div style={{ fontSize: 10, color: "#64748B", marginTop: 3 }}>Sem espaços, só letras/números (vai ficar em minúsculo)</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>🔑 Senha</label>
            <input style={inputStyle} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mín. 4 caracteres" autoComplete="new-password" />
          </div>
          <div>
            <label style={labelStyle}>🔑 Repita a senha</label>
            <input style={inputStyle} type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} placeholder="igual à de cima" autoComplete="new-password" />
          </div>
        </div>

        {erro && (
          <div style={{ background: "#450a0a", border: "1px solid #EF444455", borderRadius: 8, padding: "10px 14px", color: "#FCA5A5", fontSize: 13, marginBottom: 16 }}>
            ⚠️ {erro}
          </div>
        )}

        <button type="submit" disabled={carregando} style={{ ...btn, background: "#10B981", width: "100%", fontSize: 15, padding: "12px", opacity: carregando ? 0.6 : 1 }}>
          {carregando ? "Criando conta..." : "✅ Criar minha conta"}
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════
   ABA CONFERENTES — Gerenciar usuários com login
   (visível só para administradores)
══════════════════════════════════════ */
/* ══════════════════════════════════════
   ABA MENSAGENS — Envio pelo WhatsApp com modelos prontos
══════════════════════════════════════ */
function MensagensTab({ cadastros, vendedores, currentUser }) {
  const [vendedorId, setVendedorId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [editou, setEditou] = useState(false);

  // Combina vendedores cadastrados com os de hoje (prioriza telefone atualizado)
  const todosVendedores = [
    ...cadastros.map((c) => ({ ...c, tipo: "cadastro" })),
  ];
  // Adiciona vendedores de hoje que não estão nos cadastros
  vendedores.forEach((v) => {
    if (!todosVendedores.some((c) => c.nome.trim().toLowerCase() === v.nome.trim().toLowerCase())) {
      todosVendedores.push({ id: v.id, nome: v.nome, telefone: v.telefone, tipo: "entrada" });
    }
  });

  const vendedorSel = todosVendedores.find((v) => String(v.id) === String(vendedorId));

  // Busca prestação de hoje do vendedor (se existir)
  const entradaHoje = vendedorSel ? vendedores.find((v) => v.nome.trim().toLowerCase() === vendedorSel.nome.trim().toLowerCase()) : null;
  const prestacaoHoje = entradaHoje?.prestacao;

  const TEMPLATES = [
    {
      id: "falta_pix",
      icone: "⚡",
      nome: "Falta comprovante de PIX",
      texto: "Olá {nome}, tudo bem? 🙂\n\nEstá faltando o comprovante do *PIX* da sua prestação de hoje. Pode me enviar por favor?\n\nObrigada!",
    },
    {
      id: "falta_dinheiro",
      icone: "💵",
      nome: "Falta dinheiro em espécie",
      texto: "Olá {nome}, tudo bem? 🙂\n\nEstá faltando *dinheiro em espécie* na sua prestação de hoje. Pode conferir e me retornar?\n\nObrigada!",
    },
    {
      id: "gas_divergente",
      icone: "⛽",
      nome: "Vasilhame/gás não bate",
      texto: "Olá {nome}, tudo bem? 🙂\n\nOs valores do *vasilhame/gás* não estão batendo com a conferência. Pode verificar e me retornar?\n\nObrigada!",
    },
    {
      id: "falta_deposito",
      icone: "🏦",
      nome: "Aguardando depósito",
      texto: "Olá {nome}, tudo bem? 🙂\n\nAinda estamos aguardando o *comprovante do depósito* da sua prestação. Pode me enviar quando possível?\n\nObrigada!",
    },
    {
      id: "divergencia_geral",
      icone: "⚠️",
      nome: "Divergência na prestação",
      texto: "Olá {nome}, tudo bem? 🙂\n\nIdentifiquei uma *divergência* na sua prestação. Pode entrar em contato comigo quando puder para conferirmos juntos?\n\nObrigada!",
    },
    {
      id: "pendencia_anterior",
      icone: "⏮️",
      nome: "Pendência de dias anteriores",
      texto: "Olá {nome}, tudo bem? 🙂\n\nAinda está em aberto uma *pendência de prestação de dias anteriores*. Pode me procurar para acertarmos?\n\nObrigada!",
    },
    {
      id: "contato",
      icone: "📞",
      nome: "Entre em contato",
      texto: "Olá {nome}, tudo bem? 🙂\n\nPreciso falar com você sobre a sua *prestação*. Quando puder, me liga ou me chama aqui no WhatsApp.\n\nObrigada!",
    },
    {
      id: "custom",
      icone: "✏️",
      nome: "Mensagem personalizada (escrever do zero)",
      texto: "",
    },
  ];

  const aplicarTemplate = (id) => {
    setTemplateId(id);
    setEditou(false);
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (t.id === "custom") {
      setMensagem("");
    } else {
      const nomeFirst = vendedorSel ? vendedorSel.nome.split(" ")[0] : "{nome}";
      setMensagem(t.texto.replace(/\{nome\}/g, nomeFirst));
    }
  };

  // Atualiza mensagem se trocar vendedor E tiver template aplicado
  useEffect(() => {
    if (templateId && templateId !== "custom" && !editou) {
      aplicarTemplate(templateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendedorId]);

  const abrirWhatsApp = () => {
    if (!vendedorSel) return alert("Selecione um vendedor.");
    if (!vendedorSel.telefone) return alert("Esse vendedor não tem WhatsApp cadastrado. Edite o cadastro primeiro.");
    if (!mensagem.trim()) return alert("A mensagem está vazia.");
    const tel = "55" + vendedorSel.telefone.replace(/\D/g, "");
    const assinatura = currentUser ? `\n\n_${currentUser.nome}_` : "";
    const msg = mensagem + assinatura;
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>💬 Enviar Mensagem WhatsApp</h2>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 20 }}>
          Envie avisos rápidos para os vendedores sobre pendências ou divergências na prestação.
        </div>

        {/* Selecionar vendedor */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>👤 Para quem é a mensagem?</label>
          {todosVendedores.length === 0 ? (
            <div style={{ color: "#FCA5A5", fontSize: 13, padding: "12px 14px", background: "#1E293B", borderRadius: 8, border: "1px solid #7F1D1D" }}>
              ⚠️ Nenhum vendedor cadastrado. Cadastre pelo menos um na aba <strong>"Vendedores"</strong>.
            </div>
          ) : (
            <select style={inputStyle} value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              <option value="">-- Selecione o vendedor --</option>
              {todosVendedores
                .sort((a, b) => a.nome.localeCompare(b.nome))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}{v.telefone ? ` · 📱 ${v.telefone}` : " · ⚠️ SEM WHATSAPP"}
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* Dados do vendedor selecionado */}
        {vendedorSel && (
          <div style={{ background: "#0D1527", border: `1px solid ${vendedorSel.telefone ? "#10B98155" : "#EF444455"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#F1F5F9", fontWeight: 700 }}>👤 {vendedorSel.nome}</div>
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
              {vendedorSel.telefone ? `📱 ${vendedorSel.telefone}` : "⚠️ Sem WhatsApp cadastrado — não é possível enviar"}
            </div>
            {prestacaoHoje && (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "#1E293B", borderRadius: 6, fontSize: 11 }}>
                <span style={{ color: "#94A3B8" }}>📅 Prestação de hoje: </span>
                <strong style={{ color: prestacaoHoje.status === "ok" ? "#10B981" : prestacaoHoje.status === "sobrou" ? "#3B82F6" : "#EF4444" }}>
                  {prestacaoHoje.status === "ok" ? "✅ OK" : prestacaoHoje.status === "sobrou" ? `📈 Sobrou ${fmt(Math.abs(prestacaoHoje.diferenca))}` : `⚠️ Faltou ${fmt(Math.abs(prestacaoHoje.diferenca))}`}
                </strong>
              </div>
            )}
          </div>
        )}

        {/* Templates */}
        {vendedorSel && vendedorSel.telefone && (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>📝 Escolha o modelo de mensagem</label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 20 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => aplicarTemplate(t.id)}
                  style={{
                    background: templateId === t.id ? "#10B98122" : "#1E293B",
                    border: templateId === t.id ? "2px solid #10B981" : "1px solid #334155",
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: "#F1F5F9",
                    fontSize: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: 16, marginBottom: 3 }}>{t.icone}</div>
                  <div>{t.nome}</div>
                </button>
              ))}
            </div>

            {/* Caixa de mensagem */}
            {templateId && (
              <>
                <label style={labelStyle}>✉️ Mensagem (você pode editar)</label>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: 180,
                    resize: "vertical",
                    fontFamily: "'Segoe UI', sans-serif",
                    lineHeight: 1.5,
                  }}
                  value={mensagem}
                  onChange={(e) => { setMensagem(e.target.value); setEditou(true); }}
                  placeholder="Digite sua mensagem aqui..."
                />
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 6, marginBottom: 16 }}>
                  💡 Dica: Use *texto* para negrito no WhatsApp. Sua assinatura ({currentUser?.nome || "você"}) será adicionada automaticamente no final.
                </div>

                {/* Preview final */}
                <div style={{ background: "#064E3B22", border: "1px solid #10B98155", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: "#10B981", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
                    👁️ Pré-visualização da mensagem
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#F1F5F9", lineHeight: 1.6 }}>
                    {mensagem}
                    {currentUser && <div style={{ marginTop: 10, fontStyle: "italic", color: "#94A3B8" }}>_{currentUser.nome}_</div>}
                  </div>
                </div>

                <button
                  style={{ ...btn, background: "#25D366", width: "100%", fontSize: 15, padding: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
                  onClick={abrirWhatsApp}
                >
                  📲 Abrir WhatsApp e enviar
                </button>
              </>
            )}
          </>
        )}

        {vendedorSel && !vendedorSel.telefone && (
          <div style={{ background: "#450a0a", border: "1px solid #EF444455", borderRadius: 10, padding: "14px 18px", color: "#FCA5A5", fontSize: 13 }}>
            ⚠️ Este vendedor não tem WhatsApp cadastrado. Vá na aba <strong>"👥 Vendedores"</strong>, edite o cadastro e adicione o número de WhatsApp.
          </div>
        )}
      </div>
    </div>
  );
}

function ConferentesTab({ currentUser, onMudanca }) {
  const [conferentes, setConferentes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [novoUsuario, setNovoUsuario] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novoAdmin, setNovoAdmin] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [editandoSenhaId, setEditandoSenhaId] = useState(null);
  const [senhaInput, setSenhaInput] = useState("");
  const [editandoNomeId, setEditandoNomeId] = useState(null);
  const [nomeInput, setNomeInput] = useState("");

  const carregar = async () => {
    setCarregando(true);
    const lista = await listarConferentes();
    setConferentes(lista);
    setCarregando(false);
  };

  useEffect(() => { carregar(); }, []);

  const adicionar = async () => {
    setErro(""); setSucesso("");
    if (!novoNome.trim()) return setErro("Digite o nome completo.");
    if (!novoUsuario.trim()) return setErro("Digite um nome de usuário.");
    if (novaSenha.length < 4) return setErro("Senha deve ter pelo menos 4 caracteres.");
    const { error } = await criarConferente({ nome: novoNome, usuario: novoUsuario, senha: novaSenha, admin: novoAdmin });
    if (error) return setErro(error);
    setSucesso(`✅ Usuário ${novoNome} criado!`);
    setNovoNome(""); setNovoUsuario(""); setNovaSenha(""); setNovoAdmin(false);
    await carregar();
    onMudanca && onMudanca();
    setTimeout(() => setSucesso(""), 3000);
  };

  const toggleAtivo = async (c) => {
    if (c.id === currentUser.id) return alert("Você não pode desativar seu próprio usuário.");
    await atualizarConferente(c.id, { ativo: !c.ativo });
    await carregar();
    onMudanca && onMudanca();
  };

  const toggleAdmin = async (c) => {
    if (c.id === currentUser.id) return alert("Você não pode remover seus próprios privilégios de admin.");
    await atualizarConferente(c.id, { admin: !c.admin });
    await carregar();
    onMudanca && onMudanca();
  };

  const salvarSenha = async (id) => {
    if (senhaInput.length < 4) return alert("Senha deve ter pelo menos 4 caracteres.");
    const { error } = await mudarSenha(id, senhaInput);
    if (error) return alert("Erro: " + error);
    setEditandoSenhaId(null); setSenhaInput("");
    alert("✅ Senha atualizada!");
  };

  const salvarNome = async (id) => {
    if (!nomeInput.trim()) return alert("O nome não pode ficar em branco.");
    const { error } = await atualizarConferente(id, { nome: nomeInput.trim() });
    if (error) return alert("Erro: " + error);
    setEditandoNomeId(null); setNomeInput("");
    await carregar();
    onMudanca && onMudanca();
    alert("✅ Nome atualizado!");
  };

  const excluir = async (c) => {
    if (c.id === currentUser.id) return alert("Você não pode excluir seu próprio usuário.");
    if (!confirm(`Excluir o usuário ${c.nome}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await removerConferente(c.id);
    if (error) return alert("Erro: " + error);
    await carregar();
    onMudanca && onMudanca();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={card}>
        <h2 style={cardTitle}>➕ Adicionar Conferente</h2>
        <div style={{ fontSize: 12, color: "#64748B", marginBottom: 16 }}>
          Pessoas que vão fazer login para conferir as prestações de contas.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>👤 Nome completo</label>
            <input style={inputStyle} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex: João Paulo" />
          </div>
          <div>
            <label style={labelStyle}>🔖 Usuário (login)</label>
            <input style={inputStyle} value={novoUsuario} onChange={(e) => setNovoUsuario(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="Ex: joaopaulo" autoComplete="off" />
          </div>
          <div>
            <label style={labelStyle}>🔑 Senha inicial</label>
            <input style={inputStyle} type="text" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="mín. 4 caracteres" autoComplete="new-password" />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <input id="novoAdmin" type="checkbox" checked={novoAdmin} onChange={(e) => setNovoAdmin(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
          <label htmlFor="novoAdmin" style={{ fontSize: 13, color: "#F1F5F9", cursor: "pointer" }}>
            🛡️ Administrador (pode gerenciar outros usuários)
          </label>
        </div>

        {erro && <div style={{ background: "#450a0a", border: "1px solid #EF444455", borderRadius: 8, padding: "10px 14px", color: "#FCA5A5", fontSize: 13, marginBottom: 10 }}>⚠️ {erro}</div>}
        {sucesso && <div style={{ background: "#052e16", border: "1px solid #10B98155", borderRadius: 8, padding: "10px 14px", color: "#10B981", fontSize: 13, marginBottom: 10 }}>{sucesso}</div>}

        <button style={{ ...btn, background: "#10B981", width: "100%" }} onClick={adicionar}>
          ➕ Criar Usuário
        </button>
      </div>

      <div style={card}>
        <h2 style={cardTitle}>👥 Conferentes Cadastrados ({conferentes.length})</h2>
        {carregando ? (
          <div style={{ color: "#64748B", textAlign: "center", padding: 20 }}>Carregando...</div>
        ) : conferentes.length === 0 ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>Nenhum conferente cadastrado ainda.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {conferentes.map((c) => (
              <div key={c.id} style={{ background: c.ativo ? "#1E293B" : "#1A1A1A", border: `1px solid ${c.admin ? "#F9731655" : "#334155"}`, borderRadius: 12, padding: "14px 16px", opacity: c.ativo ? 1 : 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#F1F5F9", fontSize: 15 }}>
                      👤 {c.nome}
                      {c.admin && <span style={{ marginLeft: 8, fontSize: 10, background: "#F9731622", color: "#F97316", border: "1px solid #F9731655", borderRadius: 10, padding: "2px 8px" }}>🛡️ ADMIN</span>}
                      {!c.ativo && <span style={{ marginLeft: 8, fontSize: 10, background: "#334155", color: "#94A3B8", borderRadius: 10, padding: "2px 8px" }}>DESATIVADO</span>}
                      {c.id === currentUser.id && <span style={{ marginLeft: 8, fontSize: 10, background: "#10B98122", color: "#10B981", border: "1px solid #10B98155", borderRadius: 10, padding: "2px 8px" }}>VOCÊ</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>
                      🔖 <code style={{ background: "#0F172A", padding: "1px 6px", borderRadius: 4 }}>{c.usuario}</code>
                      {c.criado_em && <span style={{ marginLeft: 10 }}>· criado em {new Date(c.criado_em).toLocaleDateString("pt-BR")}</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {editandoNomeId === c.id ? (
                    <>
                      <input style={{ ...inputStyle, width: 240, padding: "5px 10px", fontSize: 12 }} type="text" value={nomeInput} onChange={(e) => setNomeInput(e.target.value)} placeholder="Novo nome completo" autoFocus />
                      <button style={{ ...miniBtn, background: "#10B981" }} onClick={() => salvarNome(c.id)}>✓ Salvar nome</button>
                      <button style={{ ...miniBtn, background: "#374151" }} onClick={() => { setEditandoNomeId(null); setNomeInput(""); }}>Cancelar</button>
                    </>
                  ) : editandoSenhaId === c.id ? (
                    <>
                      <input style={{ ...inputStyle, width: 160, padding: "5px 10px", fontSize: 12 }} type="text" value={senhaInput} onChange={(e) => setSenhaInput(e.target.value)} placeholder="Nova senha" autoFocus />
                      <button style={{ ...miniBtn, background: "#10B981" }} onClick={() => salvarSenha(c.id)}>✓ Salvar</button>
                      <button style={{ ...miniBtn, background: "#374151" }} onClick={() => { setEditandoSenhaId(null); setSenhaInput(""); }}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button style={{ ...miniBtn, background: "#7C3AED" }} onClick={() => { setEditandoNomeId(c.id); setNomeInput(c.nome); }}>✏️ Editar nome</button>
                      <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => { setEditandoSenhaId(c.id); setSenhaInput(""); }}>🔑 Mudar senha</button>
                      {c.id !== currentUser.id && (
                        <>
                          <button style={{ ...miniBtn, background: c.admin ? "#374151" : "#F97316" }} onClick={() => toggleAdmin(c)}>
                            {c.admin ? "Remover admin" : "🛡️ Tornar admin"}
                          </button>
                          <button style={{ ...miniBtn, background: c.ativo ? "#78716C" : "#10B981" }} onClick={() => toggleAtivo(c)}>
                            {c.ativo ? "⏸️ Desativar" : "▶️ Reativar"}
                          </button>
                          <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => excluir(c)}>🗑️ Excluir</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   APP PRINCIPAL
══════════════════════════════════════ */
export default function App() {
  const [aba, setAba] = useState("entrada");
  const [fechamentoVer, setFechamentoVer] = useState(null);

  // Autenticação
  const [currentUser, setCurrentUser] = useState(() => carregarUsuarioLogado());
  const [authEstado, setAuthEstado] = useState("verificando"); // "verificando" | "setup" | "login" | "ok"

  // Lista de conferentes (para exibir nome ATUALIZADO em prestações antigas)
  const [conferentesLista, setConferentesLista] = useState([]);
  const recarregarConferentes = async () => {
    if (!isSupabaseReady()) return;
    const lista = await listarConferentes();
    setConferentesLista(lista);
  };

  // Verifica se precisa de setup ou login na primeira carga
  useEffect(() => {
    if (!isSupabaseReady()) {
      setAuthEstado("ok"); // Sem nuvem = modo offline sem login
      return;
    }
    (async () => {
      const temAlgum = await temConferentes();
      if (!temAlgum) {
        setAuthEstado("setup");
      } else if (!currentUser) {
        setAuthEstado("login");
      } else {
        setAuthEstado("ok");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carrega lista de conferentes depois de logar
  useEffect(() => {
    if (authEstado === "ok" && isSupabaseReady()) {
      recarregarConferentes();
    }
  }, [authEstado]);

  const sair = () => {
    if (!confirm("Deseja sair?")) return;
    removerUsuarioLogado();
    setCurrentUser(null);
    setAuthEstado("login");
  };

  // Estado agora vem da NUVEM (Supabase). Mantém backup no localStorage.
  const [formas, setFormas, formasLoaded] = useCloudState("formas", PAYMENT_TYPES_PADRAO);
  const [vendedores, setVendedores, vendedoresLoaded] = useCloudState("vendedores", []);
  const [historico, setHistorico, historicoLoaded] = useCloudState("historico", []);
  const [cadastros, setCadastros, cadastrosLoaded] = useCloudState("cadastros", []);
  const [empresas, setEmpresas, empresasLoaded] = useCloudState("empresas", []);
  const [recibos, setRecibos, recibosLoaded] = useCloudState("recibos", []);
  const allLoaded = formasLoaded && vendedoresLoaded && historicoLoaded && cadastrosLoaded && empresasLoaded && recibosLoaded;
  const nuvem = isSupabaseReady();

  const totalGeral = vendedores.reduce((s, v) => s + v.total, 0);

  const limparTudo = () => {
    if (confirm("⚠️ Apagar todos os vendedores do dia atual? O histórico não será apagado."))
      setVendedores([]);
  };

  const fecharDia = () => {
    if (vendedores.length === 0) return alert("Nenhum vendedor lançado.");

    // Pede a data — padrão é hoje
    const hoje = new Date().toISOString().split("T")[0];
    const dataSelecionada = prompt(
      "📅 Informe a data do fechamento (AAAA-MM-DD):\n\nExemplo: " + hoje,
      hoje
    );
    if (!dataSelecionada) return; // cancelou

    const dataObj = new Date(dataSelecionada + "T12:00:00");
    if (isNaN(dataObj.getTime())) return alert("Data inválida! Use o formato AAAA-MM-DD. Ex: 2026-04-20");

    if (!confirm("Fechar o dia e salvar no histórico? Os vendedores atuais serão arquivados.")) return;

    const agora = new Date();
    const totalPorForma = {};
    const entreguePorForma = {};
    formas.forEach((pt) => {
      totalPorForma[pt.key] = vendedores.reduce((s, v) => s + (v.valores[pt.key] || 0), 0);
      entreguePorForma[pt.key] = vendedores.filter((v) => v.prestacao).reduce((s, v) => s + (v.prestacao.porForma?.[pt.key] || 0), 0);
    });
    const comPrestacao = vendedores.filter((v) => v.prestacao);
    const totalEsperado = vendedores.reduce((s, v) => s + v.total, 0);
    const totalEntregue = comPrestacao.reduce((s, v) => s + v.prestacao.totalEntregue, 0);
    const fechamento = {
      id: Date.now(),
      timestamp: dataObj.toISOString(),
      dataFormatada: dataObj.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }),
      horaFormatada: agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      vendedores: [...vendedores],
      totalEsperado,
      totalEntregue,
      totalPorForma,
      entreguePorForma,
    };
    setHistorico((prev) => [fechamento, ...prev]);

    // Atualiza saldo: FALTOU desconta, SOBROU vira crédito (acumula).
    // IMPORTANTE: faz UMA ÚNICA atualização com TODAS as mudanças de uma vez,
    // senão as chamadas sequenciais ao Supabase podem sobrescrever umas às outras.
    const diferencasPorNome = {};
    vendedores.forEach((v) => {
      if (v.prestacao && (v.prestacao.status === "faltou" || v.prestacao.status === "sobrou")) {
        const nomeKey = v.nome.trim().toLowerCase();
        const diferenca = v.prestacao.diferenca || 0;
        diferencasPorNome[nomeKey] = (diferencasPorNome[nomeKey] || 0) + diferenca;
      }
      // Se OK: saldo não muda (diferença = 0)
    });
    if (Object.keys(diferencasPorNome).length > 0) {
      setCadastros((prev) => prev.map((c) => {
        const nomeKey = c.nome.trim().toLowerCase();
        const dif = diferencasPorNome[nomeKey];
        if (dif !== undefined) {
          return { ...c, saldo: Math.round(((c.saldo || 0) + dif) * 100) / 100 };
        }
        return c;
      }));
    }

    setVendedores([]);
    alert("✅ Dia fechado! Saldos atualizados (faltou desconta, sobrou vira crédito).");
    setAba("historico");
  };

  // Tela de "verificando autenticação" (muito rápido, só pisca)
  if (authEstado === "verificando") {
    return (
      <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20, padding: 40 }}>
        <div style={{ fontSize: 48 }}>🏪</div>
        <div style={{ fontSize: 14, color: "#94A3B8" }}>Verificando...</div>
      </div>
    );
  }

  // Primeira vez usando o sistema — não tem conferente cadastrado
  if (authEstado === "setup") {
    return <SetupScreen onConfigurado={(u) => { setCurrentUser(u); setAuthEstado("ok"); }} />;
  }

  // Precisa fazer login
  if (authEstado === "login" || !currentUser) {
    return <LoginScreen onLogin={(u) => { setCurrentUser(u); setAuthEstado("ok"); }} />;
  }

  // Tela de carregamento enquanto busca dados da nuvem
  if (!allLoaded) {
    return (
      <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20, padding: 40 }}>
        <div style={{ fontSize: 48 }}>🏪</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#F1F5F9" }}>CaixaFácil</div>
        <div style={{ fontSize: 14, color: "#94A3B8" }}>☁️ Carregando dados da nuvem...</div>
        <div style={{ width: 200, height: 4, background: "#1E293B", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: "40%", height: "100%", background: "#10B981", animation: "slide 1.2s ease-in-out infinite" }}></div>
        </div>
        <style>{`@keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }`}</style>
      </div>
    );
  }

  return (
    <div style={root}>
      <div style={header}>
        <div>
          <div style={logo}>🏪 CaixaFácil</div>
          <div style={subLogo}>Sistema de Prestação de Contas · {nuvem ? "☁️ Nuvem" : "💾 Local"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {nuvem ? <SyncBadge /> : (
            <div style={{ fontSize: 11, color: "#10B981", background: "#052e16", border: "1px solid #10B98155", borderRadius: 8, padding: "5px 10px" }}>💾 Salvo automaticamente</div>
          )}
          {vendedores.length > 0 && (
            <>
              <div style={totalGeralBox}>
                <div style={{ fontSize: 10, color: "#64748B", marginBottom: 2, textTransform: "uppercase" }}>Total do Dia</div>
                <div style={{ color: "#10B981", fontWeight: 800, fontSize: 18 }}>{fmt(totalGeral)}</div>
                <div style={{ fontSize: 10, color: "#475569" }}>{vendedores.length} vendedor(es)</div>
              </div>
              <button onClick={fecharDia} style={{ ...btn, background: "#7C3AED", fontSize: 12, padding: "8px 14px" }}>
                📅 Fechar o Dia
              </button>
              <button onClick={limparTudo} style={{ background: "#7F1D1D", border: "1px solid #EF444444", borderRadius: 8, color: "#FCA5A5", cursor: "pointer", padding: "6px 12px", fontSize: 11, fontWeight: 700 }}>
                🗑️ Limpar
              </button>
            </>
          )}
          {historico.length > 0 && vendedores.length === 0 && (
            <div style={{ fontSize: 11, color: "#64748B", background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, padding: "5px 10px" }}>
              📅 {historico.length} fechamento(s) no histórico
            </div>
          )}
          {currentUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, padding: "6px 12px" }}>
              <span style={{ fontSize: 12, color: "#F1F5F9" }}>
                👋 Olá, <strong style={{ color: "#10B981" }}>{currentUser.nome.split(" ")[0]}</strong>
                {currentUser.admin && <span style={{ marginLeft: 6, fontSize: 9, background: "#F9731622", color: "#F97316", border: "1px solid #F9731555", borderRadius: 8, padding: "1px 6px" }}>ADMIN</span>}
              </span>
              <button
                onClick={sair}
                style={{ background: "transparent", border: "1px solid #334155", borderRadius: 6, color: "#94A3B8", cursor: "pointer", padding: "3px 10px", fontSize: 11, fontWeight: 600 }}
                title="Sair"
              >
                🚪 Sair
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...tabBar, overflowX: "auto" }}>
        <button style={aba === "cadastros" ? tabActive : tabInactive} onClick={() => setAba("cadastros")}>
          👥 Vendedores
          {cadastros.length > 0 && <span style={{ marginLeft: 5, background: "#F97316", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 6px" }}>{cadastros.length}</span>}
        </button>
        <button style={aba === "entrada" ? tabActive : tabInactive} onClick={() => setAba("entrada")}>📥 Entrada</button>
        <button style={aba === "contas" ? tabActive : tabInactive} onClick={() => setAba("contas")}>🧾 Prestação</button>
        <button style={aba === "resumo" ? tabActive : tabInactive} onClick={() => setAba("resumo")}>
          📊 Resumo
          {vendedores.length > 0 && <span style={{ marginLeft: 5, background: "#10B981", color: "#000", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 6px" }}>{vendedores.length}</span>}
        </button>
        <button style={aba === "mensagens" ? tabActive : tabInactive} onClick={() => setAba("mensagens")}>💬 Mensagens</button>
        <button style={aba === "impressao" ? tabActive : tabInactive} onClick={() => setAba("impressao")}>🖨️ Imprimir</button>
        <button style={aba === "recibos" ? tabActive : tabInactive} onClick={() => setAba("recibos")}>🧾 Recibos</button>
        <button style={aba === "historico" ? tabActive : tabInactive} onClick={() => setAba("historico")}>
          📅 Histórico
          {historico.length > 0 && <span style={{ marginLeft: 5, background: "#7C3AED", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "1px 6px" }}>{historico.length}</span>}
        </button>
        {currentUser?.admin && (
          <button style={aba === "folha" ? tabActive : tabInactive} onClick={() => setAba("folha")}>📋 Folha</button>
        )}
        {currentUser?.admin && (
          <button style={aba === "conferentes" ? tabActive : tabInactive} onClick={() => setAba("conferentes")}>
            🕵️ Conferentes
          </button>
        )}
        <button style={aba === "calculadora" ? tabActive : tabInactive} onClick={() => setAba("calculadora")}>🧮 Calculadora</button>
        {currentUser?.admin && (
          <button style={aba === "config" ? tabActive : tabInactive} onClick={() => setAba("config")}>⚙️ Config</button>
        )}
        {currentUser?.admin && (
          <button style={aba === "backup" ? tabActive : tabInactive} onClick={() => setAba("backup")}>💾 Backup</button>
        )}
      </div>

      <div style={content}>
        {aba === "cadastros" && <CadastroVendedoresTab cadastros={cadastros} setCadastros={setCadastros} />}
        {aba === "entrada" && <EntradaTab vendedores={vendedores} setVendedores={setVendedores} formas={formas} cadastros={cadastros} />}
        {aba === "contas" && <PrestaContasTab vendedores={vendedores} setVendedores={setVendedores} formas={formas} cadastros={cadastros} currentUser={currentUser} conferentesLista={conferentesLista} />}
        {aba === "folha" && currentUser?.admin && <FolhaModulo currentUser={currentUser} />}
        {aba === "recibos" && <RecibosTab currentUser={currentUser} empresas={empresas} setEmpresas={setEmpresas} recibos={recibos} setRecibos={setRecibos} />}
        {aba === "conferentes" && currentUser?.admin && <ConferentesTab currentUser={currentUser} onMudanca={recarregarConferentes} />}
        {aba === "resumo" && <ResumoTab vendedores={vendedores} formas={formas} fecharDia={fecharDia} conferentesLista={conferentesLista} />}
        {aba === "impressao" && <ImpressaoTab vendedores={vendedores} formas={formas} conferentesLista={conferentesLista} />}
        {aba === "historico" && <HistoricoTab historico={historico} setHistorico={setHistorico} formas={formas}
          conferentesLista={conferentesLista}
          abrirFechamento={(f) => { setFechamentoVer(f); setAba("ver_fechamento"); }}
          editarFechamento={(f) => { setFechamentoVer(f); setAba("editar_fechamento"); }}
        />}
        {aba === "ver_fechamento" && fechamentoVer && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...btn, background: "#374151" }} onClick={() => setAba("historico")}>← Voltar</button>
              <button style={{ ...btn, background: "#2563EB" }} onClick={() => setAba("editar_fechamento")}>✏️ Editar este Fechamento</button>
            </div>
            <div style={card}>
              <h2 style={cardTitle}>📅 {fechamentoVer.dataFormatada} — {fechamentoVer.horaFormatada}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12, marginBottom: 20 }}>
                <div style={{ background: "#1e3a5f", border: "1px solid #3B82F655", borderRadius: 12, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#94A3B8" }}>📥 ESPERADO</div>
                  <div style={{ fontWeight: 900, color: "#3B82F6", fontSize: 20 }}>{fmt(fechamentoVer.totalEsperado)}</div>
                </div>
                <div style={{ background: "#052e16", border: "1px solid #10B98155", borderRadius: 12, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#94A3B8" }}>📤 ENTREGUE</div>
                  <div style={{ fontWeight: 900, color: "#10B981", fontSize: 20 }}>{fmt(fechamentoVer.totalEntregue || 0)}</div>
                </div>
                <div style={{ background: "#1A2332", border: "1px solid #334155", borderRadius: 12, padding: 14, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#94A3B8" }}>👥 VENDEDORES</div>
                  <div style={{ fontWeight: 900, color: "#F1F5F9", fontSize: 20 }}>{fechamentoVer.vendedores.length}</div>
                </div>
              </div>
              {/* Formas do dia */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {formas.filter((pt) => (fechamentoVer.totalPorForma?.[pt.key] || 0) > 0).map((pt) => (
                  <div key={pt.key} style={{ background: pt.color + "22", border: `1px solid ${pt.color}55`, borderRadius: 10, padding: "8px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: pt.color, fontWeight: 700 }}>{pt.icon} {pt.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9" }}>{fmt(fechamentoVer.totalPorForma[pt.key])}</div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Vendedor</th>
                      <th style={{ ...th, textAlign: "right" }}>Total Entrada</th>
                      <th style={{ ...th, textAlign: "center" }}>Prestação</th>
                      <th style={{ ...th, textAlign: "right" }}>Diferença</th>
                      <th style={th}>🕵️ Conferido por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fechamentoVer.vendedores.map((v, i) => {
                      const p = v.prestacao;
                      const cor = !p ? "#64748B" : p.status === "ok" ? "#10B981" : p.status === "sobrou" ? "#3B82F6" : "#EF4444";
                      return (
                        <tr key={v.id} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527" }}>
                          <td style={{ ...td, fontWeight: 700, color: "#F1F5F9" }}>👤 {v.nome}</td>
                          <td style={{ ...td, textAlign: "right", color: "#3B82F6", fontWeight: 700 }}>{fmt(v.total)}</td>
                          <td style={{ ...td, textAlign: "center", color: cor, fontWeight: 700 }}>
                            {!p ? "⏳ Pendente" : p.status === "ok" ? "✅ OK" : p.status === "sobrou" ? "📈 Sobrou" : "⚠️ Faltou"}
                          </td>
                          <td style={{ ...td, textAlign: "right", color: cor, fontWeight: 700 }}>
                            {!p ? "—" : p.status === "ok" ? "R$ 0,00" : (p.diferenca >= 0 ? "+" : "") + fmt(p.diferenca)}
                          </td>
                          <td style={{ ...td, color: "#94A3B8", fontSize: 11 }}>
                            {nomeConferenteAtual(p?.conferente, conferentesLista) || "—"}
                            {p?.conferidoEm && <div style={{ fontSize: 9, color: "#475569", marginTop: 2 }}>{new Date(p.conferidoEm).toLocaleDateString("pt-BR")}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {aba === "editar_fechamento" && fechamentoVer && (
          <EditarFechamento
            fechamento={fechamentoVer}
            formas={formas}
            onSalvar={(fechamentoEditado) => {
              setHistorico((prev) => prev.map((f) => f.id === fechamentoEditado.id ? fechamentoEditado : f));
              setFechamentoVer(fechamentoEditado);
              setAba("ver_fechamento");
              alert("✅ Fechamento atualizado com sucesso!");
            }}
            onCancelar={() => setAba("ver_fechamento")}
          />
        )}
        {aba === "mensagens" && <MensagensTab cadastros={cadastros} vendedores={vendedores} currentUser={currentUser} />}
        {aba === "config" && currentUser?.admin && <ConfigTab formas={formas} setFormas={setFormas} />}
        {aba === "calculadora" && <CalculadoraTab />}
        {aba === "backup" && currentUser?.admin && (
          <BackupTab
            dados={{ vendedores, historico, cadastros, formas, empresas, recibos }}
            onImportar={(dados) => {
              if (dados.vendedores) setVendedores(dados.vendedores);
              if (dados.historico) setHistorico(dados.historico);
              if (dados.cadastros) setCadastros(dados.cadastros);
              if (dados.formas) setFormas(dados.formas);
              if (dados.empresas) setEmpresas(dados.empresas);
              if (dados.recibos) setRecibos(dados.recibos);
              alert("✅ Backup importado com sucesso!");
              setAba("entrada");
            }}
          />
        )}
      </div>
    </div>
  );
}
/* ══════ STYLES ══════ */
const root = { minHeight: "100vh", background: "linear-gradient(160deg,#020817 0%,#0F1629 60%,#0C1A2E 100%)", fontFamily: "'Segoe UI',sans-serif", color: "#E2E8F0" };
const header = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 14px", borderBottom: "1px solid #1E293B" };
const logo = { fontSize: 22, fontWeight: 800, color: "#F1F5F9" };
const subLogo = { fontSize: 11, color: "#64748B", marginTop: 2 };
const totalGeralBox = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 10, padding: "10px 16px", textAlign: "right" };
const tabBar = { display: "flex", padding: "0 24px", borderBottom: "1px solid #1E293B" };
const tabBase = { padding: "13px 16px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, transition: "all .2s", background: "transparent" };
const tabActive = { ...tabBase, color: "#10B981", borderBottom: "2px solid #10B981" };
const tabInactive = { ...tabBase, color: "#64748B", borderBottom: "2px solid transparent" };
const content = { padding: "20px 24px", maxWidth: 1100, margin: "0 auto" };
const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
const cardTitle = { fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 18, marginTop: 0 };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 };
const inputStyle = { width: "100%", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#F1F5F9", fontSize: 14, outline: "none", boxSizing: "border-box" };
const totalPill = { background: "#1E293B", borderRadius: 8, padding: "10px 16px", fontSize: 14, color: "#94A3B8", display: "flex", alignItems: "center" };
const btn = { padding: "10px 20px", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const miniBtn = { padding: "5px 9px", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", fontSize: 12 };
const itemCard = { background: "#1E293B", borderRadius: 10, padding: "14px 16px", border: "1px solid #334155" };
const tagPill = { fontSize: 11, fontWeight: 600, border: "1px solid", borderRadius: 20, padding: "3px 10px", background: "transparent" };
const th = { background: "#1E293B", padding: "11px 12px", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", borderBottom: "1px solid #334155" };
const td = { padding: "10px 12px", fontSize: 13, color: "#E2E8F0", borderBottom: "1px solid #1E293B", verticalAlign: "top" };
const thP = { background: "#f0f0f0", padding: "7px 10px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", border: "1px solid #ddd", color: "#333" };
const tdP = { padding: "7px 10px", border: "1px solid #ddd", fontSize: 12, verticalAlign: "middle", color: "#111" };
