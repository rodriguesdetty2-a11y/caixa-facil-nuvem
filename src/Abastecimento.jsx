// ══════════════════════════════════════════════════════════════
//  ABA ABASTECIMENTO — controle de combustível das motos
//  - Cada moto tem um LIMITE por período (dia, semana ou mês)
//  - Limite por NOTA (valor máximo de um único abastecimento)
//  - Alertas: ao chegar perto do limite, ao estourar o limite
//    e ao lançar uma nota acima do limite por nota
//  Dados na nuvem: "motos", "abastecimentos", "abastecimento_config"
// ══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";
import {
  fmt, r2, lerValor, valorParaInput, isoLocal, hojeISO, dataBR, novoId, esc, abrirImpressao,
  card, cardTitle, labelStyle, inputStyle, btn, miniBtn, th, td, alertaErro, alertaAviso, alertaOk,
} from "./ui";

export const CONFIG_PADRAO = { limiteNotaPadrao: 0, avisoPercent: 80 };
const PERIODOS = { dia: "por dia", semana: "por semana", mes: "por mês" };
const PERIODO_ATUAL = { dia: "hoje", semana: "nesta semana", mes: "neste mês" };

/* Início e fim do período que contém a data (semana = segunda a domingo) */
export function periodoDe(periodo, refISO) {
  const [a, m, d] = refISO.split("-").map(Number);
  const ref = new Date(a, m - 1, d);
  if (periodo === "dia") return [refISO, refISO];
  if (periodo === "semana") {
    const dow = (ref.getDay() + 6) % 7; // segunda = 0
    const ini = new Date(a, m - 1, d - dow);
    const fim = new Date(a, m - 1, d - dow + 6);
    return [isoLocal(ini), isoLocal(fim)];
  }
  return [isoLocal(new Date(a, m - 1, 1)), isoLocal(new Date(a, m, 0))];
}

const limiteNotaDa = (moto, config) => Number(moto?.limiteNota) || Number(config?.limiteNotaPadrao) || 0;

export function gastoNoPeriodo(moto, abastecimentos, refISO, ignorarId) {
  const [ini, fim] = periodoDe(moto.periodo || "mes", refISO);
  return r2(abastecimentos
    .filter((x) => x.motoId === moto.id && x.id !== ignorarId && x.data >= ini && x.data <= fim)
    .reduce((s, x) => s + (Number(x.valor) || 0), 0));
}

/* Situação de cada moto no período atual */
export function statusMotos(motos = [], abastecimentos = [], config = CONFIG_PADRAO, refISO = hojeISO()) {
  const aviso = (Number(config?.avisoPercent) || 80) / 100;
  return motos.filter((m) => m.ativa !== false).map((m) => {
    const limite = Number(m.limitePeriodo) || 0;
    const gasto = gastoNoPeriodo(m, abastecimentos, refISO);
    const pct = limite > 0 ? gasto / limite : 0;
    const nivel = limite <= 0 ? "sem" : pct > 1.0001 ? "estourou" : pct >= 0.9999 ? "atingiu" : pct >= aviso ? "aviso" : "ok";
    return { moto: m, limite, gasto, pct, restante: r2(limite - gasto), nivel };
  });
}
// Quantas motos precisam de atenção (para o número vermelho na aba)
export const contarAlertasAbastecimento = (motos, abastecimentos, config) =>
  statusMotos(motos, abastecimentos, config).filter((s) => s.nivel === "estourou" || s.nivel === "atingiu" || s.nivel === "aviso").length;

const COR = { ok: "#10B981", aviso: "#F59E0B", atingiu: "#F97316", estourou: "#EF4444", sem: "#64748B" };

const FORM_VAZIO = { data: hojeISO(), motoId: "", motorista: "", valor: "", litros: "", km: "", posto: "", nota: "", obs: "" };
const MOTO_VAZIA = { nome: "", placa: "", motorista: "", limitePeriodo: "", periodo: "mes", limiteNota: "" };

