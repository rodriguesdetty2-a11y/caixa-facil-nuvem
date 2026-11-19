// ══════════════════════════════════════════════════════════════
//  ABA COMODATO — empréstimo de produtos (botijões, galões, etc.)
//  - Registra o empréstimo, devoluções (totais ou parciais)
//  - Filtros: Todos / Em comodato / Devolvidos / Não devolvidos (vencidos)
//  - Termo de comodato para imprimir e lembrete por WhatsApp
//  Dados na nuvem: "comodatos"
// ══════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import {
  r2, hojeISO, dataBR, novoId, esc, normNome, abrirImpressao,
  card, cardTitle, labelStyle, inputStyle, btn, miniBtn, alertaErro, alertaOk,
} from "./ui";

const PRODUTOS_SUGERIDOS = ["BOTIJÃO P13", "BOTIJÃO P20", "BOTIJÃO P45", "GALÃO DE ÁGUA 20L", "REGULADOR", "MANGUEIRA", "CARRINHO"];
const FORM_VAZIO = { produto: "", quantidade: "1", unidade: "un", cliente: "", telefone: "", documento: "", endereco: "", dataEmprestimo: hojeISO(), previsao: "", obs: "" };

const qtdDevolvida = (c) => r2((c.devolucoes || []).reduce((s, d) => s + (Number(d.quantidade) || 0), 0));
const qtdPendente = (c) => r2((Number(c.quantidade) || 0) - qtdDevolvida(c));
export function statusComodato(c, hoje = hojeISO()) {
  if (qtdPendente(c) <= 0.0001) return "devolvido";
  if (c.previsao && c.previsao < hoje) return "vencido";
  return "ativo";
}
const STATUS = {
  ativo: { txt: "Em comodato", cor: "#3B82F6", icone: "📦" },
  vencido: { txt: "Não devolvido (vencido)", cor: "#EF4444", icone: "⏰" },
  devolvido: { txt: "Devolvido", cor: "#10B981", icone: "✅" },
};
const fmtQtd = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const formatTel = (s) => {
  const d = soDigitos(s).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

export default function ComodatoTab({ comodatos = [], setComodatos, empresas = [], currentUser }) {
  const admin = !!currentUser?.admin;
  const empresa = empresas.find((e) => e.padrao) || empresas[0] || null;
  const hoje = hojeISO();

  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(null); // { tipo: "form", id? } | { tipo: "devolucao", id }
  const [ok, setOk] = useState("");
  const avisar = (m) => { setOk(m); setTimeout(() => setOk(""), 3500); };

  const comStatus = useMemo(() => comodatos.map((c) => ({ ...c, status: statusComodato(c, hoje), pendente: qtdPendente(c), devolvida: qtdDevolvida(c) })), [comodatos, hoje]);
  const contagem = useMemo(() => ({
    todos: comStatus.length,
    ativo: comStatus.filter((c) => c.status !== "devolvido").length,
    devolvido: comStatus.filter((c) => c.status === "devolvido").length,
    vencido: comStatus.filter((c) => c.status === "vencido").length,
  }), [comStatus]);

  const lista = useMemo(() => {
    const b = normNome(busca);
    return comStatus
      .filter((c) => filtro === "todos" || (filtro === "ativo" ? c.status !== "devolvido" : c.status === filtro))
      .filter((c) => !b || [c.cliente, c.produto, c.telefone, c.obs, c.documento].some((x) => normNome(x).includes(b)))
      .sort((a, b2) => {
        const ordem = { vencido: 0, ativo: 1, devolvido: 2 };
        if (ordem[a.status] !== ordem[b2.status]) return ordem[a.status] - ordem[b2.status];
        return (b2.dataEmprestimo || "").localeCompare(a.dataEmprestimo || "");
      });
  }, [comStatus, filtro, busca]);

  // Quanto de cada produto está emprestado agora
  const emprestadoPorProduto = useMemo(() => {
    const m = new Map();
    comStatus.filter((c) => c.pendente > 0).forEach((c) => {
      const k = `${normNome(c.produto)}|${c.unidade || "un"}`;
      const e = m.get(k) || { produto: c.produto, unidade: c.unidade || "un", qtd: 0, clientes: 0 };
      e.qtd += c.pendente; e.clientes++; m.set(k, e);
    });
    return [...m.values()].sort((a, b) => b.qtd - a.qtd);
  }, [comStatus]);

  const excluir = (c) => {
    if (!admin) { alert("Só administrador pode excluir comodatos."); return; }
    if (!confirm(`Excluir o comodato de ${fmtQtd(c.quantidade)} ${c.unidade} ${c.produto} para ${c.cliente}?`)) return;
    setComodatos((prev) => prev.filter((x) => x.id !== c.id));
    avisar("🗑️ Comodato excluído.");
  };

  const whatsapp = (c) => {
    const tel = soDigitos(c.telefone);
    if (tel.length < 10) { alert("Cadastre o telefone com DDD para enviar pelo WhatsApp."); return; }
    const nomeEmp = empresa?.nome || "a empresa";
    const prazo = c.previsao ? (c.previsao < hoje ? `que venceu em ${dataBR(c.previsao)}` : `com devolução prevista para ${dataBR(c.previsao)}`) : "";
    const msg = `Olá, ${c.cliente}! Aqui é da ${nomeEmp}.\nPassando para lembrar do comodato de ${fmtQtd(c.pendente)} ${c.unidade} de ${c.produto}, emprestado em ${dataBR(c.dataEmprestimo)}${prazo ? ", " + prazo : ""}.\nQualquer dúvida, estamos à disposição. Obrigado!`;
    window.open(`https://wa.me/55${tel.replace(/^55(?=\d{10,11}$)/, "")}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const imprimirTermo = (c) => {
    const emp = empresa || { nome: "", cnpj: "", endereco: "", cidade: "", telefone: "" };
    const devol = (c.devolucoes || []).length ? `
      <h3 style="font-size:13px;margin:16px 0 6px">Devoluções</h3>
      <table><thead><tr><th>Data</th><th class="r">Quantidade</th><th>Recebido por</th><th>Obs.</th></tr></thead><tbody>
      ${c.devolucoes.map((d) => `<tr><td>${dataBR(d.data)}</td><td class="r">${fmtQtd(d.quantidade)} ${esc(c.unidade)}</td><td>${esc(d.por || "")}</td><td>${esc(d.obs || "")}</td></tr>`).join("")}
      </tbody></table>` : "";
    abrirImpressao(`Termo de Comodato - ${c.cliente}`, `
      <div style="text-align:center;border-bottom:3px solid #065f46;padding-bottom:8px;margin-bottom:14px">
        <div style="font-size:20px;font-weight:800;color:#065f46">${esc(emp.nome || "EMPRESA")}</div>
        <div class="sub" style="margin:2px 0 0">${[emp.cnpj && "CNPJ: " + esc(emp.cnpj), esc(emp.endereco || ""), emp.telefone && "Tel: " + esc(emp.telefone)].filter(Boolean).join(" · ")}</div>
        <div style="font-size:16px;font-weight:800;margin-top:8px;letter-spacing:1px">TERMO DE COMODATO</div>
        <div class="sub" style="margin:0">Nº ${esc(String(c.numero || "").padStart(4, "0"))} · ${dataBR(c.dataEmprestimo)}</div>
      </div>
      <p style="font-size:13px;line-height:1.7;text-align:justify">
        Pelo presente termo, <b>${esc(emp.nome || "a COMODANTE")}</b>${emp.cnpj ? ", inscrita no CNPJ " + esc(emp.cnpj) : ""}, doravante <b>COMODANTE</b>,
        entrega em comodato (empréstimo gratuito) a <b>${esc(c.cliente)}</b>${c.documento ? ", CPF/CNPJ " + esc(c.documento) : ""}${c.endereco ? ", residente em " + esc(c.endereco) : ""},
        doravante <b>COMODATÁRIO(A)</b>, o(s) bem(ns) abaixo, que se compromete a conservar e devolver em perfeito estado${c.previsao ? " até <b>" + dataBR(c.previsao) + "</b>" : " quando solicitado"}.
      </p>
      <table style="margin:10px 0"><thead><tr><th>Produto</th><th class="r">Quantidade</th><th>Data do empréstimo</th><th>Previsão de devolução</th></tr></thead>
        <tbody><tr><td><b>${esc(c.produto)}</b></td><td class="r"><b>${fmtQtd(c.quantidade)} ${esc(c.unidade)}</b></td><td>${dataBR(c.dataEmprestimo)}</td><td>${c.previsao ? dataBR(c.previsao) : "—"}</td></tr></tbody></table>
      ${c.obs ? `<p style="font-size:12px"><b>Observações / Condições:</b> ${esc(c.obs)}</p>` : ""}
      <p style="font-size:12px;line-height:1.6;text-align:justify">
        O(A) COMODATÁRIO(A) declara ter recebido o(s) bem(ns) em perfeito estado de uso, responsabilizando-se por sua guarda e conservação,
        não podendo cedê-lo(s) a terceiros. Em caso de perda, dano ou não devolução, o(a) COMODATÁRIO(A) se compromete a indenizar a COMODANTE pelo valor do(s) bem(ns).
      </p>
      ${devol}
      <div style="text-align:right;font-size:13px;margin-top:18px">${esc(emp.cidade ? emp.cidade + ", " : "")}${new Date(c.dataEmprestimo + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}.</div>
      <div class="ass" style="margin-top:56px"><div>${esc(emp.nome || "COMODANTE")}<br>COMODANTE</div><div>${esc(c.cliente)}<br>COMODATÁRIO(A)</div></div>`);
  };

  const chip = (k, txt) => (
    <button key={k} onClick={() => setFiltro(k)} style={{
      ...miniBtn, padding: "8px 14px", fontSize: 13, fontWeight: 700,
      background: filtro === k ? (k === "vencido" ? "#DC2626" : "#4F46E5") : "#1E293B",
      border: `1px solid ${filtro === k ? "transparent" : "#334155"}`,
    }}>{txt} <span style={{ opacity: 0.75 }}>({contagem[k]})</span></button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* CABEÇALHO */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#F1F5F9" }}>📦 Comodato</div>
          <div style={{ fontSize: 12, color: "#94A3B8" }}>{contagem.ativo} empréstimo(s) ativo(s){contagem.vencido > 0 && <span style={{ color: "#FCA5A5" }}> · {contagem.vencido} vencido(s)</span>}</div>
        </div>
        <button style={{ ...btn, background: "#4F46E5", fontSize: 14 }} onClick={() => setModal({ tipo: "form" })}>➕ Novo Empréstimo</button>
      </div>

      {ok && <div style={alertaOk}>{ok}</div>}
      {contagem.vencido > 0 && filtro !== "vencido" && (
        <div style={{ ...alertaErro, cursor: "pointer" }} onClick={() => setFiltro("vencido")}>
          ⏰ <b>{contagem.vencido} comodato(s) com devolução vencida.</b> Clique para ver.
        </div>
      )}

      {/* EMPRESTADO AGORA */}
      {emprestadoPorProduto.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10 }}>
          {emprestadoPorProduto.map((p) => (
            <div key={p.produto + p.unidade} style={{ background: "#0F172A", border: "1px solid #4F46E555", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>Emprestado agora</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#A5B4FC" }}>{fmtQtd(p.qtd)} <span style={{ fontSize: 12 }}>{p.unidade}</span></div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F1F5F9" }}>{p.produto}</div>
              <div style={{ fontSize: 10, color: "#64748B" }}>com {p.clientes} cliente(s)</div>
            </div>
          ))}
        </div>
      )}

      {/* FILTROS */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {chip("todos", "Todos")}
        {chip("ativo", "Em Comodato")}
        {chip("devolvido", "Devolvidos")}
        {chip("vencido", "Não Devolvidos")}
        <input style={{ ...inputStyle, width: 240, padding: "8px 12px", marginLeft: "auto" }} placeholder="🔍 Buscar cliente, produto, telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {/* LISTA */}
      <div style={card}>
        {lista.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 10px" }}>
            <div style={{ fontSize: 44 }}>📪</div>
            <div style={{ fontWeight: 800, color: "#F1F5F9", marginTop: 6 }}>{comodatos.length === 0 ? "Nenhum comodato" : "Nada neste filtro"}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>Registre empréstimos de produtos (botijões, galões, equipamentos).</div>
            {comodatos.length === 0 && <button style={{ ...btn, background: "#4F46E5", marginTop: 14 }} onClick={() => setModal({ tipo: "form" })}>➕ Registrar Empréstimo</button>}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lista.map((c) => {
              const st = STATUS[c.status];
              const atraso = c.status === "vencido" ? diasEntre(c.previsao, hoje) : 0;
              return (
                <div key={c.id} style={{ background: "#1E293B", border: `1px solid ${st.cor}55`, borderLeft: `4px solid ${st.cor}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, color: "#F1F5F9", fontSize: 15 }}>
                        {st.icone} {fmtQtd(c.quantidade)} {c.unidade} · {c.produto}
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: st.cor, background: st.cor + "22", borderRadius: 8, padding: "2px 8px", verticalAlign: "middle" }}>
                          {st.txt}{atraso > 0 ? ` há ${atraso} dia(s)` : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "#CBD5E1", marginTop: 3 }}>👤 <b>{c.cliente}</b>{c.telefone && <span style={{ color: "#94A3B8" }}> · 📱 {c.telefone}</span>}</div>
                      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                        Emprestado em {dataBR(c.dataEmprestimo)}
                        {c.previsao && <> · devolução prevista {dataBR(c.previsao)}</>}
                        {c.devolvida > 0 && <> · devolvido {fmtQtd(c.devolvida)}{c.pendente > 0 ? `, falta ${fmtQtd(c.pendente)}` : ""}</>}
                        {c.criadoPor && <> · por {c.criadoPor}</>}
                      </div>
                      {c.obs && <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>📝 {c.obs}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                      {c.status !== "devolvido" && <button style={{ ...miniBtn, background: "#059669", padding: "6px 10px" }} onClick={() => setModal({ tipo: "devolucao", id: c.id })}>↩️ Devolução</button>}
                      {c.status !== "devolvido" && <button style={{ ...miniBtn, background: "#16A34A" }} onClick={() => whatsapp(c)} title="Lembrete por WhatsApp">💬</button>}
                      <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => imprimirTermo(c)} title="Termo de comodato">🖨️</button>
                      <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => setModal({ tipo: "form", id: c.id })} title="Editar">✏️</button>
                      {admin && <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(c)} title="Excluir">🗑️</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal?.tipo === "form" && (
        <FormComodato comodatos={comodatos} setComodatos={setComodatos} id={modal.id} currentUser={currentUser}
          onFechar={() => setModal(null)} onSalvo={(m, novo) => { setModal(null); avisar(m); if (novo && confirm("Imprimir o termo de comodato agora?")) imprimirTermo(novo); }} />
      )}
      {modal?.tipo === "devolucao" && (
        <FormDevolucao comodato={comodatos.find((x) => x.id === modal.id)} setComodatos={setComodatos} currentUser={currentUser}
          onFechar={() => setModal(null)} onSalvo={(m) => { setModal(null); avisar(m); }} />
      )}
    </div>
  );
}

