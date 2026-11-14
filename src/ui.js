// Estilos e funções pequenas compartilhadas pelas abas novas (mesmo visual do CaixaFácil)

export const fmt = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "1.234,56" / "1234,56" / "1234.56" -> número
export const lerValor = (s) => {
  const t = String(s ?? "").trim();
  if (!t) return 0;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isNaN(n) ? 0 : n;
};
export const valorParaInput = (n) => (Number(n) ? Number(n).toFixed(2).replace(".", ",") : "");

const pad = (n) => String(n).padStart(2, "0");
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hojeISO = () => isoLocal(new Date());
export const dataBR = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
};
export const novoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const normNome = (s) => String(s || "").trim().toLowerCase();

/* Abre uma janela para imprimir/salvar PDF */
export function abrirImpressao(titulo, corpoHtml) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 2px; color: #065f46; }
    .sub { color: #6b7280; font-size: 11px; margin-bottom: 12px; }
    .cards { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .c { border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 10px; min-width: 110px; }
    .c .l { font-size: 9px; color: #6b7280; text-transform: uppercase; }
    .c .v { font-size: 14px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; font-size: 10px; text-transform: uppercase; color: #374151; padding: 6px; border-bottom: 1px solid #d1d5db; }
    td { padding: 5px 6px; border-bottom: 1px solid #eee; }
    .r { text-align: right; } .ctr { text-align: center; }
    .pos { color: #1d4ed8; font-weight: 700; } .neg { color: #b91c1c; font-weight: 700; } .ok { color: #047857; font-weight: 700; }
    .alerta { color: #b91c1c; font-weight: 700; }
    tfoot td { font-weight: 800; border-top: 2px solid #9ca3af; }
    .ass { display: flex; justify-content: space-around; margin-top: 40px; }
    .ass div { width: 200px; border-top: 1px solid #333; text-align: center; padding-top: 4px; font-size: 10px; color: #555; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>${corpoHtml}
  <script>window.onload = () => { window.print(); };<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("O navegador bloqueou a janela de impressão. Libere as janelas pop-up para este site e tente de novo."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 14, padding: 20 };
export const cardTitle = { fontSize: 15, fontWeight: 700, color: "#F1F5F9", marginBottom: 18, marginTop: 0 };
export const labelStyle = { display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 };
export const inputStyle = { width: "100%", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#F1F5F9", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
export const btn = { padding: "10px 20px", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" };
export const miniBtn = { padding: "5px 9px", border: "none", borderRadius: 7, color: "#fff", cursor: "pointer", fontSize: 12 };
export const th = { background: "#1E293B", padding: "11px 12px", fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left", borderBottom: "1px solid #334155", whiteSpace: "nowrap" };
export const td = { padding: "10px 12px", fontSize: 13, color: "#E2E8F0", borderBottom: "1px solid #1E293B", verticalAlign: "top" };
export const alertaErro = { background: "#450a0a", border: "1px solid #EF444455", color: "#FCA5A5", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
export const alertaAviso = { background: "#422006", border: "1px solid #F59E0B66", color: "#FDE68A", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
export const alertaOk = { background: "#052e16", border: "1px solid #10B98155", color: "#6EE7B7", borderRadius: 8, padding: "10px 12px", fontSize: 13 };
