// ══════════════════════════════════════════════════════════════
//  ABA RECIBOS — recibo geral (2 vias por folha A4)
//  - Empresas cadastradas ficam salvas na nuvem (chave "empresas")
//  - Recibos emitidos ficam no histórico (chave "recibos")
// ══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";

const FORMAS_PAGAMENTO = ["Dinheiro", "PIX", "Transferência", "Cheque", "Cartão de Débito", "Cartão de Crédito", "Boleto"];

const fmt = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "1.234,56" / "1234,56" / "1234.56" -> número
const lerValor = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isNaN(n) ? 0 : n;
};

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dataBR = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataExtenso = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : "";
};

/* Valor por extenso (reais e centavos) */
function extenso(valor) {
  const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const ate999 = (n) => {
    if (n === 0) return "";
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100;
    const partes = [];
    if (c) partes.push(C[c]);
    if (r) {
      if (r < 20) partes.push(U[r]);
      else partes.push(D[Math.floor(r / 10)] + (r % 10 ? " e " + U[r % 10] : ""));
    }
    return partes.join(" e ");
  };
  const inteiro = (n) => {
    if (n === 0) return "zero";
    const grupos = [];
    const nomes = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
    let i = 0, x = n;
    while (x > 0) { grupos.push({ v: x % 1000, i }); x = Math.floor(x / 1000); i++; }
    const txt = grupos.filter((g) => g.v > 0).reverse().map((g) => {
      if (g.i === 1 && g.v === 1) return "mil";
      const t = ate999(g.v);
      const nome = nomes[g.i][g.v === 1 ? 0 : 1];
      return nome ? `${t} ${nome}` : t;
    });
    // "e" antes do último grupo quando ele é < 100 ou centena redonda
    const ultimo = grupos[0].v;
    if (txt.length > 1 && ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0)) {
      const fim = txt.pop();
      return txt.join(" ") + " e " + fim;
    }
    return txt.join(" ");
  };
  const v = Math.round((Number(valor) || 0) * 100);
  const reais = Math.floor(v / 100), cent = v % 100;
  const partes = [];
  if (reais > 0) {
    const milhaoRedondo = reais >= 1000000 && reais % 1000000 === 0;
    partes.push(inteiro(reais) + (milhaoRedondo ? " de" : "") + (reais === 1 ? " real" : " reais"));
  }
  if (cent > 0) partes.push(inteiro(cent) + (cent === 1 ? " centavo" : " centavos"));
  if (partes.length === 0) return "zero reais";
  return partes.join(" e ");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Abre a janela de impressão com o recibo (1 via, modelo "Recibo de Pagamento") */