/* ══════ MODAL ══════ */
function Modal({ titulo, onFechar, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#000A", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onFechar}>
      <div style={{ ...card, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px #000c" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ ...cardTitle, marginBottom: 0 }}>{titulo}</h2>
          <button style={{ ...miniBtn, background: "transparent", fontSize: 18, color: "#94A3B8" }} onClick={onFechar}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormComodato({ comodatos, setComodatos, id, currentUser, onFechar, onSalvo }) {
  const original = id ? comodatos.find((c) => c.id === id) : null;
  const [form, setForm] = useState(() => (original ? {
    ...FORM_VAZIO, ...original, quantidade: String(original.quantidade).replace(".", ","),
  } : FORM_VAZIO));
  const [erro, setErro] = useState("");
  const campo = (k) => ({ value: form[k] ?? "", onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const produtos = useMemo(() => [...new Set([...PRODUTOS_SUGERIDOS, ...comodatos.map((c) => c.produto)].filter(Boolean))].sort(), [comodatos]);
  // clientes já usados (com telefone e endereço para preencher sozinho)
  const clientes = useMemo(() => {
    const m = new Map();
    [...comodatos].sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "")).forEach((c) => m.set(normNome(c.cliente), c));
    return m;
  }, [comodatos]);

  const escolherCliente = (nome) => {
    const c = clientes.get(normNome(nome));
    setForm((f) => ({ ...f, cliente: nome, ...(c && !original ? { telefone: f.telefone || c.telefone || "", documento: f.documento || c.documento || "", endereco: f.endereco || c.endereco || "" } : {}) }));
  };

  const salvar = () => {
    setErro("");
    const produto = form.produto.trim().toUpperCase();
    const quantidade = r2(Number(String(form.quantidade).replace(",", ".")) || 0);
    const cliente = form.cliente.trim().toUpperCase();
    if (!produto) { setErro("Informe o produto."); return; }
    if (quantidade <= 0) { setErro("Informe a quantidade."); return; }
    if (!cliente) { setErro("Informe para quem é o empréstimo."); return; }
    if (form.previsao && form.previsao < form.dataEmprestimo) { setErro("A previsão de devolução não pode ser antes do empréstimo."); return; }
    if (original && quantidade < qtdDevolvida(original)) { setErro(`Já foram devolvidos ${fmtQtd(qtdDevolvida(original))}. A quantidade não pode ser menor.`); return; }
    const dados = {
      produto, quantidade, unidade: (form.unidade || "un").trim(), cliente, telefone: form.telefone.trim(),
      documento: (form.documento || "").trim(), endereco: (form.endereco || "").trim(),
      dataEmprestimo: form.dataEmprestimo || hojeISO(), previsao: form.previsao || "", obs: form.obs.trim(),
    };
    if (original) {
      setComodatos((prev) => prev.map((c) => (c.id === original.id ? { ...c, ...dados, editadoPor: currentUser?.nome || "", editadoEm: new Date().toISOString() } : c)));
      onSalvo("✅ Comodato atualizado!");
    } else {
      const numero = comodatos.reduce((m, c) => Math.max(m, c.numero || 0), 0) + 1;
      const novo = { id: novoId(), numero, ...dados, devolucoes: [], criadoPor: currentUser?.nome || "", criadoEm: new Date().toISOString() };
      setComodatos((prev) => [novo, ...(prev || [])]);
      onSalvo("✅ Empréstimo registrado!", novo);
    }
  };

  return (
    <Modal titulo={original ? "✏️ Editar Comodato" : "📦 Novo Empréstimo / Comodato"} onFechar={onFechar}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Produto *</label>
          <input style={inputStyle} list="comod-produtos" placeholder="Escolha ou digite o nome do produto" {...campo("produto")} />
          <datalist id="comod-produtos">{produtos.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div><label style={labelStyle}>Quantidade *</label><input style={inputStyle} inputMode="decimal" {...campo("quantidade")} /></div>
        <div><label style={labelStyle}>Unidade</label><input style={inputStyle} placeholder="un" {...campo("unidade")} /></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Para quem *</label>
          <input style={inputStyle} list="comod-clientes" placeholder="Escolha um cliente ou digite o nome" value={form.cliente} onChange={(e) => escolherCliente(e.target.value)} />
          <datalist id="comod-clientes">{[...clientes.values()].map((c) => <option key={c.id} value={c.cliente}>{c.telefone}</option>)}</datalist>
        </div>
        <div>
          <label style={labelStyle}>Telefone</label>
          <input style={inputStyle} inputMode="tel" placeholder="(87) 99999-9999" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatTel(e.target.value) })} />
        </div>
        <div><label style={labelStyle}>CPF / CNPJ</label><input style={inputStyle} placeholder="Opcional (sai no termo)" {...campo("documento")} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Endereço</label><input style={inputStyle} placeholder="Opcional (sai no termo)" {...campo("endereco")} /></div>
        <div><label style={labelStyle}>Data do empréstimo</label><input style={inputStyle} type="date" {...campo("dataEmprestimo")} /></div>
        <div><label style={labelStyle}>Previsão de devolução</label><input style={inputStyle} type="date" {...campo("previsao")} /></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Observações / Condições</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} placeholder="Ex: botijão vazio, cliente fiel, devolver na próxima compra..." {...campo("obs")} />
        </div>
      </div>
      {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={onFechar}>Cancelar</button>
        <button style={{ ...btn, background: "#4F46E5", flex: 2 }} onClick={salvar}>{original ? "💾 Salvar" : "📦 Registrar Empréstimo"}</button>
      </div>
    </Modal>
  );
}

function FormDevolucao({ comodato, setComodatos, currentUser, onFechar, onSalvo }) {
  const pendente = comodato ? qtdPendente(comodato) : 0;
  const [qtd, setQtd] = useState(String(pendente).replace(".", ","));
  const [data, setData] = useState(hojeISO());
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  if (!comodato) return null;

  const salvar = () => {
    setErro("");
    const q = r2(Number(String(qtd).replace(",", ".")) || 0);
    if (q <= 0) { setErro("Informe a quantidade devolvida."); return; }
    if (q > pendente + 0.0001) { setErro(`Só faltam ${fmtQtd(pendente)} ${comodato.unidade} para devolver.`); return; }
    if (data < comodato.dataEmprestimo) { setErro("A devolução não pode ser antes do empréstimo."); return; }
    const dev = { id: novoId(), data, quantidade: q, obs: obs.trim(), por: currentUser?.nome || "", criadoEm: new Date().toISOString() };
    setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, devolucoes: [...(c.devolucoes || []), dev] } : c)));
    onSalvo(q >= pendente - 0.0001 ? "✅ Devolução total registrada!" : `✅ Devolução parcial registrada (falta ${fmtQtd(pendente - q)}).`);
  };

  return (
    <Modal titulo="↩️ Registrar devolução" onFechar={onFechar}>
      <div style={{ fontSize: 13, color: "#CBD5E1", marginBottom: 12 }}>
        <b>{comodato.cliente}</b> · {fmtQtd(comodato.quantidade)} {comodato.unidade} de {comodato.produto}<br />
        <span style={{ color: "#94A3B8" }}>Emprestado em {dataBR(comodato.dataEmprestimo)} · falta devolver <b style={{ color: "#FBBF24" }}>{fmtQtd(pendente)} {comodato.unidade}</b></span>
      </div>
      {(comodato.devolucoes || []).length > 0 && (
        <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 12 }}>
          Devoluções anteriores: {comodato.devolucoes.map((d) => `${dataBR(d.data)} (${fmtQtd(d.quantidade)})`).join(", ")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={labelStyle}>Quantidade devolvida</label><input style={inputStyle} inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></div>
        <div><label style={labelStyle}>Data da devolução</label><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Observação</label><input style={inputStyle} placeholder="Ex: devolvido com avaria" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      </div>
      {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={onFechar}>Cancelar</button>
        <button style={{ ...btn, background: "#059669", flex: 2 }} onClick={salvar}>↩️ Confirmar devolução</button>
      </div>
    </Modal>
  );
}
