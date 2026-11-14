// ══════════════════════════════════════════════════════════════
//  RELATÓRIO POR VENDEDOR — dias em que sobrou ou faltou no caixa
//  Lê o Histórico (dias fechados). A diferença é sempre recalculada:
//  valor entregue − entrada do vendedor.
// ══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";
import {
  fmt, r2, isoLocal, hojeISO, dataBR, esc, normNome, abrirImpressao,
  card, cardTitle, labelStyle, inputStyle, btn, miniBtn, th, td, alertaAviso,
} from "./ui";

const diaDoFechamento = (f) => (f.timestamp ? isoLocal(new Date(f.timestamp)) : "");

function difDoVendedor(v) {
  const p = v.prestacao;
  if (!p) return null;
  const esperado = r2(v.total);
  const entregue = r2(p.totalEntregue);
  const dif = r2(entregue - esperado);
  const status = Math.abs(dif) < 0.01 ? "ok" : dif > 0 ? "sobrou" : "faltou";
  // o que foi lançado no saldo quando o dia fechou
  const lancado = p.status === "faltou" || p.status === "sobrou" ? r2(p.diferenca) : 0;
  return { esperado, entregue, dif, status, lancado, conferente: p.conferente?.nome || "" };
}

const primeiroDiaDoMes = () => { const d = new Date(); return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1)); };