function imprimirRecibo(r) {
  const linha = (icone, rotulo, valor) => valor ? `
      <tr><td class="rot">${icone} ${rotulo}:</td><td class="val">${esc(valor)}</td></tr>` : "";
  const infoEmpresa = [r.empresa.cnpj && "CNPJ: " + r.empresa.cnpj, r.empresa.endereco, r.empresa.telefone && "Tel: " + r.empresa.telefone]
    .filter(Boolean).map(esc).join(" · ");

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo ${String(r.numero).padStart(4, "0")} - ${esc(r.recebidoPor)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; padding: 18mm 20mm; }
    .recibo { max-width: 170mm; margin: 0 auto; }
    .cab { text-align: center; padding-bottom: 12px; border-bottom: 3px solid #059669; }
    .emp { font-size: 24px; font-weight: 800; color: #059669; }
    .emp-info { font-size: 11px; color: #6b7280; margin-top: 3px; }
    .tit { font-size: 16px; color: #4b5563; margin-top: 6px; letter-spacing: .5px; }
    .num { font-size: 12px; color: #9ca3af; margin-top: 2px; }
    .valor { margin: 22px 0 18px; border: 2px solid #059669; border-radius: 12px; background: #ecfdf5; text-align: center; padding: 16px 10px; }
    .valor .rot { font-size: 13px; color: #065f46; }
    .valor .num-valor { font-size: 34px; font-weight: 800; color: #065f46; margin-top: 4px; }
    .valor .ext { font-size: 12px; color: #047857; font-style: italic; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 11px 10px; border-bottom: 1px solid #f0f0f0; font-size: 14px; vertical-align: top; }
    td.rot { color: #4b5563; width: 42%; }
    td.val { font-weight: 700; color: #111827; text-transform: none; }
    .local { text-align: right; font-size: 13px; color: #374151; margin-top: 18px; }
    .ass { display: flex; justify-content: space-between; gap: 30px; margin-top: 60px; }
    .ass div { flex: 1; text-align: center; border-top: 1px solid #6b7280; padding-top: 6px; font-size: 12px; color: #4b5563; }
    .ass b { display: block; font-size: 12px; color: #374151; font-weight: 400; margin-top: 2px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
  <div class="recibo">
    <div class="cab">
      <div class="emp">${esc(r.empresa.nome)}</div>
      ${infoEmpresa ? `<div class="emp-info">${infoEmpresa}</div>` : ""}
      <div class="tit">RECIBO DE PAGAMENTO</div>
      <div class="num">Nº ${String(r.numero).padStart(4, "0")} · ${dataBR(r.data)}</div>
    </div>
    <div class="valor">
      <div class="rot">Valor Recebido</div>
      <div class="num-valor">${fmt(r.valor)}</div>
      <div class="ext">(${esc(extenso(r.valor))})</div>
    </div>
    <table>
      ${linha("📋", "Referente a", r.referente)}
      ${linha("👤", "Recebido por", r.recebidoPor + (r.documentoRecebedor ? " — CPF/CNPJ: " + r.documentoRecebedor : ""))}
      ${linha("🏢", "Pago por", r.pagoPor)}
      ${linha("💳", "Forma de Pagamento", r.forma)}
      ${linha("📅", "Data", dataBR(r.data))}
      ${linha("📝", "Detalhes", r.detalhes)}
    </table>
    ${r.empresa.cidade ? `<div class="local">${esc(r.empresa.cidade)}, ${dataExtenso(r.data)}.</div>` : ""}
    <div class="ass">
      <div>Assinatura de Quem Recebe<b>${esc(r.recebidoPor)}</b></div>
      <div>Assinatura de Quem Paga<b>${esc(r.pagoPor)}</b></div>
    </div>
  </div>
  <script>window.onload = () => { window.print(); };<\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("O navegador bloqueou a janela do recibo. Libere as janelas pop-up para este site e tente de novo."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

const EMPRESA_VAZIA = { nome: "", cnpj: "", endereco: "", cidade: "", telefone: "" };

export default function RecibosTab({ currentUser, empresas, setEmpresas, recibos, setRecibos }) {
  const empresaPadrao = empresas.find((e) => e.padrao) || empresas[0];

  const formVazio = () => ({
    empresaId: empresaPadrao?.id || "",
    referente: "",
    valor: "",
    recebidoPor: "",
    documentoRecebedor: "",
    pagoPor: empresaPadrao?.nome || "",
    forma: "Dinheiro",
    data: hojeISO(),
    detalhes: "",
  });
  const [form, setForm] = useState(formVazio);
  const [erro, setErro] = useState("");
  const [mostrarEmpresas, setMostrarEmpresas] = useState(empresas.length === 0);
  const [busca, setBusca] = useState("");
  const [editId, setEditId] = useState(null);   // recibo sendo editado

  const empresaSel = empresas.find((e) => e.id === form.empresaId) || empresaPadrao;

  // Quando a primeira empresa é cadastrada (ou a escolhida some), preenche o formulário com a padrão
  useEffect(() => {
    if (empresaPadrao && !empresas.some((e) => e.id === form.empresaId)) {
      setForm((f) => ({ ...f, empresaId: empresaPadrao.id, pagoPor: f.pagoPor || empresaPadrao.nome }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaPadrao?.id, empresas.length]);

  const nomesRecebedores = useMemo(
    () => [...new Set(recibos.map((r) => r.recebidoPor).filter(Boolean))].sort(),
    [recibos]
  );

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const trocarEmpresa = (id) => {
    const nova = empresas.find((e) => e.id === id);
    const anterior = empresas.find((e) => e.id === form.empresaId);
    // se "Pago por" ainda era o nome da empresa anterior, acompanha a troca
    const pagoPor = !form.pagoPor || form.pagoPor === anterior?.nome ? nova?.nome || "" : form.pagoPor;
    setForm({ ...form, empresaId: id, pagoPor });
  };

  const gerar = (imprimir = true) => {
    setErro("");
    const valor = lerValor(form.valor);
    if (!empresaSel) { setErro("Cadastre a empresa primeiro (botão 🏢 Empresas)."); setMostrarEmpresas(true); return; }
    if (!form.referente.trim()) { setErro("Preencha o campo 'Referente a'."); return; }
    if (valor <= 0) { setErro("Informe um valor maior que zero."); return; }
    if (!form.recebidoPor.trim()) { setErro("Preencha 'Recebido por' (quem recebe o dinheiro e assina)."); return; }

    const original = editId ? recibos.find((r) => r.id === editId) : null;
    const numero = original ? original.numero : recibos.reduce((m, r) => Math.max(m, r.numero || 0), 0) + 1;
    const recibo = {
      id: original ? original.id : Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      numero,
      empresa: { nome: empresaSel.nome, cnpj: empresaSel.cnpj, endereco: empresaSel.endereco, cidade: empresaSel.cidade, telefone: empresaSel.telefone },
      referente: form.referente.trim(),
      valor,
      recebidoPor: form.recebidoPor.trim(),
      documentoRecebedor: form.documentoRecebedor.trim(),
      pagoPor: (form.pagoPor || empresaSel.nome).trim(),
      forma: form.forma,
      data: form.data || hojeISO(),
      detalhes: form.detalhes.trim(),
      criadoPor: original ? original.criadoPor : currentUser?.nome || "",
      criadoEm: original ? original.criadoEm : new Date().toISOString(),
      ...(original ? { editadoPor: currentUser?.nome || "", editadoEm: new Date().toISOString() } : {}),
    };
    if (original) setRecibos((prev) => prev.map((r) => (r.id === original.id ? recibo : r)));
    else setRecibos((prev) => [recibo, ...(prev || [])]);
    if (imprimir) imprimirRecibo(recibo);
    setEditId(null);
    setForm({ ...formVazio(), empresaId: form.empresaId, pagoPor: empresaSel.nome });
  };

  const editar = (r) => {
    const emp = empresas.find((e) => e.nome === r.empresa?.nome) || empresaPadrao;
    setEditId(r.id);
    setErro("");
    setForm({
      empresaId: emp?.id || "",
      referente: r.referente || "",
      valor: Number(r.valor || 0).toFixed(2).replace(".", ","),
      recebidoPor: r.recebidoPor || "",
      documentoRecebedor: r.documentoRecebedor || "",
      pagoPor: r.pagoPor || "",
      forma: r.forma || "Dinheiro",
      data: r.data || hojeISO(),
      detalhes: r.detalhes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelarEdicao = () => {
    setEditId(null);
    setErro("");
    setForm(formVazio());
  };

  const excluir = (r) => {
    if (!currentUser?.admin) { alert("Só administrador pode excluir recibos."); return; }
    if (!confirm(`Excluir o recibo Nº ${r.numero} (${r.recebidoPor} — ${fmt(r.valor)})?`)) return;
    setRecibos((prev) => prev.filter((x) => x.id !== r.id));
    if (editId === r.id) cancelarEdicao();
  };

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return recibos;
    return recibos.filter((r) =>
      [r.recebidoPor, r.referente, r.pagoPor, r.empresa?.nome, String(r.numero)].some((x) => String(x || "").toLowerCase().includes(b))
    );
  }, [recibos, busca]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* EMPRESAS */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button style={{ ...btn, background: mostrarEmpresas ? "#374151" : "#1D4ED8" }} onClick={() => setMostrarEmpresas(!mostrarEmpresas)}>
          🏢 Empresas cadastradas ({empresas.length}) {mostrarEmpresas ? "▲" : "▼"}
        </button>
      </div>
      {mostrarEmpresas && <EmpresasCard empresas={empresas} setEmpresas={setEmpresas} />}

      {/* NOVO RECIBO */}
      <div style={{ ...card, borderColor: editId ? "#3B82F6" : "#1E293B" }}>
        <h2 style={cardTitle}>
          {editId ? `✏️ Editando recibo Nº ${String(recibos.find((r) => r.id === editId)?.numero || "").padStart(4, "0")}` : "🧾 Novo Recibo"}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Empresa</label>
            {empresas.length === 0 ? (
              <div style={{ ...aviso }}>Nenhuma empresa cadastrada. Clique em <b>🏢 Empresas cadastradas</b> e cadastre a sua — ela vai aparecer aqui automaticamente.</div>
            ) : (
              <select style={inputStyle} value={empresaSel?.id || ""} onChange={(e) => trocarEmpresa(e.target.value)}>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.padrao ? "⭐ " : ""}{e.nome}</option>)}
              </select>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Referente a (descrição) *</label>
            <input style={inputStyle} placeholder="Ex: Pagamento de serviços, Aluguel..." {...campo("referente")} />
          </div>
          <div>
            <label style={labelStyle}>Valor (R$) *</label>
            <input style={{ ...inputStyle, fontSize: 18, fontWeight: 800 }} inputMode="decimal" placeholder="0,00" {...campo("valor")} />
            {lerValor(form.valor) > 0 && <div style={{ fontSize: 11, color: "#6EE7B7", marginTop: 4 }}>{extenso(lerValor(form.valor))}</div>}
          </div>
          <div>
            <label style={labelStyle}>Data</label>
            <input style={inputStyle} type="date" {...campo("data")} />
          </div>
          <div>
            <label style={labelStyle}>Recebido por * (quem assina)</label>
            <input style={inputStyle} list="recebedores" placeholder="Nome de quem recebe" {...campo("recebidoPor")} />
            <datalist id="recebedores">{nomesRecebedores.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div>
            <label style={labelStyle}>CPF/CNPJ de quem recebe</label>
            <input style={inputStyle} placeholder="Opcional" {...campo("documentoRecebedor")} />
          </div>
          <div>
            <label style={labelStyle}>Pago por</label>
            <input style={inputStyle} {...campo("pagoPor")} />
          </div>
          <div>
            <label style={labelStyle}>Forma de pagamento</label>
            <select style={inputStyle} {...campo("forma")}>
              {FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Detalhes adicionais</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} placeholder="Informações extras para o recibo..." {...campo("detalhes")} />
          </div>
        </div>
        {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
        {editId ? (
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#059669", flex: 2, fontSize: 15, padding: "13px 20px" }} onClick={() => gerar(true)}>💾 Salvar e Imprimir</button>
            <button style={{ ...btn, background: "#2563EB", flex: 1, fontSize: 15, padding: "13px 20px" }} onClick={() => gerar(false)}>💾 Só Salvar</button>
            <button style={{ ...btn, background: "#374151", flex: 1, fontSize: 15, padding: "13px 20px" }} onClick={cancelarEdicao}>Cancelar</button>
          </div>
        ) : (
          <button style={{ ...btn, background: "#059669", width: "100%", marginTop: 14, fontSize: 15, padding: "13px 20px" }} onClick={() => gerar(true)}>
            🧾 Gerar e Imprimir Recibo
          </button>
        )}
      </div>

      {/* HISTÓRICO */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <h2 style={{ ...cardTitle, marginBottom: 0 }}>📚 Recibos emitidos ({recibos.length})</h2>
          <input style={{ ...inputStyle, width: 240, padding: "7px 10px" }} placeholder="🔍 Buscar nome, referente, nº" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {filtrados.length === 0 ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 20 }}>{recibos.length === 0 ? "Nenhum recibo emitido ainda." : "Nenhum recibo encontrado."}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={th}>Nº</th>
                  <th style={th}>Data</th>
                  <th style={th}>Recebido por</th>
                  <th style={th}>Referente a</th>
                  <th style={{ ...th, textAlign: "right" }}>Valor</th>
                  <th style={{ ...th, textAlign: "center" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, 200).map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? "#0F172A" : "#0D1527" }}>
                    <td style={{ ...td, color: "#94A3B8" }}>{String(r.numero).padStart(4, "0")}</td>
                    <td style={td}>{dataBR(r.data)}</td>
                    <td style={{ ...td, fontWeight: 700, color: "#F1F5F9" }}>
                      {r.recebidoPor}
                      <div style={{ fontSize: 10, color: "#64748B", fontWeight: 400 }}>{r.empresa?.nome}{r.criadoPor ? ` · por ${r.criadoPor}` : ""}{r.editadoPor ? ` · editado por ${r.editadoPor}` : ""}</div>
                    </td>
                    <td style={td}>{r.referente}<div style={{ fontSize: 10, color: "#64748B" }}>{r.forma}</div></td>
                    <td style={{ ...td, textAlign: "right", color: "#10B981", fontWeight: 800 }}>{fmt(r.valor)}</td>
                    <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => imprimirRecibo(r)} title="Reimprimir">🖨️</button>{" "}
                      <button style={{ ...miniBtn, background: "#B45309" }} onClick={() => editar(r)} title="Editar">✏️</button>{" "}
                      {currentUser?.admin && <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(r)} title="Excluir">🗑️</button>}
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

/* ══════ CADASTRO DE EMPRESAS ══════ */
function EmpresasCard({ empresas, setEmpresas }) {
  const [form, setForm] = useState(EMPRESA_VAZIA);
  const [editId, setEditId] = useState(null);
  const [erro, setErro] = useState("");

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  const salvar = () => {
    setErro("");
    if (!form.nome.trim()) { setErro("Informe o nome da empresa."); return; }
    const dados = {
      nome: form.nome.trim(), cnpj: form.cnpj.trim(), endereco: form.endereco.trim(),
      cidade: form.cidade.trim(), telefone: form.telefone.trim(),
    };
    if (editId) {
      setEmpresas((prev) => prev.map((e) => (e.id === editId ? { ...e, ...dados } : e)));
    } else {
      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      setEmpresas((prev) => [...(prev || []), { id, ...dados, padrao: (prev || []).length === 0 }]);
    }
    setForm(EMPRESA_VAZIA); setEditId(null);
  };

  const editar = (e) => { setEditId(e.id); setForm({ ...EMPRESA_VAZIA, ...e }); };
  const tornarPadrao = (id) => setEmpresas((prev) => prev.map((e) => ({ ...e, padrao: e.id === id })));
  const excluir = (e) => {
    if (!confirm(`Excluir a empresa "${e.nome}"? (Os recibos já emitidos não mudam.)`)) return;
    setEmpresas((prev) => {
      const resto = prev.filter((x) => x.id !== e.id);
      if (e.padrao && resto.length > 0) resto[0] = { ...resto[0], padrao: true };
      return resto;
    });
  };

  return (
    <div style={{ ...card, borderColor: "#1D4ED8" }}>
      <h2 style={cardTitle}>🏢 {editId ? "Editando empresa" : "Cadastrar empresa"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Nome da empresa *</label>
          <input style={inputStyle} placeholder="Ex: GP LIQUIGAS LTDA" {...campo("nome")} />
        </div>
        <div><label style={labelStyle}>CNPJ</label><input style={inputStyle} placeholder="00.000.000/0000-00" {...campo("cnpj")} /></div>
        <div><label style={labelStyle}>Telefone</label><input style={inputStyle} {...campo("telefone")} /></div>
        <div><label style={labelStyle}>Cidade (sai na data do recibo)</label><input style={inputStyle} placeholder="Ex: Araripina-PE" {...campo("cidade")} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={labelStyle}>Endereço</label><input style={inputStyle} {...campo("endereco")} /></div>
      </div>
      {erro && <div style={{ ...alertaErro, marginTop: 12 }}>⚠️ {erro}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={{ ...btn, background: "#1D4ED8" }} onClick={salvar}>{editId ? "💾 Salvar alterações" : "➕ Cadastrar empresa"}</button>
        {editId && <button style={{ ...btn, background: "#374151" }} onClick={() => { setEditId(null); setForm(EMPRESA_VAZIA); }}>Cancelar</button>}
      </div>

      {empresas.length > 0 && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {empresas.map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#1E293B", border: `1px solid ${e.padrao ? "#F59E0B88" : "#334155"}`, borderRadius: 10, padding: "10px 14px", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, color: "#F1F5F9" }}>{e.padrao && "⭐ "}{e.nome}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{[e.cnpj && "CNPJ " + e.cnpj, e.cidade, e.telefone].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!e.padrao && <button style={{ ...miniBtn, background: "#B45309" }} onClick={() => tornarPadrao(e.id)} title="Usar como padrão">⭐ Padrão</button>}
                <button style={{ ...miniBtn, background: "#2563EB" }} onClick={() => editar(e)} title="Editar">✏️</button>
                <button style={{ ...miniBtn, background: "#7F1D1D" }} onClick={() => excluir(e)} title="Excluir">🗑️</button>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#64748B" }}>⭐ A empresa padrão já vem preenchida em todo recibo novo.</div>
        </div>
      )}
    </div>
  );
}

/* ══════ ESTILOS (mesmo visual do CaixaFácil) ══════ */
const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
const cardTitle = { fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 18, marginTop: 0 };
const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 };
const inputStyle = { width: "100%", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#F1F5F9", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
const btn = { padding: "10px 20px", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const miniBtn = { padding: "5px 9px", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", fontSize: 12 };
const th = { background: "#1E293B", padding: "11px 12px", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", borderBottom: "1px solid #334155" };
const td = { padding: "10px 12px", fontSize: 13, color: "#E2E8F0", borderBottom: "1px solid #1E293B", verticalAlign: "top" };
const alertaErro = { background: "#450a0a", border: "1px solid #EF444455", color: "#FCA5A5", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
const aviso = { background: "#422006", border: "1px solid #F59E0B55", color: "#FDE68A", borderRadius: 8, padding: "10px 12px", fontSize: 13 };

export { extenso };
