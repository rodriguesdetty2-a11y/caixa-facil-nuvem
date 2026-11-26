// ══════════════════════════════════════════════════════════════
//  ABA COMODATO — empréstimo de produtos (botijões, galões, etc.)
//  - Registra o empréstimo, devoluções (totais ou parciais)
//  - Filtros: Todos / Em comodato / Devolvidos / Não devolvidos (vencidos)
//  - Termo de comodato para imprimir e lembrete por WhatsApp
//  - Vendas por comodatário (data, quantidade, valor) + relatório por período
//  Dados na nuvem: "comodatos"  (cada comodato tem vendas: [{ id, data, quantidade, valorUnit, valor, obs, por }])
// ══════════════════════════════════════════════════════════════

import { useState, useMemo, Fragment } from "react";
import {
  r2, fmt, hojeISO, dataBR, novoId, esc, normNome, abrirImpressao,
  card, cardTitle, labelStyle, inputStyle, btn, miniBtn, alertaErro, alertaOk,
} from "./ui";

const PRODUTOS_SUGERIDOS = ["BOTIJÃO P13", "BOTIJÃO P20", "BOTIJÃO P45", "GALÃO DE ÁGUA 20L", "REGULADOR", "MANGUEIRA", "CARRINHO"];
const FORM_VAZIO = { produto: "", quantidade: "1", unidade: "un", vendedor: "", cliente: "", telefone: "", documento: "", endereco: "", dataEmprestimo: hojeISO(), previsao: "", obs: "" };

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
const somaVendas = (vendas, de = "", ate = "") => {
  const l = (vendas || []).filter((v) => (!de || v.data >= de) && (!ate || v.data <= ate));
  return { qtd: r2(l.reduce((s, v) => s + (Number(v.quantidade) || 0), 0)), valor: r2(l.reduce((s, v) => s + (Number(v.valor) || 0), 0)), n: l.length, lista: l };
};
// Gás vendido que ainda não foi entregue (baixado) ao cliente
const vendasAEntregar = (c) => (c.vendas || []).filter((v) => !v.baixa);
const qtdAEntregar = (c) => r2(vendasAEntregar(c).reduce((s, v) => s + (Number(v.quantidade) || 0), 0));
const numBR = (s) => {
  const t = String(s ?? "").trim();
  return r2(Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0);
};
const inicioMes = () => hojeISO().slice(0, 8) + "01";
const fmtQtd = (n) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const formatTel = (s) => {
  const d = soDigitos(s).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

// tenta achar o vendedor escrito nas observações (ex.: "RESPONSAVEL: BISMARK")
function vendedorNasObs(obs) {
  const m = String(obs || "").toUpperCase().match(/(?:VENDEDOR\s+RESPONS[AÁ]VEL|RESPONS[AÁ]VEL|RESPOSSAVEL|VENDEDOR)\s*[:\-]?\s*([A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{3,})?)/);
  if (!m) return "";
  return m[1].replace(/\s+(COD|CODIGO|CÓDIGO|MODEL|PN|SN)$/, "").trim();
}
const ordemAlfa = (a, b) => String(a.cliente || "").localeCompare(String(b.cliente || ""), "pt-BR", { sensitivity: "base" });

export default function ComodatoTab({ comodatos = [], setComodatos, empresas = [], currentUser, cadastros = [] }) {
  const admin = !!currentUser?.admin;
  const empresa = empresas.find((e) => e.padrao) || empresas[0] || null;
  const hoje = hojeISO();

  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [filtroVend, setFiltroVend] = useState(""); // "" = todos · "__sem__" = sem vendedor
  const nomesVendedores = useMemo(() => [...new Set([
    ...cadastros.map((c) => c?.nome),
    ...comodatos.map((c) => c.vendedor),
    ...comodatos.flatMap((c) => (c.vendas || []).map((v) => v.baixa?.vendedor)),
  ].filter(Boolean).map((n) => String(n).trim().toUpperCase()))].sort((a, b) => a.localeCompare(b, "pt-BR")), [cadastros, comodatos]);
  const vendedoresUsados = useMemo(() => [...new Set(comodatos.map((c) => c.vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [comodatos]);
  const [modal, setModal] = useState(null); // { tipo: "form", id? } | { tipo: "devolucao", id } | { tipo: "venda", id }
  const [visao, setVisao] = useState("lista"); // lista | vendas
  const [ok, setOk] = useState("");
  const avisar = (m) => { setOk(m); setTimeout(() => setOk(""), 3500); };

  const comStatus = useMemo(() => comodatos.map((c) => ({ ...c, status: statusComodato(c, hoje), pendente: qtdPendente(c), devolvida: qtdDevolvida(c), aEntregar: qtdAEntregar(c) })), [comodatos, hoje]);
  const contagem = useMemo(() => ({
    todos: comStatus.length,
    ativo: comStatus.filter((c) => c.status !== "devolvido").length,
    devolvido: comStatus.filter((c) => c.status === "devolvido").length,
    vencido: comStatus.filter((c) => c.status === "vencido").length,
    entregar: comStatus.filter((c) => c.aEntregar > 0).length,
  }), [comStatus]);
  const totalAEntregar = r2(comStatus.reduce((s, c) => s + c.aEntregar, 0));

  const lista = useMemo(() => {
    const b = normNome(busca);
    return comStatus
      .filter((c) => filtro === "todos" || (filtro === "entregar" ? c.aEntregar > 0 : filtro === "ativo" ? c.status !== "devolvido" : c.status === filtro))
      .filter((c) => !b || [c.cliente, c.produto, c.telefone, c.obs, c.documento, c.vendedor, c.endereco].some((x) => normNome(x).includes(b)))
      .filter((c) => !filtroVend || (filtroVend === "__sem__" ? !c.vendedor : c.vendedor === filtroVend))
      .sort((a, b2) => {
        const ordem = { vencido: 0, ativo: 1, devolvido: 2 };
        if (ordem[a.status] !== ordem[b2.status]) return ordem[a.status] - ordem[b2.status];
        return (b2.dataEmprestimo || "").localeCompare(a.dataEmprestimo || "");
      });
  }, [comStatus, filtro, busca, filtroVend]);

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

  const imprimirLista = (modo) => {
    const linhas = [...lista].sort(ordemAlfa).map((c) => {
      const v = somaVendas(c.vendas);
      return `<tr><td>${esc(String(c.numero || "").padStart(4, "0"))}</td><td><b>${esc(c.cliente)}</b>${c.telefone ? `<br><span class="sub">📱 ${esc(c.telefone)}</span>` : ""}${c.endereco ? `<br><span class="sub">📍 ${esc(c.endereco)}</span>` : ""}</td>
        <td>${fmtQtd(c.quantidade)} ${esc(c.unidade)} ${esc(c.produto)}</td><td>${esc(c.vendedor || "—")}</td><td>${dataBR(c.dataEmprestimo)}</td><td>${STATUS[c.status].txt}</td>
        <td class="r">${v.n ? fmtQtd(v.qtd) : "—"}</td><td class="r">${v.n ? fmt(v.valor) : "—"}</td><td class="r">${c.aEntregar > 0 ? "<b>" + fmtQtd(c.aEntregar) + "</b>" : "—"}</td><td style="font-size:10px">${esc(c.obs || "")}</td></tr>`;
    }).join("");
    const filtroTxt = { todos: "Todos", ativo: "Em comodato", devolvido: "Devolvidos", vencido: "Não devolvidos", entregar: "Gás a entregar" }[filtro];
    const vendTxt = filtroVend ? (filtroVend === "__sem__" ? "Sem vendedor" : filtroVend) : "";
    abrirImpressao(`Comodatos - ${filtroTxt}${vendTxt ? " - " + vendTxt : ""} - ${dataBR(hoje)}`, `
      <h1>📦 Comodatos — ${esc(filtroTxt)}${vendTxt ? " · Vendedor: " + esc(vendTxt) : ""}${busca ? " · busca: " + esc(busca) : ""}</h1>
      <div class="sub">${esc(empresa?.nome || "")} · emitido em ${dataBR(hoje)} · ${lista.length} comodato(s)</div>
      <table><thead><tr><th>Nº</th><th>Cliente</th><th>Produto</th><th>Vendedor</th><th>Emprestado</th><th>Situação</th><th class="r">Qtd vendida</th><th class="r">Valor vendido</th><th class="r">A entregar</th><th>Obs.</th></tr></thead>
      <tbody>${linhas}</tbody></table>`, { modo });
  };

  const imprimirTermo = (c, modo) => {
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
      <div class="ass" style="margin-top:56px"><div>${esc(emp.nome || "COMODANTE")}<br>COMODANTE</div><div>${esc(c.cliente)}<br>COMODATÁRIO(A)</div></div>`, { modo });
  };

  const chip = (k, txt) => (
    <button key={k} onClick={() => setFiltro(k)} style={{
      ...miniBtn, padding: "8px 14px", fontSize: 13, fontWeight: 700,
      background: filtro === k ? (k === "vencido" ? "#DC2626" : k === "entregar" ? "#D97706" : "#4F46E5") : "#1E293B",
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: visao === "vendas" ? "#D97706" : "#1E293B", border: "1px solid #D9770688", fontSize: 14 }} onClick={() => setVisao(visao === "vendas" ? "lista" : "vendas")}>
            {visao === "vendas" ? "📦 Voltar aos comodatos" : "📊 Relatório de Vendas"}
          </button>
          <button style={{ ...btn, background: "#4F46E5", fontSize: 14 }} onClick={() => setModal({ tipo: "form" })}>➕ Novo Empréstimo</button>
        </div>
      </div>

      {visao === "vendas" && <RelatorioVendasComodato comodatos={comodatos} empresa={empresa} vendedores={vendedoresUsados} />}
      {visao === "lista" && <>

      {ok && <div style={alertaOk}>{ok}</div>}
      {contagem.vencido > 0 && filtro !== "vencido" && (
        <div style={{ ...alertaErro, cursor: "pointer" }} onClick={() => setFiltro("vencido")}>
          ⏰ <b>{contagem.vencido} comodato(s) com devolução vencida.</b> Clique para ver.
        </div>
      )}

      {visao === "lista" && totalAEntregar > 0 && filtro !== "entregar" && (
        <div style={{ background: "#451a03", border: "1px solid #D97706", borderRadius: 10, padding: "10px 14px", color: "#FDE68A", fontSize: 13, cursor: "pointer" }} onClick={() => setFiltro("entregar")}>
          🚚 <b>{fmtQtd(totalAEntregar)} gás vendido(s) para entregar</b> em {contagem.entregar} cliente(s). Clique para ver e dar baixa.
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
        {chip("entregar", "🚚 Gás a entregar")}
        <select style={{ ...inputStyle, width: 200, padding: "8px 10px", marginLeft: "auto", color: filtroVend ? "#FCD34D" : undefined }} value={filtroVend} onChange={(e) => setFiltroVend(e.target.value)} title="Filtrar por vendedor">
          <option value="">🧑‍💼 Todos os vendedores</option>
          {vendedoresUsados.map((v) => <option key={v} value={v}>🧑‍💼 {v} ({comodatos.filter((c) => c.vendedor === v).length})</option>)}
          <option value="__sem__">— Sem vendedor ({comodatos.filter((c) => !c.vendedor).length})</option>
        </select>
        <input style={{ ...inputStyle, width: 240, padding: "8px 12px" }} placeholder="🔍 Buscar cliente, produto, telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {lista.length > 0 && <>
          <button style={{ ...miniBtn, background: "#DC2626", padding: "8px 12px" }} onClick={() => imprimirLista("pdf")} title="Baixar a lista em PDF">📄 PDF</button>
          <button style={{ ...miniBtn, background: "#374151", padding: "8px 12px" }} onClick={() => imprimirLista()} title="Imprimir a lista">🖨️</button>
        </>}
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, color: "#F1F5F9", fontSize: 15 }}>
                        {st.icone} {fmtQtd(c.quantidade)} {c.unidade} · {c.produto}
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: st.cor, background: st.cor + "22", borderRadius: 8, padding: "2px 8px", verticalAlign: "middle" }}>
                          {st.txt}{atraso > 0 ? ` há ${atraso} dia(s)` : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "#CBD5E1", marginTop: 3 }}>👤 <b>{c.cliente}</b>{c.telefone && <span style={{ color: "#94A3B8" }}> · 📱 {c.telefone}</span>}</div>
                      {c.endereco && <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>📍 {c.endereco}</div>}
                      {c.vendedor && <div style={{ fontSize: 12, color: "#A5B4FC", marginTop: 2 }}>🧑‍💼 Vendedor: <b>{c.vendedor}</b></div>}
                      <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                        Emprestado em {dataBR(c.dataEmprestimo)}
                        {c.previsao && <> · devolução prevista {dataBR(c.previsao)}</>}
                        {c.devolvida > 0 && <> · devolvido {fmtQtd(c.devolvida)}{c.pendente > 0 ? `, falta ${fmtQtd(c.pendente)}` : ""}</>}
                        {c.criadoPor && <> · por {c.criadoPor}</>}
                      </div>
                      {c.obs && <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>📝 {c.obs}</div>}
                      {(() => {
                        const v = somaVendas(c.vendas); const m = somaVendas(c.vendas, inicioMes(), hoje);
                        if (!v.n) return null;
                        return (
                          <div style={{ fontSize: 12, color: "#FCD34D", marginTop: 5, fontWeight: 700 }}>
                            💰 Vendido: {fmtQtd(v.qtd)} un · {fmt(v.valor)} <span style={{ color: "#94A3B8", fontWeight: 400 }}>({v.n} lançamento(s) · este mês: {fmtQtd(m.qtd)} un · {fmt(m.valor)})</span>
                            {c.aEntregar > 0
                              ? <span style={{ marginLeft: 8, background: "#D9770633", color: "#FDBA74", border: "1px solid #D97706", borderRadius: 8, padding: "1px 8px", fontSize: 11 }}>⏳ Falta entregar: {fmtQtd(c.aEntregar)} gás</span>
                              : <span style={{ marginLeft: 8, color: "#6EE7B7", fontSize: 11 }}>✅ tudo entregue</span>}
                          </div>
                        );
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #334155", paddingTop: 10 }}>
                      <button style={{ ...miniBtn, background: "#D97706", padding: "6px 10px" }} onClick={() => setModal({ tipo: "venda", id: c.id })} title="Lançar venda deste cliente">💰 Venda</button>
                      {c.aEntregar > 0 && <button style={{ ...miniBtn, background: "#0891B2", padding: "6px 10px" }} onClick={() => setModal({ tipo: "baixa", id: c.id })} title="Dar baixa no gás entregue">🚚 Baixar gás</button>}
                      {c.status !== "devolvido" && <button style={{ ...miniBtn, background: "#059669", padding: "6px 10px" }} onClick={() => setModal({ tipo: "devolucao", id: c.id })}>↩️ Devolução</button>}
                      {c.status !== "devolvido" && <button style={{ ...miniBtn, background: "#16A34A" }} onClick={() => whatsapp(c)} title="Lembrete por WhatsApp">💬</button>}
                      <button style={{ ...miniBtn, background: "#DC2626" }} onClick={() => imprimirTermo(c)} title="Termo de comodato (imprimir ou baixar PDF)">🖨️</button>
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
      </>}

      {modal?.tipo === "form" && (
        <FormComodato comodatos={comodatos} setComodatos={setComodatos} id={modal.id} currentUser={currentUser} nomesVendedores={nomesVendedores}
          onFechar={() => setModal(null)} onSalvo={(m, novo) => { setModal(null); avisar(m); if (novo && confirm("Imprimir o termo de comodato agora?")) imprimirTermo(novo); }} />
      )}
      {modal?.tipo === "venda" && (
        <FormVenda comodato={comodatos.find((x) => x.id === modal.id)} comodatos={comodatos} setComodatos={setComodatos} currentUser={currentUser}
          onFechar={() => setModal(null)} onSalvo={(m) => { setModal(null); avisar(m); }} />
      )}
      {modal?.tipo === "baixa" && (
        <FormBaixa comodato={comodatos.find((x) => x.id === modal.id)} comodatos={comodatos} setComodatos={setComodatos} currentUser={currentUser}
          onFechar={() => setModal(null)} onSalvo={(m) => { setModal(null); avisar(m); }} />
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

function FormComodato({ comodatos, setComodatos, id, currentUser, onFechar, onSalvo, nomesVendedores = [] }) {
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
      documento: (form.documento || "").trim(), endereco: (form.endereco || "").trim(), vendedor: (form.vendedor || "").trim().toUpperCase(),
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
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>🧑‍💼 Vendedor responsável</label>
          <input style={inputStyle} list="comod-vend-form" placeholder="Escolha ou digite o vendedor" {...campo("vendedor")} />
          <datalist id="comod-vend-form">{nomesVendedores.map((n) => <option key={n} value={n} />)}</datalist>
          {!form.vendedor && vendedorNasObs(form.obs) && (
            <button type="button" style={{ ...miniBtn, background: "#4338CA", marginTop: 6 }} onClick={() => setForm((f) => ({ ...f, vendedor: vendedorNasObs(f.obs) }))}>
              💡 Achei nas observações: usar <b>{vendedorNasObs(form.obs)}</b>
            </button>
          )}
        </div>
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

/* ══════ LANÇAR VENDA ══════ */
function FormVenda({ comodato, comodatos, setComodatos, currentUser, onFechar, onSalvo }) {
  // último valor unitário usado para este produto (para já vir preenchido)
  const ultimoUnit = useMemo(() => {
    if (!comodato) return 0;
    const p = normNome(comodato.produto);
    const todas = comodatos.filter((c) => normNome(c.produto) === p).flatMap((c) => c.vendas || []).filter((v) => Number(v.valorUnit) > 0);
    todas.sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    return todas.length ? Number(todas[todas.length - 1].valorUnit) : 0;
  }, [comodato, comodatos]);
  const [data, setData] = useState(hojeISO());
  const [qtd, setQtd] = useState("");
  const [unit, setUnit] = useState(ultimoUnit ? ultimoUnit.toFixed(2).replace(".", ",") : "");
  const [total, setTotal] = useState("");
  const [totalManual, setTotalManual] = useState(false);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [editId, setEditId] = useState(null);
  if (!comodato) return null;

  const fmtCampo = (n) => (n ? Number(n).toFixed(2).replace(".", ",") : "");
  const editar = (v) => {
    setEditId(v.id); setData(v.data || hojeISO()); setQtd(String(v.quantidade).replace(".", ","));
    setUnit(fmtCampo(v.valorUnit)); setObs(v.obs || ""); setErro("");
    const calc = r2((Number(v.quantidade) || 0) * (Number(v.valorUnit) || 0));
    if (Math.abs(calc - (Number(v.valor) || 0)) > 0.009) { setTotal(fmtCampo(v.valor)); setTotalManual(true); } else { setTotal(""); setTotalManual(false); }
  };
  const cancelarEdicao = () => { setEditId(null); setQtd(""); setObs(""); setTotal(""); setTotalManual(false); setData(hojeISO()); setUnit(ultimoUnit ? fmtCampo(ultimoUnit) : ""); setErro(""); };

  const totalCalc = r2(numBR(qtd) * numBR(unit));
  const totalFinal = totalManual ? numBR(total) : totalCalc;
  const vendas = [...(comodato.vendas || [])].sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  const tot = somaVendas(comodato.vendas);

  const salvar = () => {
    setErro("");
    const q = numBR(qtd);
    if (!data) return setErro("Informe a data da venda.");
    if (q <= 0) return setErro("Informe a quantidade vendida.");
    if (totalFinal < 0) return setErro("Valor inválido.");
    if (editId) {
      const mud = { data, quantidade: q, valorUnit: numBR(unit), valor: totalFinal, obs: obs.trim(), editadoPor: currentUser?.nome || "", editadoEm: new Date().toISOString() };
      setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, vendas: (c.vendas || []).map((v) => (v.id === editId ? { ...v, ...mud } : v)) } : c)));
      onSalvo(`✏️ Venda alterada: ${fmtQtd(q)} un · ${fmt(totalFinal)} (${comodato.cliente})`);
      return;
    }
    const venda = { id: novoId(), data, quantidade: q, valorUnit: numBR(unit), valor: totalFinal, obs: obs.trim(), por: currentUser?.nome || "", criadoEm: new Date().toISOString() };
    setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, vendas: [...(c.vendas || []), venda] } : c)));
    onSalvo(`💰 Venda lançada: ${fmtQtd(q)} un · ${fmt(totalFinal)} para ${comodato.cliente}`);
  };
  const excluirVenda = (v) => {
    const aviso = v.baixa ? `\n\n⚠️ Esta venda já teve o gás entregue em ${dataBR(v.baixa.data)}.` : "";
    if (!confirm(`Excluir a venda de ${dataBR(v.data)} (${fmtQtd(v.quantidade)} un · ${fmt(v.valor)})?${aviso}`)) return;
    setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, vendas: (c.vendas || []).filter((x) => x.id !== v.id) } : c)));
  };

  return (
    <Modal titulo={editId ? "✏️ Editar venda" : "💰 Lançar venda"} onFechar={onFechar}>
      {editId && (
        <div style={{ background: "#1E3A8A", border: "1px solid #3B82F6", borderRadius: 8, padding: "8px 12px", color: "#BFDBFE", fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          ✏️ Você está editando uma venda já lançada.
          <button style={{ ...miniBtn, background: "#374151", marginLeft: "auto" }} onClick={cancelarEdicao}>Cancelar edição</button>
        </div>
      )}
      <div style={{ fontSize: 13, color: "#CBD5E1", marginBottom: 12 }}>
        <b>{comodato.cliente}</b> · {comodato.produto}
        {tot.n > 0 && <div style={{ color: "#FCD34D", fontSize: 12, marginTop: 3 }}>Total já vendido: {fmtQtd(tot.qtd)} un · {fmt(tot.valor)} ({tot.n} lançamento(s))</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={labelStyle}>Data da venda</label><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div><label style={labelStyle}>Quantidade vendida *</label><input style={inputStyle} inputMode="decimal" placeholder="Ex: 10" value={qtd} onChange={(e) => setQtd(e.target.value)} autoFocus /></div>
        <div><label style={labelStyle}>Valor unitário (R$)</label><input style={inputStyle} inputMode="decimal" placeholder="0,00" value={unit} onChange={(e) => { setUnit(e.target.value); setTotalManual(false); }} /></div>
        <div>
          <label style={labelStyle}>Valor total (R$)</label>
          <input style={{ ...inputStyle, fontWeight: 800, color: "#FCD34D" }} inputMode="decimal" placeholder="0,00"
            value={totalManual ? total : (totalCalc ? totalCalc.toFixed(2).replace(".", ",") : "")}
            onChange={(e) => { setTotal(e.target.value); setTotalManual(true); }} />
          <div style={{ fontSize: 10, color: "#64748B", marginTop: 3 }}>{totalManual ? "Digitado à mão" : "Quantidade × valor unitário"}</div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Observação</label><input style={inputStyle} placeholder="Opcional" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      </div>
      {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={onFechar}>Cancelar</button>
        <button style={{ ...btn, background: editId ? "#2563EB" : "#D97706", flex: 2 }} onClick={salvar}>{editId ? "💾 Salvar alteração" : "💰 Lançar venda"} {totalFinal > 0 ? fmt(totalFinal) : ""}</button>
      </div>
      {vendas.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Vendas lançadas</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {vendas.map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: v.id === editId ? "#1E3A8A" : "#1E293B", border: v.id === editId ? "1px solid #3B82F6" : "1px solid transparent", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#CBD5E1" }}>
                <span style={{ minWidth: 78 }}>{dataBR(v.data)}</span>
                <span style={{ flex: 1 }}><b>{fmtQtd(v.quantidade)} un</b>{v.valorUnit ? ` × ${fmt(v.valorUnit)}` : ""}{v.obs ? <span style={{ color: "#64748B" }}> · {v.obs}</span> : null}</span>
                <b style={{ color: "#FCD34D" }}>{fmt(v.valor)}</b>
                {v.baixa
                  ? <span style={{ fontSize: 10, color: "#6EE7B7" }} title={`Entregue por ${v.baixa.vendedor || "-"}`}>✅ entregue {dataBR(v.baixa.data)}</span>
                  : <span style={{ fontSize: 10, color: "#FDBA74" }}>⏳ a entregar</span>}
                <button style={{ ...miniBtn, background: "#2563EB", padding: "3px 8px" }} onClick={() => editar(v)} title="Editar esta venda">✏️ Editar</button>
                <button style={{ ...miniBtn, background: "#7F1D1D", padding: "3px 8px" }} onClick={() => { if (v.id === editId) cancelarEdicao(); excluirVenda(v); }} title="Excluir venda lançada errada">🗑️ Excluir</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ══════ RELATÓRIO DE VENDAS POR PERÍODO ══════ */
function RelatorioVendasComodato({ comodatos, empresa, vendedores = [] }) {
  const [vendFiltro, setVendFiltro] = useState("");
  const [tipo, setTipo] = useState("vendas"); // vendas | baixas
  const [de, setDe] = useState(inicioMes());
  const [ate, setAte] = useState(hojeISO());
  const [produto, setProduto] = useState("");
  const [busca, setBusca] = useState("");
  const [incluirZerados, setIncluirZerados] = useState(false);
  const [detalhado, setDetalhado] = useState(false);

  const produtos = useMemo(() => [...new Set(comodatos.map((c) => c.produto).filter(Boolean))].sort(), [comodatos]);

  const linhas = useMemo(() => {
    const m = new Map();
    const b = normNome(busca);
    comodatos
      .filter((c) => !produto || c.produto === produto)
      .filter((c) => !vendFiltro || (vendFiltro === "__sem__" ? !c.vendedor : c.vendedor === vendFiltro))
      .filter((c) => !b || [c.cliente, c.telefone, c.obs].some((x) => normNome(x).includes(b)))
      .forEach((c) => {
        const k = normNome(c.cliente);
        const sv = somaVendas(c.vendas, de, ate);
        const e = m.get(k) || { cliente: c.cliente, telefone: c.telefone || "", endereco: c.endereco || "", vendedores: new Set(), produtos: new Set(), qtd: 0, valor: 0, n: 0, falta: 0, vendas: [] };
        e.falta = r2(e.falta + sv.lista.filter((v) => !v.baixa).reduce((t, v) => t + (Number(v.quantidade) || 0), 0));
        e.produtos.add(c.produto);
        if (c.vendedor) e.vendedores.add(c.vendedor);
        if (!e.telefone && c.telefone) e.telefone = c.telefone;
        if (!e.endereco && c.endereco) e.endereco = c.endereco;
        e.qtd = r2(e.qtd + sv.qtd); e.valor = r2(e.valor + sv.valor); e.n += sv.n;
        e.vendas.push(...sv.lista.map((v) => ({ ...v, produto: c.produto })));
        m.set(k, e);
      });
    return [...m.values()]
      .filter((e) => incluirZerados || e.n > 0)
      .map((e) => ({ ...e, produtos: [...e.produtos].join(", "), vendedor: [...e.vendedores].join(", "), vendas: e.vendas.sort((a, b2) => (a.data || "").localeCompare(b2.data || "")) }))
      .sort((a, b2) => ordemAlfa(a, b2));
  }, [comodatos, de, ate, produto, busca, incluirZerados, vendFiltro]);

  const tot = linhas.reduce((t, e) => ({ qtd: r2(t.qtd + e.qtd), valor: r2(t.valor + e.valor), n: t.n + e.n, falta: r2(t.falta + e.falta), clientes: t.clientes + (e.n > 0 ? 1 : 0) }), { qtd: 0, valor: 0, n: 0, falta: 0, clientes: 0 });

  // ── BAIXAS (entregas) no período: conta pela DATA DA ENTREGA ──
  const vendedoresBaixa = useMemo(() => [...new Set([...vendedores, ...comodatos.flatMap((c) => (c.vendas || []).map((v) => v.baixa?.vendedor))].filter(Boolean))].sort((a, b2) => a.localeCompare(b2, "pt-BR")), [comodatos, vendedores]);
  const linhasBaixa = useMemo(() => {
    const m = new Map();
    const b = normNome(busca);
    comodatos
      .filter((c) => !produto || c.produto === produto)
      .filter((c) => !b || [c.cliente, c.telefone, c.obs].some((x) => normNome(x).includes(b)))
      .forEach((c) => {
        const ents = (c.vendas || []).filter((v) => v.baixa && v.baixa.data >= de && v.baixa.data <= ate)
          .filter((v) => !vendFiltro || (vendFiltro === "__sem__" ? !(v.baixa.vendedor || c.vendedor) : (v.baixa.vendedor || c.vendedor) === vendFiltro));
        if (!ents.length) return;
        const k = normNome(c.cliente);
        const e = m.get(k) || { cliente: c.cliente, telefone: c.telefone || "", endereco: c.endereco || "", produtos: new Set(), qtd: 0, valor: 0, entregas: [] };
        e.produtos.add(c.produto);
        ents.forEach((v) => {
          e.qtd = r2(e.qtd + (Number(v.quantidade) || 0)); e.valor = r2(e.valor + (Number(v.valor) || 0));
          e.entregas.push({ id: v.id, dataBaixa: v.baixa.data, dataVenda: v.data, qtd: Number(v.quantidade) || 0, valor: Number(v.valor) || 0, vendedor: v.baixa.vendedor || c.vendedor || "", obs: v.baixa.obs || "" });
        });
        m.set(k, e);
      });
    return [...m.values()].map((e) => ({ ...e, produtos: [...e.produtos].join(", "),
      entregas: e.entregas.sort((a, b2) => a.dataBaixa.localeCompare(b2.dataBaixa)),
      vendedores: [...new Set(e.entregas.map((x) => x.vendedor).filter(Boolean))].join(", "),
      ultima: e.entregas.reduce((u, x) => (x.dataBaixa > u ? x.dataBaixa : u), "") })).sort(ordemAlfa);
  }, [comodatos, de, ate, produto, busca, vendFiltro]);
  const totB = linhasBaixa.reduce((t, e) => ({ qtd: r2(t.qtd + e.qtd), valor: r2(t.valor + e.valor), n: t.n + e.entregas.length, clientes: t.clientes + 1 }), { qtd: 0, valor: 0, n: 0, clientes: 0 });

  const imprimirBaixas = (modo) => {
    const vTxt = vendFiltro ? (vendFiltro === "__sem__" ? "Sem vendedor" : vendFiltro) : "";
    const corpo = linhasBaixa.map((e, i) => {
      let h = `<tr><td>${i + 1}</td><td><b>${esc(e.cliente)}</b>${e.telefone ? `<br><span class="sub">📱 ${esc(e.telefone)}</span>` : ""}${e.endereco ? `<br><span class="sub">📍 ${esc(e.endereco)}</span>` : ""}</td>
        <td>${esc(e.vendedores || "—")}</td><td class="ctr">${e.entregas.length}</td><td>${dataBR(e.ultima)}</td><td class="r"><b>${fmtQtd(e.qtd)}</b></td><td class="r">${fmt(e.valor)}</td></tr>`;
      if (detalhado) h += e.entregas.map((x) => `<tr style="color:#555;font-size:10px"><td></td><td>↳ entregue ${dataBR(x.dataBaixa)} · venda de ${dataBR(x.dataVenda)}${x.obs ? " · " + esc(x.obs) : ""}</td>
        <td>${esc(x.vendedor || "")}</td><td></td><td></td><td class="r">${fmtQtd(x.qtd)}</td><td class="r">${fmt(x.valor)}</td></tr>`).join("");
      return h;
    }).join("");
    abrirImpressao(`Baixas Comodato ${dataBR(de)} a ${dataBR(ate)}${produto ? " - " + produto : ""}${vTxt ? " - " + vTxt : ""}`, `
      <h1>🚚 Relatório de Baixas — Gás Entregue aos Comodatários</h1>
      <div class="sub">${esc(empresa?.nome || "")} · Período da entrega: <b>${dataBR(de)} a ${dataBR(ate)}</b>${produto ? " · Produto: <b>" + esc(produto) + "</b>" : ""}${vTxt ? " · Vendedor: <b>" + esc(vTxt) + "</b>" : ""} · emitido em ${dataBR(hojeISO())}</div>
      <div class="cards">
        <div class="c"><div class="l">Gás entregue</div><div class="v">${fmtQtd(totB.qtd)}</div></div>
        <div class="c"><div class="l">Valor das vendas entregues</div><div class="v">${fmt(totB.valor)}</div></div>
        <div class="c"><div class="l">Clientes atendidos</div><div class="v">${totB.clientes}</div></div>
        <div class="c"><div class="l">Baixas</div><div class="v">${totB.n}</div></div>
      </div>
      <table><thead><tr><th>#</th><th>Cliente</th><th>Vendedor</th><th class="ctr">Baixas</th><th>Última entrega</th><th class="r">Gás entregue</th><th class="r">Valor</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr><td></td><td colspan="2">TOTAL (${linhasBaixa.length} cliente(s))</td><td class="ctr">${totB.n}</td><td></td><td class="r">${fmtQtd(totB.qtd)}</td><td class="r">${fmt(totB.valor)}</td></tr></tfoot></table>`, { modo });
  };

  const imprimir = (modo) => {
    if (tipo === "baixas") return imprimirBaixas(modo);
    const corpo = linhas.map((e, i) => {
      let h = `<tr><td>${i + 1}</td><td><b>${esc(e.cliente)}</b>${e.telefone ? `<br><span class="sub">📱 ${esc(e.telefone)}</span>` : ""}${e.endereco ? `<br><span class="sub">📍 ${esc(e.endereco)}</span>` : ""}${e.vendedor ? `<br><span class="sub">🧑‍💼 ${esc(e.vendedor)}</span>` : ""}</td><td>${esc(e.produtos)}</td>
        <td class="ctr">${e.n}</td><td class="r"><b>${fmtQtd(e.qtd)}</b></td><td class="r">${fmtQtd(r2(e.qtd - e.falta))}</td><td class="r">${e.falta > 0 ? "<b>" + fmtQtd(e.falta) + "</b>" : "—"}</td><td class="r"><b>${fmt(e.valor)}</b></td></tr>`;
      if (detalhado && e.vendas.length) h += e.vendas.map((v) => `<tr style="color:#555;font-size:10px"><td></td><td colspan="2">↳ ${dataBR(v.data)}${v.obs ? " · " + esc(v.obs) : ""}</td><td></td>
        <td class="r">${fmtQtd(v.quantidade)}${v.valorUnit ? " × " + fmt(v.valorUnit) : ""}</td><td colspan="2" class="r">${v.baixa ? "entregue " + dataBR(v.baixa.data) + (v.baixa.vendedor ? " (" + esc(v.baixa.vendedor) + ")" : "") : "a entregar"}</td><td class="r">${fmt(v.valor)}</td></tr>`).join("");
      return h;
    }).join("");
    const vTxt = vendFiltro ? (vendFiltro === "__sem__" ? "Sem vendedor" : vendFiltro) : "";
    abrirImpressao(`Vendas Comodato ${dataBR(de)} a ${dataBR(ate)}${produto ? " - " + produto : ""}${vTxt ? " - " + vTxt : ""}`, `
      <h1>💰 Relatório de Vendas — Comodatários</h1>
      <div class="sub">${esc(empresa?.nome || "")} · Período: <b>${dataBR(de)} a ${dataBR(ate)}</b>${produto ? " · Produto: <b>" + esc(produto) + "</b>" : ""}${vTxt ? " · Vendedor: <b>" + esc(vTxt) + "</b>" : ""} · emitido em ${dataBR(hojeISO())}</div>
      <div class="cards">
        <div class="c"><div class="l">Quantidade vendida</div><div class="v">${fmtQtd(tot.qtd)}</div></div>
        <div class="c"><div class="l">Valor vendido</div><div class="v">${fmt(tot.valor)}</div></div>
        <div class="c"><div class="l">Clientes que venderam</div><div class="v">${tot.clientes}</div></div>
        <div class="c"><div class="l">Falta entregar</div><div class="v">${fmtQtd(tot.falta)}</div></div>
      </div>
      <table><thead><tr><th>#</th><th>Cliente</th><th>Produto</th><th class="ctr">Lanç.</th><th class="r">Qtd vendida</th><th class="r">Entregue</th><th class="r">Falta entregar</th><th class="r">Valor</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr><td></td><td colspan="2">TOTAL (${linhas.length} cliente(s))</td><td class="ctr">${tot.n}</td><td class="r">${fmtQtd(tot.qtd)}</td><td class="r">${fmtQtd(r2(tot.qtd - tot.falta))}</td><td class="r">${fmtQtd(tot.falta)}</td><td class="r">${fmt(tot.valor)}</td></tr></tfoot></table>`, { modo });
  };

  const atalho = (txt, d1, d2) => (
    <button style={{ ...miniBtn, background: de === d1 && ate === d2 ? "#D97706" : "#1E293B", border: "1px solid #334155", padding: "6px 10px" }} onClick={() => { setDe(d1); setAte(d2); }}>{txt}</button>
  );
  const h = hojeISO();
  const mesPassado = (() => { const d = new Date(h.slice(0, 8) + "01T12:00:00"); d.setMonth(d.getMonth() - 1); const ini = d.toISOString().slice(0, 10); const fim = new Date(new Date(h.slice(0, 8) + "01T12:00:00") - 864e5).toISOString().slice(0, 10); return [ini, fim]; })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {[["vendas", "💰 Vendas", "#D97706"], ["baixas", "🚚 Baixas (entregas)", "#0891B2"]].map(([k, l, cor]) => (
            <button key={k} onClick={() => setTipo(k)} style={{ ...btn, padding: "8px 16px", background: tipo === k ? cor : "#1E293B", border: `1px solid ${cor}88` }}>{l}</button>
          ))}
        </div>
        <h2 style={cardTitle}>{tipo === "baixas" ? "🚚 Relatório de Baixas (gás entregue) por Período" : "📊 Relatório de Vendas por Período"}</h2>
        {tipo === "baixas" && <div style={{ fontSize: 12, color: "#64748B", marginTop: -8, marginBottom: 10 }}>Conta pela <b>data da entrega</b> (baixa).</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          <div><label style={labelStyle}>De</label><input style={inputStyle} type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div><label style={labelStyle}>Até</label><input style={inputStyle} type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
          <div>
            <label style={labelStyle}>Produto</label>
            <select style={inputStyle} value={produto} onChange={(e) => setProduto(e.target.value)}>
              <option value="">Todos os produtos</option>
              {produtos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Vendedor</label>
            <select style={inputStyle} value={vendFiltro} onChange={(e) => setVendFiltro(e.target.value)}>
              <option value="">Todos os vendedores</option>
              {(tipo === "baixas" ? vendedoresBaixa : vendedores).map((v) => <option key={v} value={v}>{v}</option>)}
              <option value="__sem__">— Sem vendedor</option>
            </select>
          </div>
          <div><label style={labelStyle}>Cliente</label><input style={inputStyle} placeholder="🔍 Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          {atalho("Hoje", h, h)}
          {atalho("Este mês", inicioMes(), h)}
          {atalho("Mês passado", mesPassado[0], mesPassado[1])}
          {atalho("Este ano", h.slice(0, 4) + "-01-01", h)}
          <label style={{ fontSize: 12, color: "#CBD5E1", display: "flex", gap: 6, alignItems: "center", marginLeft: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={incluirZerados} onChange={(e) => setIncluirZerados(e.target.checked)} disabled={tipo === "baixas"} /> Mostrar quem não vendeu
          </label>
          <label style={{ fontSize: 12, color: "#CBD5E1", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={detalhado} onChange={(e) => setDetalhado(e.target.checked)} /> Detalhar cada venda
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button style={{ ...btn, background: "#DC2626", padding: "8px 14px" }} onClick={() => imprimir("pdf")} disabled={!(tipo === "baixas" ? linhasBaixa : linhas).length}>📄 Salvar PDF</button>
            <button style={{ ...btn, background: "#374151", padding: "8px 14px" }} onClick={() => imprimir()} disabled={!(tipo === "baixas" ? linhasBaixa : linhas).length}>🖨️ Imprimir</button>
          </div>
        </div>
      </div>

      {tipo === "baixas" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            {[["Gás entregue", fmtQtd(totB.qtd), "#67E8F9"], ["Valor das vendas entregues", fmt(totB.valor), "#10B981"], ["Clientes atendidos", totB.clientes, "#A5B4FC"], ["Baixas", totB.n, "#94A3B8"]].map(([l, v, cor]) => (
              <div key={l} style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: cor }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={card}>
            {linhasBaixa.length === 0 ? (
              <div style={{ textAlign: "center", color: "#64748B", padding: 24 }}>Nenhuma baixa neste período. Use o botão <b style={{ color: "#67E8F9" }}>🚚 Baixar gás</b> em cada comodatário.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
                  <thead><tr style={{ color: "#94A3B8", fontSize: 11, textTransform: "uppercase", textAlign: "left" }}>
                    <th style={{ padding: 8 }}>Cliente</th><th style={{ padding: 8 }}>Vendedor</th><th style={{ padding: 8, textAlign: "center" }}>Baixas</th>
                    <th style={{ padding: 8 }}>Última entrega</th><th style={{ padding: 8, textAlign: "right" }}>Gás entregue</th><th style={{ padding: 8, textAlign: "right" }}>Valor</th>
                  </tr></thead>
                  <tbody>
                    {linhasBaixa.map((e) => (
                      <Fragment key={e.cliente}>
                        <tr style={{ borderTop: "1px solid #1E293B", color: "#F1F5F9" }}>
                          <td style={{ padding: 8 }}><b>{e.cliente}</b>{e.telefone && <div style={{ fontSize: 11, color: "#94A3B8" }}>📱 {e.telefone}</div>}{e.endereco && <div style={{ fontSize: 11, color: "#94A3B8" }}>📍 {e.endereco}</div>}</td>
                          <td style={{ padding: 8, fontSize: 12, color: "#A5B4FC" }}>{e.vendedores || "—"}</td>
                          <td style={{ padding: 8, textAlign: "center" }}>{e.entregas.length}</td>
                          <td style={{ padding: 8 }}>{dataBR(e.ultima)}</td>
                          <td style={{ padding: 8, textAlign: "right", fontWeight: 800, color: "#67E8F9" }}>{fmtQtd(e.qtd)}</td>
                          <td style={{ padding: 8, textAlign: "right", fontWeight: 800, color: "#10B981" }}>{fmt(e.valor)}</td>
                        </tr>
                        {detalhado && e.entregas.map((x) => (
                          <tr key={x.id} style={{ color: "#94A3B8", fontSize: 11 }}>
                            <td style={{ padding: "2px 8px 2px 20px" }}>↳ entregue {dataBR(x.dataBaixa)} · venda de {dataBR(x.dataVenda)}{x.obs ? ` · ${x.obs}` : ""}</td>
                            <td style={{ padding: "2px 8px" }}>{x.vendedor}</td><td></td><td></td>
                            <td style={{ padding: "2px 8px", textAlign: "right" }}>{fmtQtd(x.qtd)}</td>
                            <td style={{ padding: "2px 8px", textAlign: "right" }}>{fmt(x.valor)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot><tr style={{ borderTop: "2px solid #334155", fontWeight: 900, color: "#F1F5F9" }}>
                    <td style={{ padding: 8 }} colSpan={2}>TOTAL ({linhasBaixa.length} cliente(s))</td><td style={{ padding: 8, textAlign: "center" }}>{totB.n}</td><td></td>
                    <td style={{ padding: 8, textAlign: "right", color: "#67E8F9" }}>{fmtQtd(totB.qtd)}</td><td style={{ padding: 8, textAlign: "right", color: "#10B981" }}>{fmt(totB.valor)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tipo === "vendas" && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[["Quantidade vendida", fmtQtd(tot.qtd), "#FCD34D"], ["Valor vendido", fmt(tot.valor), "#10B981"], ["Entregue", fmtQtd(r2(tot.qtd - tot.falta)), "#67E8F9"], ["Falta entregar", fmtQtd(tot.falta), "#FDBA74"]].map(([l, v, cor]) => (
          <div key={l} style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: cor }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        {linhas.length === 0 ? (
          <div style={{ textAlign: "center", color: "#64748B", padding: 24 }}>Nenhuma venda lançada neste período. Use o botão <b style={{ color: "#FCD34D" }}>💰 Venda</b> em cada comodatário.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead><tr style={{ color: "#94A3B8", fontSize: 11, textTransform: "uppercase", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Cliente</th><th style={{ padding: 8 }}>Produto</th><th style={{ padding: 8, textAlign: "center" }}>Lanç.</th>
                <th style={{ padding: 8, textAlign: "right" }}>Qtd vendida</th><th style={{ padding: 8, textAlign: "right" }}>Entregue</th><th style={{ padding: 8, textAlign: "right" }}>Falta entregar</th><th style={{ padding: 8, textAlign: "right" }}>Valor</th>
              </tr></thead>
              <tbody>
                {linhas.map((e) => (
                  <Fragment key={e.cliente}>
                    <tr style={{ borderTop: "1px solid #1E293B", color: e.n ? "#F1F5F9" : "#64748B" }}>
                      <td style={{ padding: 8 }}><b>{e.cliente}</b>{e.telefone && <div style={{ fontSize: 11, color: "#94A3B8" }}>📱 {e.telefone}</div>}{e.endereco && <div style={{ fontSize: 11, color: "#94A3B8" }}>📍 {e.endereco}</div>}{e.vendedor && <div style={{ fontSize: 11, color: "#A5B4FC" }}>🧑‍💼 {e.vendedor}</div>}</td>
                      <td style={{ padding: 8, fontSize: 12 }}>{e.produtos}</td>
                      <td style={{ padding: 8, textAlign: "center" }}>{e.n}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 800, color: e.n ? "#FCD34D" : undefined }}>{fmtQtd(e.qtd)}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 700, color: "#67E8F9" }}>{e.n ? fmtQtd(r2(e.qtd - e.falta)) : "—"}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 700, color: e.falta > 0 ? "#FDBA74" : "#475569" }}>{e.falta > 0 ? fmtQtd(e.falta) : "—"}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 800, color: e.n ? "#10B981" : undefined }}>{fmt(e.valor)}</td>
                    </tr>
                    {detalhado && e.vendas.map((v) => (
                      <tr key={v.id} style={{ color: "#94A3B8", fontSize: 11 }}>
                        <td style={{ padding: "2px 8px 2px 20px" }} colSpan={2}>↳ {dataBR(v.data)}{v.obs ? ` · ${v.obs}` : ""}</td><td></td>
                        <td style={{ padding: "2px 8px", textAlign: "right" }}>{fmtQtd(v.quantidade)}{v.valorUnit ? ` × ${fmt(v.valorUnit)}` : ""}</td>
                        <td colSpan={2} style={{ padding: "2px 8px", textAlign: "right", color: v.baixa ? "#6EE7B7" : "#FDBA74" }}>{v.baixa ? `✅ ${dataBR(v.baixa.data)}${v.baixa.vendedor ? " · " + v.baixa.vendedor : ""}` : "⏳ a entregar"}</td>
                        <td style={{ padding: "2px 8px", textAlign: "right" }}>{fmt(v.valor)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: "2px solid #334155", fontWeight: 900, color: "#F1F5F9" }}>
                <td style={{ padding: 8 }} colSpan={2}>TOTAL ({linhas.length} cliente(s))</td><td style={{ padding: 8, textAlign: "center" }}>{tot.n}</td>
                <td style={{ padding: 8, textAlign: "right", color: "#FCD34D" }}>{fmtQtd(tot.qtd)}</td><td style={{ padding: 8, textAlign: "right", color: "#67E8F9" }}>{fmtQtd(r2(tot.qtd - tot.falta))}</td><td style={{ padding: 8, textAlign: "right", color: "#FDBA74" }}>{fmtQtd(tot.falta)}</td><td style={{ padding: 8, textAlign: "right", color: "#10B981" }}>{fmt(tot.valor)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}

/* ══════ BAIXAR GÁS (entrega do gás vendido) ══════ */
function FormBaixa({ comodato, comodatos, setComodatos, currentUser, onFechar, onSalvo }) {
  const pendentes = comodato ? [...vendasAEntregar(comodato)].sort((a, b) => (a.data || "").localeCompare(b.data || "")) : [];
  const [marcadas, setMarcadas] = useState(() => new Set(pendentes.map((v) => v.id)));
  const [data, setData] = useState(hojeISO());
  const [vendedor, setVendedor] = useState(comodato?.vendedor || "");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const nomesVendedores = useMemo(() => [...new Set(comodatos.flatMap((c) => (c.vendas || []).map((v) => v.baixa?.vendedor)).filter(Boolean))].sort(), [comodatos]);
  if (!comodato) return null;

  const entregues = (comodato.vendas || []).filter((v) => v.baixa).sort((a, b) => (b.baixa.data || "").localeCompare(a.baixa.data || "")).slice(0, 8);
  const qtdMarcada = r2(pendentes.filter((v) => marcadas.has(v.id)).reduce((s, v) => s + (Number(v.quantidade) || 0), 0));
  const alternar = (id) => { const n = new Set(marcadas); n.has(id) ? n.delete(id) : n.add(id); setMarcadas(n); };

  const salvar = () => {
    setErro("");
    if (marcadas.size === 0) return setErro("Marque as vendas que tiveram o gás entregue.");
    if (!data) return setErro("Informe a data da entrega.");
    const baixa = { data, vendedor: vendedor.trim().toUpperCase(), obs: obs.trim(), por: currentUser?.nome || "", em: new Date().toISOString() };
    setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, vendas: (c.vendas || []).map((v) => (marcadas.has(v.id) ? { ...v, baixa } : v)) } : c)));
    onSalvo(`🚚 Baixa feita: ${fmtQtd(qtdMarcada)} gás entregue(s) para ${comodato.cliente}`);
  };
  const desfazer = (v) => {
    if (!confirm(`Desfazer a baixa da venda de ${dataBR(v.data)} (${fmtQtd(v.quantidade)} gás)? Ela volta para "a entregar".`)) return;
    setComodatos((prev) => prev.map((c) => (c.id === comodato.id ? { ...c, vendas: (c.vendas || []).map((x) => (x.id === v.id ? (({ baixa, ...resto }) => resto)(x) : x)) } : c)));
  };

  return (
    <Modal titulo="🚚 Baixar gás entregue" onFechar={onFechar}>
      <div style={{ fontSize: 13, color: "#CBD5E1", marginBottom: 12 }}>
        <b>{comodato.cliente}</b> · {comodato.produto}<br />
        <span style={{ color: "#FDBA74" }}>Falta entregar: <b>{fmtQtd(qtdAEntregar(comodato))} gás</b></span>
      </div>
      {pendentes.length === 0 ? (
        <div style={{ ...alertaOk }}>✅ Não há gás para entregar a este cliente.</div>
      ) : (
        <>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Marque as vendas entregues</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            {pendentes.map((v) => (
              <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 10, background: marcadas.has(v.id) ? "#083344" : "#1E293B", border: `1px solid ${marcadas.has(v.id) ? "#0891B2" : "#334155"}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 13, color: "#F1F5F9" }}>
                <input type="checkbox" checked={marcadas.has(v.id)} onChange={() => alternar(v.id)} style={{ width: 16, height: 16 }} />
                <span style={{ minWidth: 80 }}>{dataBR(v.data)}</span>
                <b style={{ flex: 1 }}>{fmtQtd(v.quantidade)} gás</b>
                <span style={{ color: "#94A3B8", fontSize: 12 }}>{fmt(v.valor)}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={labelStyle}>Data da entrega</label><input style={inputStyle} type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
            <div>
              <label style={labelStyle}>Vendedor que entregou</label>
              <input style={inputStyle} list="comod-vendedores" placeholder="Nome do vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)} />
              <datalist id="comod-vendedores">{nomesVendedores.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Observação</label><input style={inputStyle} placeholder="Opcional" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
          </div>
          {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={onFechar}>Cancelar</button>
            <button style={{ ...btn, background: "#0891B2", flex: 2 }} onClick={salvar}>🚚 Dar baixa em {fmtQtd(qtdMarcada)} gás</button>
          </div>
        </>
      )}
      {entregues.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Últimas entregues</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entregues.map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1E293B", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#CBD5E1" }}>
                <span style={{ flex: 1 }}>Venda {dataBR(v.data)} · <b>{fmtQtd(v.quantidade)} gás</b></span>
                <span style={{ color: "#6EE7B7" }}>✅ {dataBR(v.baixa.data)}{v.baixa.vendedor ? ` · ${v.baixa.vendedor}` : ""}</span>
                <button style={{ ...miniBtn, background: "#374151", padding: "3px 8px" }} onClick={() => desfazer(v)} title="Desfazer baixa feita errada">↩️ Desfazer</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