export default function AbastecimentoTab({ motos = [], setMotos, abastecimentos = [], setAbastecimentos, config, setConfig, cadastros = [], currentUser }) {
  const cfg = { ...CONFIG_PADRAO, ...(config || {}) };
  const admin = !!currentUser?.admin;
  const motosAtivas = motos.filter((m) => m.ativa !== false);

  const [form, setForm] = useState({ ...FORM_VAZIO, motoId: motosAtivas[0]?.id || "", motorista: motosAtivas[0]?.motorista || "" });
  const [editId, setEditId] = useState(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [mostrarMotos, setMostrarMotos] = useState(motos.length === 0);
  const [mesFiltro, setMesFiltro] = useState(hojeISO().slice(0, 7));
  const [motoFiltro, setMotoFiltro] = useState("");

  // Se não há moto escolhida (ex.: acabou de cadastrar a primeira), escolhe a primeira ativa
  useEffect(() => {
    if (!motosAtivas.some((m) => m.id === form.motoId) && motosAtivas[0]) {
      setForm((f) => ({ ...f, motoId: motosAtivas[0].id, motorista: f.motorista || motosAtivas[0].motorista || "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motosAtivas.map((m) => m.id).join(",")]);

  const situacao = statusMotos(motos, abastecimentos, cfg);
  const emAlerta = situacao.filter((s) => s.nivel !== "ok" && s.nivel !== "sem");

  const motoSel = motos.find((m) => m.id === form.motoId);
  const valorDig = lerValor(form.valor);

  // Avisos em tempo real enquanto preenche
  const previa = useMemo(() => {
    if (!motoSel || valorDig <= 0) return [];
    const avisos = [];
    const limNota = limiteNotaDa(motoSel, cfg);
    if (limNota > 0 && valorDig > limNota + 0.001)
      avisos.push({ tipo: "nota", grave: true, txt: `Nota acima do limite por nota (${fmt(limNota)}): passou ${fmt(valorDig - limNota)}.` });
    const lim = Number(motoSel.limitePeriodo) || 0;
    if (lim > 0) {
      const gasto = gastoNoPeriodo(motoSel, abastecimentos, form.data || hojeISO(), editId);
      const depois = r2(gasto + valorDig);
      const per = periodoDe(motoSel.periodo || "mes", form.data || hojeISO());
      const perTxt = motoSel.periodo === "dia" ? dataBR(per[0]) : `${dataBR(per[0])} a ${dataBR(per[1])}`;
      if (depois > lim + 0.001)
        avisos.push({ tipo: "limite", grave: true, txt: `Vai ESTOURAR o limite ${PERIODOS[motoSel.periodo || "mes"]} (${fmt(lim)}): já gastou ${fmt(gasto)} (${perTxt}), ficaria ${fmt(depois)} — ${fmt(depois - lim)} acima.` });
      else if (depois >= lim * (cfg.avisoPercent / 100))
        avisos.push({ tipo: "aviso", grave: false, txt: `Chegando no limite: ficaria ${fmt(depois)} de ${fmt(lim)} (${Math.round((depois / lim) * 100)}%). Restam ${fmt(lim - depois)}.` });
    }
    return avisos;
  }, [motoSel, valorDig, form.data, abastecimentos, editId, cfg.avisoPercent, cfg.limiteNotaPadrao]);

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const escolherMoto = (id) => {
    const m = motos.find((x) => x.id === id);
    const anterior = motos.find((x) => x.id === form.motoId);
    const motorista = !form.motorista || form.motorista === anterior?.motorista ? m?.motorista || "" : form.motorista;
    setForm({ ...form, motoId: id, motorista });
  };

  const avisar = (m) => { setOk(m); setTimeout(() => setOk(""), 3500); };

  const salvar = () => {
    setErro("");
    if (!motoSel) { setErro("Escolha a moto."); return; }
    if (valorDig <= 0) { setErro("Informe o valor do abastecimento."); return; }
    if (!form.data) { setErro("Informe a data."); return; }

    const graves = previa.filter((a) => a.grave);
    if (graves.length > 0) {
      const ok = confirm(`🚨 ALERTA DE ABASTECIMENTO — ${motoSel.nome}\n\n${graves.map((a) => "• " + a.txt).join("\n\n")}\n\nDeseja lançar mesmo assim?\n(O lançamento fica marcado com o alerta.)`);
      if (!ok) return;
    }

    const original = editId ? abastecimentos.find((x) => x.id === editId) : null;
    const registro = {
      id: original ? original.id : novoId(),
      data: form.data,
      motoId: motoSel.id,
      motoNome: motoSel.nome,
      placa: motoSel.placa || "",
      motorista: form.motorista.trim(),
      valor: r2(valorDig),
      litros: lerValor(form.litros) || null,
      km: lerValor(form.km) || null,
      posto: form.posto.trim(),
      nota: form.nota.trim(),
      obs: form.obs.trim(),
      alertas: previa.map((a) => a.tipo),
      criadoPor: original ? original.criadoPor : currentUser?.nome || "",
      criadoEm: original ? original.criadoEm : new Date().toISOString(),
      ...(original ? { editadoPor: currentUser?.nome || "", editadoEm: new Date().toISOString() } : {}),
    };
    if (original) setAbastecimentos((prev) => prev.map((x) => (x.id === original.id ? registro : x)));
    else setAbastecimentos((prev) => [registro, ...(prev || [])]);

    avisar(original ? "✅ Abastecimento atualizado!" : "✅ Abastecimento lançado!");
    setEditId(null);
    setForm({ ...FORM_VAZIO, data: form.data, motoId: motoSel.id, motorista: motoSel.motorista || "" });
  };

  const editar = (x) => {
    setEditId(x.id);
    setErro("");
    setForm({
      data: x.data, motoId: x.motoId, motorista: x.motorista || "", valor: valorParaInput(x.valor),
      litros: x.litros ? String(x.litros).replace(".", ",") : "", km: x.km ? String(x.km) : "",
      posto: x.posto || "", nota: x.nota || "", obs: x.obs || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelar = () => { setEditId(null); setErro(""); setForm({ ...FORM_VAZIO, motoId: form.motoId, motorista: motoSel?.motorista || "" }); };

  const excluir = (x) => {
    if (!admin) { alert("Só administrador pode excluir abastecimentos."); return; }
    if (!confirm(`Excluir o abastecimento de ${dataBR(x.data)} — ${x.motoNome} — ${fmt(x.valor)}?`)) return;
    setAbastecimentos((prev) => prev.filter((y) => y.id !== x.id));
    if (editId === x.id) cancelar();
  };

  // Lista filtrada (mês + moto)
  const lista = useMemo(() => abastecimentos
    .filter((x) => (!mesFiltro || x.data.startsWith(mesFiltro)) && (!motoFiltro || x.motoId === motoFiltro))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.criadoEm || "").localeCompare(a.criadoEm || ""))),
  [abastecimentos, mesFiltro, motoFiltro]);
  const totalLista = r2(lista.reduce((s, x) => s + x.valor, 0));
  const litrosLista = r2(lista.reduce((s, x) => s + (Number(x.litros) || 0), 0));
  const porMoto = useMemo(() => {
    const m = new Map();
    lista.forEach((x) => { const k = x.motoId; const e = m.get(k) || { nome: x.motoNome, qtd: 0, total: 0, litros: 0, alertas: 0 }; e.qtd++; e.total += x.valor; e.litros += Number(x.litros) || 0; if (x.alertas?.some((a) => a !== "aviso")) e.alertas++; m.set(k, e); });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [lista]);

  const mesTxt = mesFiltro ? new Date(mesFiltro + "-15").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "todos os meses";

  const imprimir = () => {
    const resumo = porMoto.map((p) => `<tr><td>${esc(p.nome)}</td><td class="ctr">${p.qtd}</td><td class="r">${p.litros ? r2(p.litros).toLocaleString("pt-BR") + " L" : "—"}</td><td class="r">${fmt(p.total)}</td><td class="ctr ${p.alertas ? "alerta" : ""}">${p.alertas || "—"}</td></tr>`).join("");
    const rows = lista.map((x) => `<tr><td>${dataBR(x.data)}</td><td>${esc(x.motoNome)}${x.placa ? " · " + esc(x.placa) : ""}</td><td>${esc(x.motorista || "")}</td>
      <td>${esc(x.nota || "")}</td><td>${esc(x.posto || "")}</td><td class="r">${x.litros ? String(x.litros).replace(".", ",") + " L" : ""}</td>
      <td class="r">${fmt(x.valor)}</td><td class="alerta">${(x.alertas || []).filter((a) => a !== "aviso").map((a) => (a === "nota" ? "Nota acima do limite" : "Estourou limite")).join(", ")}</td></tr>`).join("");
    abrirImpressao("Abastecimentos", `
      <h1>Controle de abastecimento — ${esc(mesTxt)}</h1>
      <div class="sub">${motoFiltro ? "Moto: " + esc(motos.find((m) => m.id === motoFiltro)?.nome || "") + " · " : ""}emitido em ${new Date().toLocaleString("pt-BR")}</div>
      <div class="cards">
        <div class="c"><div class="l">Abastecimentos</div><div class="v">${lista.length}</div></div>
        <div class="c"><div class="l">Litros</div><div class="v">${litrosLista ? litrosLista.toLocaleString("pt-BR") + " L" : "—"}</div></div>
        <div class="c"><div class="l">Total gasto</div><div class="v">${fmt(totalLista)}</div></div>
      </div>
      <table><thead><tr><th>Moto</th><th class="ctr">Qtd</th><th class="r">Litros</th><th class="r">Total</th><th class="ctr">Alertas</th></tr></thead><tbody>${resumo}</tbody></table>
      <h3 style="margin:16px 0 6px;font-size:13px">Lançamentos</h3>
      <table><thead><tr><th>Data</th><th>Moto</th><th>Motorista</th><th>Nota</th><th>Posto</th><th class="r">Litros</th><th class="r">Valor</th><th>Alerta</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="ctr">Nenhum abastecimento.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="6">Total</td><td class="r">${fmt(totalLista)}</td><td></td></tr></tfoot></table>
      <div class="ass"><div>Responsável</div><div>Conferido por</div></div>`);
  };

  const nomesMotoristas = useMemo(() => [...new Set([...cadastros.map((c) => c.nome), ...motos.map((m) => m.motorista), ...abastecimentos.map((x) => x.motorista)].filter(Boolean))].sort(), [cadastros, motos, abastecimentos]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ALERTAS */}
      {emAlerta.length > 0 && (
        <div style={{ ...alertaErro, background: emAlerta.some((s) => s.nivel !== "aviso") ? "#450a0a" : "#422006", borderColor: emAlerta.some((s) => s.nivel !== "aviso") ? "#EF444488" : "#F59E0B88", color: emAlerta.some((s) => s.nivel !== "aviso") ? "#FCA5A5" : "#FDE68A" }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>🚨 Atenção com o limite de abastecimento</div>
          {emAlerta.map((s) => (
            <div key={s.moto.id}>
              • <b>{s.moto.nome}</b>{s.moto.motorista ? ` (${s.moto.motorista})` : ""}: {fmt(s.gasto)} de {fmt(s.limite)} {PERIODO_ATUAL[s.moto.periodo || "mes"]} —{" "}
              {s.nivel === "estourou" ? <b>ESTOUROU em {fmt(-s.restante)}</b> : s.nivel === "atingiu" ? <b>ATINGIU o limite</b> : <>{Math.round(s.pct * 100)}% usado, restam {fmt(s.restante)}</>}
            </div>
          ))}
        </div>
      )}

      {/* PAINEL DAS MOTOS */}
      {situacao.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
          {situacao.map((s) => {
            const cor = COR[s.nivel];
            return (
              <div key={s.moto.id} style={{ background: "#0F172A", border: `1px solid ${cor}66`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: "#F1F5F9" }}>🏍️ {s.moto.nome}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{[s.moto.placa, s.moto.motorista].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div style={{ fontSize: 10, color: cor, fontWeight: 800, textAlign: "right" }}>
                    {s.nivel === "estourou" ? "🚨 ESTOUROU" : s.nivel === "atingiu" ? "🟠 NO LIMITE" : s.nivel === "aviso" ? "⚠️ PERTO" : s.nivel === "sem" ? "sem limite" : "✅ OK"}
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 20, fontWeight: 900, color: cor }}>{fmt(s.gasto)}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>
                  {s.limite > 0 ? <>de {fmt(s.limite)} {PERIODO_ATUAL[s.moto.periodo || "mes"]} · {s.restante >= 0 ? `restam ${fmt(s.restante)}` : `passou ${fmt(-s.restante)}`}</> : `gasto ${PERIODO_ATUAL[s.moto.periodo || "mes"]}`}
                </div>
                {s.limite > 0 && (
                  <div style={{ marginTop: 8, height: 8, background: "#1E293B", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, s.pct * 100)}%`, height: "100%", background: cor }} />
                  </div>
                )}
                {limiteNotaDa(s.moto, cfg) > 0 && <div style={{ fontSize: 10, color: "#64748B", marginTop: 6 }}>Limite por nota: {fmt(limiteNotaDa(s.moto, cfg))}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* LANÇAR */}
      <div style={{ ...card, borderColor: editId ? "#3B82F6" : "#1E293B" }}>
        <h2 style={cardTitle}>{editId ? "✏️ Editando abastecimento" : "⛽ Lançar abastecimento"}</h2>
        {motosAtivas.length === 0 ? (
          <div style={alertaAviso}>Nenhuma moto cadastrada. {admin ? <>Clique em <b>🏍️ Motos e limites</b> abaixo para cadastrar.</> : "Peça ao administrador para cadastrar as motos."}</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
              <div><label style={labelStyle}>Data *</label><input style={inputStyle} type="date" {...campo("data")} /></div>
              <div style={{ gridColumn: "span 2" }}>
                <label style={labelStyle}>Moto *</label>
                <select style={inputStyle} value={form.motoId} onChange={(e) => escolherMoto(e.target.value)}>
                  <option value="">— escolha —</option>
                  {motosAtivas.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.placa ? ` · ${m.placa}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Motorista</label>
                <input style={inputStyle} list="motoristas-abast" {...campo("motorista")} />
                <datalist id="motoristas-abast">{nomesMotoristas.map((n) => <option key={n} value={n} />)}</datalist>
              </div>
              <div>
                <label style={labelStyle}>Valor da nota (R$) *</label>
                <input style={{ ...inputStyle, fontSize: 18, fontWeight: 800, borderColor: previa.some((a) => a.grave) ? "#EF4444" : "#334155" }} inputMode="decimal" placeholder="0,00" {...campo("valor")} />
              </div>
              <div><label style={labelStyle}>Litros</label><input style={inputStyle} inputMode="decimal" placeholder="Opcional" {...campo("litros")} /></div>
              <div><label style={labelStyle}>KM da moto</label><input style={inputStyle} inputMode="numeric" placeholder="Opcional" {...campo("km")} /></div>
              <div><label style={labelStyle}>Nº da nota</label><input style={inputStyle} placeholder="Opcional" {...campo("nota")} /></div>
              <div><label style={labelStyle}>Posto</label><input style={inputStyle} placeholder="Opcional" {...campo("posto")} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Observação</label><input style={inputStyle} placeholder="Opcional" {...campo("obs")} /></div>
            </div>

            {previa.map((a, i) => (
              <div key={i} style={{ ...(a.grave ? alertaErro : alertaAviso), marginTop: 10 }}>{a.grave ? "🚨 " : "⚠️ "}{a.txt}</div>
            ))}
            {erro && <div style={{ ...alertaErro, marginTop: 10 }}>⚠️ {erro}</div>}
            {ok && <div style={{ ...alertaOk, marginTop: 10 }}>{ok}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button style={{ ...btn, background: "#059669", flex: 2, fontSize: 15, padding: "12px 20px" }} onClick={salvar}>{editId ? "💾 Salvar alterações" : "⛽ Lançar abastecimento"}</button>
              {editId && <button style={{ ...btn, background: "#374151", flex: 1 }} onClick={cancelar}>Cancelar</button>}
            </div>
          </>
        )}
      </div>

      {/* LISTA / RELATÓRIO */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <h2 style={{ ...cardTitle, marginBottom: 0 }}>📋 Abastecimentos — {mesTxt}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="month" style={{ ...inputStyle, width: "auto", padding: "7px 10px" }} value={mesFiltro} onChange={(e) => setMesFiltro(e.target.value)} />
            <select style={{ ...inputStyle, width: "auto", padding: "7px 10px" }} value={motoFiltro} onChange={(e) => setMotoFiltro(e.target.value)}>
              <option value="">Todas as motos</option>
              {motos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            <button style={{ ...btn, background: "#DC2626", padding: "8px 14px" }} onClick={imprimir}>🖨️ Imprimir / PDF</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
          <MiniInd titulo="Abastecimentos" valor={lista.length} cor="#94A3B8" />
          <MiniInd titulo="Litros" valor={litrosLista ? litrosLista.toLocaleString("pt-BR") + " L" : "—"} cor="#06B6D4" />
          <MiniInd titulo="Total gasto" valor={fmt(totalLista)} cor="#10B981" />
          <MiniInd titulo="Com alerta" valor={lista.filter((x) => x.alertas?.some((a) => a !== "aviso")).length} cor="#EF4444" />
        </div>

        {lista.length === 0 ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>Nenhum abastecimento neste filtro.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>Data</th><th style={th}>Moto</th><th style={th}>Motorista</th><th style={th}>Nota / Posto</th>
                <th style={{ ...th, textAlign: "right" }}>Litros</th><th style={{ ...th, textAlign: "right" }}>Valor</th><th style={{ ...th, textAlign: "center" }}>Ações</th>
              </tr></thead>
              <tbody>
                {lista.map((x, i) => {
                  const graves = (x.alertas || []).filter((a) => a !== "aviso");
                  return (
                    <tr key={x.id} style={{ background: graves.length ? "#2a0f12" : i % 2 === 0 ? "#0F172A" : "#0D1527" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{dataBR(x.data)}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#F1F5F9" }}>
                        {x.motoNome}
                        {graves.map((a) => (
                          <div key={a} style={{ fontSize: 10, color: "#FCA5A5", fontWeight: 700 }}>🚨 {a === "nota" ? "Nota acima do limite" : "Estourou o limite"}</div>
                        ))}
                      </td>
                      <td style={td}>{x.motorista || "—"}</td>
                      <td style={{ ...td, fontSize: 12, color: "#94A3B8" }}>{[x.nota && "Nº " + x.nota, x.posto].filter(Boolean).join(" · ") || "—"}{x.obs && <div style={{ fontSize: 11 }}>📝 {x.obs}</div>}</td>
                      <td style={{ ...td, textAlign: "right" }}>{x.litros ? String(x.litros).replace(".", ",") + " L" : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800, color: graves.length ? "#FCA5A5" : "#10B981" }}>{fmt(x.valor)}</td>
                      <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                        <button style={{ ...miniBtn, background: "#B45309" }} onClick={() => editar(x)} title="Editar">✏️</button>{" "}
                        {admin && <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(x)} title="Excluir">🗑️</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MOTOS E LIMITES */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button style={{ ...btn, background: mostrarMotos ? "#374151" : "#1D4ED8" }} onClick={() => setMostrarMotos(!mostrarMotos)}>
          🏍️ Motos e limites ({motos.length}) {mostrarMotos ? "▲" : "▼"}
        </button>
      </div>
      {mostrarMotos && <MotosCard motos={motos} setMotos={setMotos} cfg={cfg} setConfig={setConfig} admin={admin} nomesMotoristas={nomesMotoristas} />}
    </div>
  );
}

/* ══════ CADASTRO DE MOTOS E LIMITES ══════ */
function MotosCard({ motos, setMotos, cfg, setConfig, admin, nomesMotoristas }) {
  const [form, setForm] = useState(MOTO_VAZIA);
  const [editId, setEditId] = useState(null);
  const [erro, setErro] = useState("");
  const [limNotaPadrao, setLimNotaPadrao] = useState(valorParaInput(cfg.limiteNotaPadrao));
  const [avisoPct, setAvisoPct] = useState(String(cfg.avisoPercent));

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }), disabled: !admin });

  const salvar = () => {
    setErro("");
    if (!form.nome.trim()) { setErro("Informe o nome/identificação da moto."); return; }
    const dados = {
      nome: form.nome.trim().toUpperCase(), placa: form.placa.trim().toUpperCase(), motorista: form.motorista.trim(),
      limitePeriodo: r2(lerValor(form.limitePeriodo)), periodo: form.periodo || "mes", limiteNota: r2(lerValor(form.limiteNota)),
    };
    if (editId) setMotos((prev) => prev.map((m) => (m.id === editId ? { ...m, ...dados } : m)));
    else setMotos((prev) => [...(prev || []), { id: novoId(), ativa: true, ...dados }]);
    setForm(MOTO_VAZIA); setEditId(null);
  };
  const editar = (m) => {
    setEditId(m.id);
    setForm({ nome: m.nome, placa: m.placa || "", motorista: m.motorista || "", limitePeriodo: valorParaInput(m.limitePeriodo), periodo: m.periodo || "mes", limiteNota: valorParaInput(m.limiteNota) });
  };
  const alternar = (m) => setMotos((prev) => prev.map((x) => (x.id === m.id ? { ...x, ativa: x.ativa === false } : x)));
  const excluir = (m) => {
    if (!confirm(`Excluir a moto "${m.nome}"? Os abastecimentos já lançados continuam no relatório.`)) return;
    setMotos((prev) => prev.filter((x) => x.id !== m.id));
  };
  const salvarConfig = () => {
    const pct = Math.min(100, Math.max(1, Math.round(lerValor(avisoPct) || 80)));
    setConfig({ ...cfg, limiteNotaPadrao: r2(lerValor(limNotaPadrao)), avisoPercent: pct });
    setAvisoPct(String(pct));
    alert("✅ Configuração salva.");
  };

  return (
    <div style={{ ...card, borderColor: "#1D4ED8" }}>
      <h2 style={cardTitle}>🏍️ {editId ? "Editando moto" : "Cadastrar moto"}</h2>
      {!admin && <div style={{ ...alertaAviso, marginBottom: 12 }}>Só o administrador pode alterar motos e limites.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        <div style={{ gridColumn: "span 2" }}><label style={labelStyle}>Moto (identificação) *</label><input style={inputStyle} placeholder="Ex: MOTO 01 - CG 160" {...campo("nome")} /></div>
        <div><label style={labelStyle}>Placa</label><input style={inputStyle} placeholder="Opcional" {...campo("placa")} /></div>
        <div>
          <label style={labelStyle}>Motorista</label>
          <input style={inputStyle} list="motoristas-motos" {...campo("motorista")} />
          <datalist id="motoristas-motos">{nomesMotoristas.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <div><label style={labelStyle}>Limite de gasto (R$)</label><input style={inputStyle} inputMode="decimal" placeholder="Ex: 400,00" {...campo("limitePeriodo")} /></div>
        <div>
          <label style={labelStyle}>Período do limite</label>
          <select style={inputStyle} {...campo("periodo")}>
            <option value="mes">Por mês</option><option value="semana">Por semana (seg a dom)</option><option value="dia">Por dia</option>
          </select>
        </div>
        <div><label style={labelStyle}>Limite por nota (R$)</label><input style={inputStyle} inputMode="decimal" placeholder={cfg.limiteNotaPadrao ? `Padrão ${fmt(cfg.limiteNotaPadrao)}` : "Ex: 50,00"} {...campo("limiteNota")} /></div>
      </div>
      {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
      {admin && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button style={{ ...btn, background: "#1D4ED8" }} onClick={salvar}>{editId ? "💾 Salvar moto" : "➕ Cadastrar moto"}</button>
          {editId && <button style={{ ...btn, background: "#374151" }} onClick={() => { setEditId(null); setForm(MOTO_VAZIA); }}>Cancelar</button>}
        </div>
      )}

      {motos.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {motos.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#1E293B", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap", opacity: m.ativa === false ? 0.5 : 1 }}>
              <div>
                <div style={{ fontWeight: 800, color: "#F1F5F9" }}>🏍️ {m.nome}{m.ativa === false && <span style={{ fontSize: 10, color: "#94A3B8" }}> (inativa)</span>}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>
                  {[m.placa, m.motorista, m.limitePeriodo ? `limite ${fmt(m.limitePeriodo)} ${PERIODOS[m.periodo || "mes"]}` : "sem limite de período",
                    limiteNotaDa(m, cfg) ? `nota até ${fmt(limiteNotaDa(m, cfg))}${m.limiteNota ? "" : " (padrão)"}` : "sem limite por nota"].filter(Boolean).join(" · ")}
                </div>
              </div>
              {admin && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => editar(m)} title="Editar">✏️</button>
                  <button style={{ ...miniBtn, background: m.ativa === false ? "#059669" : "#B45309" }} onClick={() => alternar(m)} title={m.ativa === false ? "Reativar" : "Desativar"}>{m.ativa === false ? "♻️" : "💤"}</button>
                  <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(m)} title="Excluir">🗑️</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 20, borderTop: "1px solid #1E293B", paddingTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#F1F5F9", marginBottom: 10 }}>⚙️ Configuração dos alertas</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Limite por nota padrão (R$)</label>
            <input style={inputStyle} inputMode="decimal" placeholder="0,00 = sem limite" value={limNotaPadrao} onChange={(e) => setLimNotaPadrao(e.target.value)} disabled={!admin} />
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Vale para motos sem limite por nota próprio.</div>
          </div>
          <div>
            <label style={labelStyle}>Avisar quando chegar em (%)</label>
            <input style={inputStyle} inputMode="numeric" value={avisoPct} onChange={(e) => setAvisoPct(e.target.value)} disabled={!admin} />
            <div style={{ fontSize: 10, color: "#64748B", marginTop: 4 }}>Ex: 80 = alerta amarelo ao usar 80% do limite.</div>
          </div>
          {admin && <div><button style={{ ...btn, background: "#1D4ED8", width: "100%" }} onClick={salvarConfig}>💾 Salvar configuração</button></div>}
        </div>
      </div>
    </div>
  );
}

function MiniInd({ titulo, valor, cor }) {
  return (
    <div style={{ background: "#1E293B", border: `1px solid ${cor}44`, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontWeight: 900, color: cor, fontSize: 17, marginTop: 2 }}>{valor}</div>
    </div>
  );
}