export default function RelatorioVendedores({ cadastros = [], historico = [], vendedorInicial = "", onAbrirDia }) {
  const [vendedor, setVendedor] = useState(vendedorInicial ? normNome(vendedorInicial) : "");
  const [de, setDe] = useState(primeiroDiaDoMes());
  const [ate, setAte] = useState(hojeISO());
  const [soDiferencas, setSoDiferencas] = useState(true);

  useEffect(() => { if (vendedorInicial) setVendedor(normNome(vendedorInicial)); }, [vendedorInicial]);

  // Todas as linhas (1 por vendedor por dia) dentro do período
  const linhas = useMemo(() => {
    const out = [];
    historico.forEach((f) => {
      const dia = diaDoFechamento(f);
      if (!dia || (de && dia < de) || (ate && dia > ate)) return;
      (f.vendedores || []).forEach((v) => {
        const d = difDoVendedor(v);
        out.push({ fechId: f.id, dia, diaTexto: f.dataFormatada, nome: v.nome, chave: normNome(v.nome), pendente: !d, ...(d || {}) });
      });
    });
    return out.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
  }, [historico, de, ate]);

  // Lista de nomes: cadastros + quem aparece no histórico
  const nomes = useMemo(() => {
    const m = new Map();
    cadastros.forEach((c) => m.set(normNome(c.nome), c.nome));
    historico.forEach((f) => (f.vendedores || []).forEach((v) => { const k = normNome(v.nome); if (!m.has(k)) m.set(k, v.nome); }));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cadastros, historico]);

  const resumoDe = (ls) => {
    const conf = ls.filter((l) => !l.pendente);
    const sob = conf.filter((l) => l.status === "sobrou");
    const fal = conf.filter((l) => l.status === "faltou");
    return {
      dias: ls.length,
      ok: conf.filter((l) => l.status === "ok").length,
      qtdSobrou: sob.length, totalSobrou: r2(sob.reduce((s, l) => s + l.dif, 0)),
      qtdFaltou: fal.length, totalFaltou: r2(fal.reduce((s, l) => s + l.dif, 0)),
      liquido: r2(conf.reduce((s, l) => s + l.dif, 0)),
      divergentes: conf.filter((l) => Math.abs(l.lancado - (l.status === "ok" ? 0 : l.dif)) >= 0.01).length,
    };
  };

  const cadastroSel = cadastros.find((c) => normNome(c.nome) === vendedor);
  const nomeSel = nomes.find(([k]) => k === vendedor)?.[1] || "";
  const linhasVend = linhas.filter((l) => l.chave === vendedor);
  const linhasMostradas = soDiferencas ? linhasVend.filter((l) => !l.pendente && l.status !== "ok") : linhasVend;
  const res = resumoDe(linhasVend);
  const movimentos = (cadastroSel?.movimentos || []).filter((m) => m.tipo !== "fechamento" && (!de || m.data.slice(0, 10) >= de) && (!ate || m.data.slice(0, 10) <= ate));

  // Visão geral: todos os vendedores no período
  const geral = useMemo(() => {
    const grupos = new Map();
    linhas.forEach((l) => { if (!grupos.has(l.chave)) grupos.set(l.chave, []); grupos.get(l.chave).push(l); });
    return [...grupos.entries()].map(([k, ls]) => ({
      chave: k, nome: nomes.find(([n]) => n === k)?.[1] || ls[0].nome,
      saldo: cadastros.find((c) => normNome(c.nome) === k)?.saldo, ...resumoDe(ls),
    })).sort((a, b) => a.liquido - b.liquido);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, cadastros, nomes]);

  const corDif = (d) => (Math.abs(d) < 0.01 ? "#10B981" : d > 0 ? "#3B82F6" : "#EF4444");
  const txtDif = (d) => (d > 0 ? "+" : "") + fmt(d);
  const periodoTxt = `${dataBR(de) || "início"} a ${dataBR(ate) || "hoje"}`;

  const imprimirVendedor = () => {
    const rows = linhasMostradas.map((l) => `<tr>
      <td>${dataBR(l.dia)}</td>
      <td class="r">${l.pendente ? "—" : fmt(l.esperado)}</td>
      <td class="r">${l.pendente ? "—" : fmt(l.entregue)}</td>
      <td class="ctr ${l.status === "ok" ? "ok" : l.status === "sobrou" ? "pos" : "neg"}">${l.pendente ? "Pendente" : l.status === "ok" ? "OK" : l.status === "sobrou" ? "Sobrou" : "Faltou"}</td>
      <td class="r ${l.status === "ok" ? "ok" : l.dif > 0 ? "pos" : "neg"}">${l.pendente ? "—" : txtDif(l.dif)}</td>
      <td>${esc(l.conferente)}</td></tr>`).join("");
    const movs = movimentos.length ? `<h3 style="margin:16px 0 6px;font-size:13px">Ajustes de saldo no período</h3>
      <table><thead><tr><th>Data</th><th>Tipo</th><th class="r">Valor</th><th class="r">Saldo depois</th><th>Por</th><th>Obs.</th></tr></thead><tbody>
      ${movimentos.map((m) => `<tr><td>${new Date(m.data).toLocaleString("pt-BR")}</td><td>${m.tipo === "ajuste_manual" ? "Ajuste manual" : "Correção de fechamento"}</td>
      <td class="r ${m.valor >= 0 ? "pos" : "neg"}">${txtDif(m.valor)}</td><td class="r">${fmt(m.saldoApos)}</td><td>${esc(m.por || "")}</td><td>${esc(m.obs || "")}</td></tr>`).join("")}
      </tbody></table>` : "";
    abrirImpressao(`Relatório ${nomeSel}`, `
      <h1>Relatório de caixa — ${esc(nomeSel)}</h1>
      <div class="sub">Período: ${periodoTxt} · ${soDiferencas ? "somente dias com sobra ou falta" : "todos os dias"} · emitido em ${new Date().toLocaleString("pt-BR")}</div>
      <div class="cards">
        <div class="c"><div class="l">Dias no período</div><div class="v">${res.dias}</div></div>
        <div class="c"><div class="l">Dias OK</div><div class="v ok">${res.ok}</div></div>
        <div class="c"><div class="l">Sobrou (${res.qtdSobrou} dias)</div><div class="v pos">${txtDif(res.totalSobrou)}</div></div>
        <div class="c"><div class="l">Faltou (${res.qtdFaltou} dias)</div><div class="v neg">${fmt(res.totalFaltou)}</div></div>
        <div class="c"><div class="l">Resultado do período</div><div class="v ${res.liquido >= 0 ? "pos" : "neg"}">${txtDif(res.liquido)}</div></div>
        ${cadastroSel ? `<div class="c"><div class="l">Saldo atual</div><div class="v ${cadastroSel.saldo >= 0 ? "pos" : "neg"}">${txtDif(cadastroSel.saldo || 0)}</div></div>` : ""}
      </div>
      <table><thead><tr><th>Data</th><th class="r">Esperado</th><th class="r">Entregue</th><th class="ctr">Status</th><th class="r">Diferença</th><th>Conferido por</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="ctr">Nenhum dia com sobra ou falta no período.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4">Resultado do período</td><td class="r ${res.liquido >= 0 ? "pos" : "neg"}">${txtDif(res.liquido)}</td><td></td></tr></tfoot></table>
      ${movs}
      <div class="ass"><div>Vendedor</div><div>Responsável pelo caixa</div></div>`);
  };

  const imprimirGeral = () => {
    const rows = geral.map((g) => `<tr><td>${esc(g.nome)}</td><td class="ctr">${g.dias}</td><td class="ctr">${g.ok}</td>
      <td class="r pos">${g.qtdSobrou ? `${txtDif(g.totalSobrou)} (${g.qtdSobrou})` : "—"}</td>
      <td class="r neg">${g.qtdFaltou ? `${fmt(g.totalFaltou)} (${g.qtdFaltou})` : "—"}</td>
      <td class="r ${g.liquido >= 0 ? "pos" : "neg"}">${txtDif(g.liquido)}</td>
      <td class="r">${g.saldo === undefined ? "—" : txtDif(g.saldo)}</td></tr>`).join("");
    abrirImpressao("Sobras e faltas por vendedor", `
      <h1>Sobras e faltas por vendedor</h1>
      <div class="sub">Período: ${periodoTxt} · emitido em ${new Date().toLocaleString("pt-BR")}</div>
      <table><thead><tr><th>Vendedor</th><th class="ctr">Dias</th><th class="ctr">OK</th><th class="r">Sobrou (dias)</th><th class="r">Faltou (dias)</th><th class="r">Resultado</th><th class="r">Saldo atual</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="ctr">Nenhum dia fechado no período.</td></tr>`}</tbody></table>`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* FILTROS */}
      <div style={card}>
        <h2 style={cardTitle}>📊 Relatório de sobras e faltas</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Vendedor</label>
            <select style={inputStyle} value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
              <option value="">— Todos (visão geral) —</option>
              {nomes.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>De</label><input style={inputStyle} type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div><label style={labelStyle}>Até</label><input style={inputStyle} type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {[
            ["Este mês", primeiroDiaDoMes(), hojeISO()],
            ["Últimos 30 dias", isoLocal(new Date(Date.now() - 29 * 864e5)), hojeISO()],
            ["Últimos 90 dias", isoLocal(new Date(Date.now() - 89 * 864e5)), hojeISO()],
            ["Tudo", "", ""],
          ].map(([rot, a, b]) => (
            <button key={rot} style={{ ...miniBtn, background: de === a && ate === b ? "#10B981" : "#334155", padding: "6px 12px" }} onClick={() => { setDe(a); setAte(b); }}>{rot}</button>
          ))}
        </div>
      </div>

      {!vendedor ? (
        /* VISÃO GERAL */
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <h2 style={{ ...cardTitle, marginBottom: 0 }}>👥 Todos os vendedores — {periodoTxt}</h2>
            <button style={{ ...btn, background: "#DC2626", padding: "8px 14px" }} onClick={imprimirGeral}>🖨️ Imprimir / PDF</button>
          </div>
          {geral.length === 0 ? (
            <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>Nenhum dia fechado neste período.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead><tr>
                  <th style={th}>Vendedor</th><th style={{ ...th, textAlign: "center" }}>Dias</th><th style={{ ...th, textAlign: "center" }}>OK</th>
                  <th style={{ ...th, textAlign: "right" }}>Sobrou</th><th style={{ ...th, textAlign: "right" }}>Faltou</th>
                  <th style={{ ...th, textAlign: "right" }}>Resultado</th><th style={{ ...th, textAlign: "right" }}>Saldo atual</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {geral.map((g, i) => (
                    <tr key={g.chave} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527", cursor: "pointer" }} onClick={() => setVendedor(g.chave)}>
                      <td style={{ ...td, fontWeight: 700, color: "#F1F5F9" }}>👤 {g.nome}{g.divergentes > 0 && <span title="Tem dia com saldo lançado diferente da diferença real" style={{ marginLeft: 6 }}>⚠️</span>}</td>
                      <td style={{ ...td, textAlign: "center" }}>{g.dias}</td>
                      <td style={{ ...td, textAlign: "center", color: "#10B981" }}>{g.ok}</td>
                      <td style={{ ...td, textAlign: "right", color: "#3B82F6" }}>{g.qtdSobrou ? <>{txtDif(g.totalSobrou)} <span style={{ fontSize: 10, color: "#64748B" }}>({g.qtdSobrou})</span></> : "—"}</td>
                      <td style={{ ...td, textAlign: "right", color: "#EF4444" }}>{g.qtdFaltou ? <>{fmt(g.totalFaltou)} <span style={{ fontSize: 10, color: "#64748B" }}>({g.qtdFaltou})</span></> : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: corDif(g.liquido) }}>{txtDif(g.liquido)}</td>
                      <td style={{ ...td, textAlign: "right", color: g.saldo === undefined ? "#64748B" : corDif(g.saldo) }}>{g.saldo === undefined ? "—" : txtDif(g.saldo)}</td>
                      <td style={{ ...td, color: "#64748B" }}>›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>Clique num vendedor para ver os dias. ⚠️ = algum dia teve o saldo lançado com valor diferente da diferença real.</div>
            </div>
          )}
        </div>
      ) : (
        /* UM VENDEDOR */
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <Indicador titulo="📅 Dias no período" valor={res.dias} cor="#94A3B8" />
            <Indicador titulo="✅ Dias OK" valor={res.ok} cor="#10B981" />
            <Indicador titulo={`📈 Sobrou (${res.qtdSobrou} dias)`} valor={txtDif(res.totalSobrou)} cor="#3B82F6" />
            <Indicador titulo={`⚠️ Faltou (${res.qtdFaltou} dias)`} valor={fmt(res.totalFaltou)} cor="#EF4444" />
            <Indicador titulo="⚖️ Resultado do período" valor={txtDif(res.liquido)} cor={corDif(res.liquido)} />
            {cadastroSel && <Indicador titulo="💰 Saldo atual" valor={txtDif(cadastroSel.saldo || 0)} cor={corDif(cadastroSel.saldo || 0)} />}
          </div>

          {res.divergentes > 0 && (
            <div style={alertaAviso}>
              ⚠️ Em {res.divergentes} dia(s) o valor lançado no saldo foi diferente da diferença real (marcados abaixo).
              Abra o dia no <b>Histórico → Ver → Editar</b> e salve para corrigir o saldo.
            </div>
          )}

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <h2 style={{ ...cardTitle, marginBottom: 0 }}>👤 {nomeSel} — {periodoTxt}</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 12, color: "#94A3B8", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={soDiferencas} onChange={(e) => setSoDiferencas(e.target.checked)} /> Só dias com sobra/falta
                </label>
                <button style={{ ...btn, background: "#374151", padding: "8px 14px" }} onClick={() => setVendedor("")}>← Todos</button>
                <button style={{ ...btn, background: "#DC2626", padding: "8px 14px" }} onClick={imprimirVendedor}>🖨️ Imprimir / PDF</button>
              </div>
            </div>
            {linhasMostradas.length === 0 ? (
              <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>
                {linhasVend.length === 0 ? "Este vendedor não tem dias fechados no período." : "✅ Nenhum dia com sobra ou falta no período."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                  <thead><tr>
                    <th style={th}>Data</th><th style={{ ...th, textAlign: "right" }}>Esperado</th><th style={{ ...th, textAlign: "right" }}>Entregue</th>
                    <th style={{ ...th, textAlign: "center" }}>Status</th><th style={{ ...th, textAlign: "right" }}>Diferença</th><th style={th}>Conferido por</th>
                  </tr></thead>
                  <tbody>
                    {linhasMostradas.map((l, i) => {
                      const divergente = !l.pendente && Math.abs(l.lancado - (l.status === "ok" ? 0 : l.dif)) >= 0.01;
                      return (
                        <tr key={l.fechId + "-" + i} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527" }}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {onAbrirDia ? <a href="#" onClick={(e) => { e.preventDefault(); onAbrirDia(l.fechId); }} style={{ color: "#93C5FD" }}>{dataBR(l.dia)}</a> : dataBR(l.dia)}
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>{l.pendente ? "—" : fmt(l.esperado)}</td>
                          <td style={{ ...td, textAlign: "right" }}>{l.pendente ? "—" : fmt(l.entregue)}</td>
                          <td style={{ ...td, textAlign: "center", fontWeight: 700, color: l.pendente ? "#64748B" : corDif(l.dif) }}>
                            {l.pendente ? "⏳ Pendente" : l.status === "ok" ? "✅ OK" : l.status === "sobrou" ? "📈 Sobrou" : "⚠️ Faltou"}
                          </td>
                          <td style={{ ...td, textAlign: "right", fontWeight: 800, color: l.pendente ? "#64748B" : corDif(l.dif) }}>
                            {l.pendente ? "—" : txtDif(l.dif)}
                            {divergente && <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 600 }}>⚠️ no saldo entrou {txtDif(l.lancado)}</div>}
                          </td>
                          <td style={{ ...td, fontSize: 12, color: "#94A3B8" }}>{l.conferente || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {movimentos.length > 0 && (
            <div style={card}>
              <h2 style={cardTitle}>✏️ Ajustes de saldo no período</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                  <thead><tr><th style={th}>Data</th><th style={th}>Tipo</th><th style={{ ...th, textAlign: "right" }}>Valor</th><th style={{ ...th, textAlign: "right" }}>Saldo depois</th><th style={th}>Por</th><th style={th}>Obs.</th></tr></thead>
                  <tbody>
                    {movimentos.map((m, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527" }}>
                        <td style={td}>{new Date(m.data).toLocaleString("pt-BR")}</td>
                        <td style={td}>{m.tipo === "ajuste_manual" ? "✏️ Ajuste manual" : "🔧 Correção de fechamento"}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700, color: corDif(m.valor) }}>{txtDif(m.valor)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(m.saldoApos)}</td>
                        <td style={{ ...td, color: "#94A3B8" }}>{m.por || "—"}</td>
                        <td style={{ ...td, color: "#94A3B8" }}>{m.obs || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Indicador({ titulo, valor, cor }) {
  return (
    <div style={{ background: "#0F172A", border: `1px solid ${cor}55`, borderRadius: 12, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontWeight: 900, color: cor, fontSize: 19, marginTop: 4 }}>{valor}</div>
    </div>
  );
}
