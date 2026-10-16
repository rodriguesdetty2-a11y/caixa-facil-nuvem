// ══════════════════════════════════════════════════════════════
//  MÓDULO FOLHA — Etapa 2A (prova de conceito)
//  - Usa o MESMO Supabase e o MESMO login (tabela conferentes)
//  - Lê/escreve apenas tabelas com prefixo folha_
//  - Não mexe em nada do CaixaFácil (app_state, conferentes)
// ══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { supabase, isSupabaseReady } from "./supabase";

const fmtBRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (d) => {
  if (!d) return "—";
  const [a, m, dia] = String(d).slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
};

// Aceita "1.234,56", "1234,56", "1234.56"
const parseValor = (s) => {
  if (s === null || s === undefined || s === "") return 0;
  const t = String(s).trim();
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isNaN(n) ? 0 : n;
};

const formatCPF = (s) => {
  const d = String(s || "").replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

const formatTel = (s) => {
  const d = String(s || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

const FORM_VAZIO = {
  nome: "",
  cpf: "",
  telefone: "",
  cargo: "",
  data_admissao: "",
  salario: "",
  observacoes: "",
};

/* ══════ UNIDADES QUE O USUÁRIO PODE VER ══════
   Regra: se o conferente NÃO tem linha em folha_conferentes_unidades,
   ele vê TODAS as unidades. Se tem, vê só as listadas. Admin vê tudo. */
async function carregarUnidades(currentUser) {
  const { data: unidades, error } = await supabase
    .from("folha_unidades")
    .select("*")
    .order("ordem", { ascending: true });
  if (error) throw new Error("Erro ao carregar unidades: " + error.message);

  let lista = (unidades || []).filter((u) => u.ativa !== false);
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

/* ══════════════════════════════════════
   COMPONENTE PRINCIPAL
══════════════════════════════════════ */
export default function FolhaModulo({ currentUser }) {
  const [unidades, setUnidades] = useState([]);
  const [unidadeId, setUnidadeId] = useState(() => {
    try { return localStorage.getItem("folha_unidade_sel") || ""; } catch { return ""; }
  });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sub, setSub] = useState("funcionarios");

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
        if (lista.length > 0 && !lista.some((u) => u.id === unidadeId)) {
          setUnidadeId(lista[0].id);
        }
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (unidadeId) {
      try { localStorage.setItem("folha_unidade_sel", unidadeId); } catch {}
    }
  }, [unidadeId]);

  const unidade = unidades.find((u) => u.id === unidadeId);

  if (carregando) {
    return <div style={{ ...card, textAlign: "center", color: "#94A3B8" }}>☁️ Carregando módulo Folha...</div>;
  }
  if (erro) {
    return <div style={{ ...card, ...alertaErro }}>⚠️ {erro}</div>;
  }
  if (unidades.length === 0) {
    return (
      <div style={{ ...card, ...alertaErro }}>
        ⚠️ Nenhuma unidade disponível para o seu usuário. Fale com o administrador.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Cabeçalho do módulo: unidade + sub-abas */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#F1F5F9" }}>📋 Folha</span>
          {unidades.length > 1 ? (
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 10px" }}>
              {unidades.map((u) => <option key={u.id} value={u.id}>🏢 {u.nome}</option>)}
            </select>
          ) : (
            <span style={unidadePill}>🏢 {unidade?.nome}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={sub === "funcionarios" ? subAtiva : subInativa} onClick={() => setSub("funcionarios")}>👷 Funcionários</button>
          <button style={subEmBreve} disabled title="Próxima etapa">💸 Saídas (em breve)</button>
          <button style={subEmBreve} disabled title="Próxima etapa">🧾 Folha do mês (em breve)</button>
        </div>
      </div>

      {sub === "funcionarios" && unidade && (
        <FuncionariosTela key={unidade.id} unidade={unidade} currentUser={currentUser} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   TELA DE FUNCIONÁRIOS (CRUD)
══════════════════════════════════════ */
function FuncionariosTela({ unidade, currentUser }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [form, setForm] = useState(FORM_VAZIO);
  const [editId, setEditId] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("ativos"); // ativos | inativos | todos

  const avisar = (msg) => {
    setSucesso(msg);
    setTimeout(() => setSucesso(""), 3000);
  };

  const recarregar = async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("folha_funcionarios")
      .select("id, nome, cpf, telefone, cargo, data_admissao, salario, observacoes, ativo, criado_em")
      .eq("unidade_id", unidade.id)
      .order("nome", { ascending: true });
    if (error) setErro("Erro ao carregar funcionários: " + error.message);
    else { setErro(""); setLista(data || []); }
    setCarregando(false);
  };

  useEffect(() => { recarregar(); /* eslint-disable-next-line */ }, [unidade.id]);

  const limparForm = () => { setForm(FORM_VAZIO); setEditId(null); };

  const salvar = async () => {
    setErro("");
    const nome = form.nome.trim();
    if (!nome) { setErro("Informe o nome do funcionário."); return; }

    const duplicado = lista.find(
      (f) => f.id !== editId && f.nome.trim().toLowerCase() === nome.toLowerCase()
    );
    if (duplicado && !confirm(`Já existe "${duplicado.nome}" nesta unidade. Salvar mesmo assim?`)) return;

    const registro = {
      nome: nome.toUpperCase(),
      cpf: form.cpf.trim() || null,
      telefone: form.telefone.trim() || null,
      cargo: form.cargo.trim() || null,
      data_admissao: form.data_admissao || null,
      salario: parseValor(form.salario),
      observacoes: form.observacoes.trim() || null,
    };

    setSalvando(true);
    let error;
    if (editId) {
      ({ error } = await supabase
        .from("folha_funcionarios")
        .update({ ...registro, atualizado_em: new Date().toISOString() })
        .eq("id", editId));
    } else {
      ({ error } = await supabase
        .from("folha_funcionarios")
        .insert({ ...registro, unidade_id: unidade.id, ativo: true }));
    }
    setSalvando(false);

    if (error) { setErro("Erro ao salvar: " + error.message); return; }
    avisar(editId ? "✅ Funcionário atualizado!" : "✅ Funcionário cadastrado!");
    limparForm();
    recarregar();
  };

  const editar = (f) => {
    setEditId(f.id);
    setForm({
      nome: f.nome || "",
      cpf: f.cpf || "",
      telefone: f.telefone || "",
      cargo: f.cargo || "",
      data_admissao: f.data_admissao ? String(f.data_admissao).slice(0, 10) : "",
      salario: f.salario ? String(Number(f.salario).toFixed(2)).replace(".", ",") : "",
      observacoes: f.observacoes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const alternarAtivo = async (f) => {
    const acao = f.ativo ? "DESATIVAR" : "REATIVAR";
    if (!confirm(`${acao} ${f.nome}?`)) return;
    const { error } = await supabase
      .from("folha_funcionarios")
      .update({ ativo: !f.ativo, atualizado_em: new Date().toISOString() })
      .eq("id", f.id);
    if (error) { setErro("Erro: " + error.message); return; }
    avisar(f.ativo ? "Funcionário desativado." : "Funcionário reativado.");
    recarregar();
  };

  const excluir = async (f) => {
    if (!currentUser?.admin) { alert("Só administrador pode excluir. Use 'Desativar'."); return; }
    if (!confirm(`EXCLUIR DEFINITIVAMENTE ${f.nome}?\n\nIsso apaga também todos os lançamentos dele na Folha (saídas, comissões etc).\nSe ele só saiu da empresa, prefira DESATIVAR.`)) return;
    const { error } = await supabase.from("folha_funcionarios").delete().eq("id", f.id);
    if (error) { setErro("Erro ao excluir: " + error.message); return; }
    if (editId === f.id) limparForm();
    avisar("🗑️ Funcionário excluído.");
    recarregar();
  };

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return lista.filter((f) => {
      if (filtro === "ativos" && !f.ativo) return false;
      if (filtro === "inativos" && f.ativo) return false;
      if (!b) return true;
      return (
        f.nome?.toLowerCase().includes(b) ||
        f.cargo?.toLowerCase().includes(b) ||
        (f.cpf || "").replace(/\D/g, "").includes(b.replace(/\D/g, "") || "§")
      );
    });
  }, [lista, busca, filtro]);

  const qtdAtivos = lista.filter((f) => f.ativo).length;
  const qtdInativos = lista.length - qtdAtivos;
  const totalSalarios = lista.filter((f) => f.ativo).reduce((s, f) => s + (Number(f.salario) || 0), 0);

  const campo = (k) => ({
    value: form[k],
    onChange: (e) => setForm({ ...form, [k]: e.target.value }),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* FORMULÁRIO */}
      <div style={{ ...card, borderColor: editId ? "#3B82F6" : "#1E293B" }}>
        <h2 style={cardTitle}>{editId ? "✏️ Editando funcionário" : "➕ Novo funcionário"}</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Nome completo *</label>
            <input style={inputStyle} placeholder="Ex: JOSÉ DA SILVA" {...campo("nome")}
              onKeyDown={(e) => e.key === "Enter" && salvar()} />
          </div>
          <div>
            <label style={labelStyle}>Cargo / Função</label>
            <input style={inputStyle} placeholder="Ex: Motorista" {...campo("cargo")} />
          </div>
          <div>
            <label style={labelStyle}>Salário (R$)</label>
            <input style={inputStyle} inputMode="decimal" placeholder="0,00" {...campo("salario")} />
          </div>
          <div>
            <label style={labelStyle}>Data de admissão</label>
            <input style={inputStyle} type="date" {...campo("data_admissao")} />
          </div>
          <div>
            <label style={labelStyle}>CPF</label>
            <input style={inputStyle} inputMode="numeric" placeholder="000.000.000-00"
              value={form.cpf} onChange={(e) => setForm({ ...form, cpf: formatCPF(e.target.value) })} />
          </div>
          <div>
            <label style={labelStyle}>Telefone / WhatsApp</label>
            <input style={inputStyle} inputMode="tel" placeholder="(87) 99999-9999"
              value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatTel(e.target.value) })} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Observações</label>
            <input style={inputStyle} placeholder="Opcional" {...campo("observacoes")} />
          </div>
        </div>

        {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
        {sucesso && <div style={{ ...alertaOk, marginTop: 12 }}>{sucesso}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#10B981", opacity: salvando ? 0.6 : 1 }} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : editId ? "💾 Salvar alterações" : "➕ Cadastrar"}
          </button>
          {editId && <button style={{ ...btn, background: "#374151" }} onClick={limparForm}>Cancelar</button>}
        </div>
      </div>

      {/* RESUMO */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        <Indicador titulo="👷 Ativos" valor={qtdAtivos} cor="#10B981" />
        <Indicador titulo="💤 Inativos" valor={qtdInativos} cor="#64748B" />
        <Indicador titulo="💰 Salários (ativos)" valor={fmtBRL(totalSalarios)} cor="#3B82F6" />
      </div>

      {/* LISTA */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <h2 style={{ ...cardTitle, marginBottom: 0 }}>Funcionários — {unidade.nome}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, width: 200, padding: "7px 10px" }} placeholder="🔍 Buscar nome, cargo, CPF"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select style={{ ...inputStyle, width: "auto", padding: "7px 10px" }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
        </div>

        {carregando ? (
          <div style={{ color: "#64748B", textAlign: "center", padding: 20 }}>Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>
            {lista.length === 0 ? "Nenhum funcionário cadastrado nesta unidade ainda." : "Nenhum funcionário encontrado com esse filtro."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={th}>Nome</th>
                  <th style={th}>Cargo</th>
                  <th style={{ ...th, textAlign: "right" }}>Salário</th>
                  <th style={th}>Admissão</th>
                  <th style={th}>Telefone</th>
                  <th style={{ ...th, textAlign: "center" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((f, i) => (
                  <tr key={f.id} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527", opacity: f.ativo ? 1 : 0.55 }}>
                    <td style={{ ...td, fontWeight: 700, color: "#F1F5F9" }}>
                      {f.nome}
                      {!f.ativo && <span style={inativoPill}>INATIVO</span>}
                      {f.cpf && <div style={{ fontSize: 10, color: "#64748B", fontWeight: 400 }}>CPF {f.cpf}</div>}
                      {f.observacoes && <div style={{ fontSize: 10, color: "#64748B", fontWeight: 400 }}>📝 {f.observacoes}</div>}
                    </td>
                    <td style={td}>{f.cargo || "—"}</td>
                    <td style={{ ...td, textAlign: "right", color: "#3B82F6", fontWeight: 700 }}>{fmtBRL(f.salario)}</td>
                    <td style={td}>{fmtData(f.data_admissao)}</td>
                    <td style={td}>{f.telefone || "—"}</td>
                    <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => editar(f)} title="Editar">✏️</button>{" "}
                      <button style={{ ...miniBtn, background: f.ativo ? "#B45309" : "#059669" }} onClick={() => alternarAtivo(f)} title={f.ativo ? "Desativar" : "Reativar"}>
                        {f.ativo ? "💤" : "♻️"}
                      </button>{" "}
                      {currentUser?.admin && (
                        <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(f)} title="Excluir">🗑️</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Indicador({ titulo, valor, cor }) {
  return (
    <div style={{ background: "#0F172A", border: `1px solid ${cor}55`, borderRadius: 12, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontWeight: 900, color: cor, fontSize: 20, marginTop: 4 }}>{valor}</div>
    </div>
  );
}

/* ══════ ESTILOS (mesmo visual do CaixaFácil) ══════ */
const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
const cardTitle = { fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 18, marginTop: 0 };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 };
const inputStyle = { width: "100%", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#F1F5F9", fontSize: 14, outline: "none", boxSizing: "border-box" };
const btn = { padding: "10px 20px", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const miniBtn = { padding: "5px 9px", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", fontSize: 12 };
const th = { background: "#1E293B", padding: "11px 12px", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", borderBottom: "1px solid #334155" };
const td = { padding: "10px 12px", fontSize: 13, color: "#E2E8F0", borderBottom: "1px solid #1E293B", verticalAlign: "top" };
const alertaErro = { background: "#450a0a", border: "1px solid #EF444455", color: "#FCA5A5", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
const alertaOk = { background: "#052e16", border: "1px solid #10B98155", color: "#6EE7B7", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
const unidadePill = { fontSize: 12, color: "#F97316", background: "#F9731622", border: "1px solid #F9731555", borderRadius: 8, padding: "5px 10px", fontWeight: 700 };
const inativoPill = { marginLeft: 8, fontSize: 9, background: "#33415588", color: "#94A3B8", borderRadius: 8, padding: "1px 6px", verticalAlign: "middle" };
const subBase = { padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid #334155" };
const subAtiva = { ...subBase, background: "#10B98122", color: "#10B981", borderColor: "#10B98166" };
const subInativa = { ...subBase, background: "transparent", color: "#94A3B8" };
const subEmBreve = { ...subBase, background: "transparent", color: "#475569", cursor: "not-allowed", borderStyle: "dashed" };
