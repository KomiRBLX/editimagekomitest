/* =====================================================================
   PRESETS — valores iniciais. Para criar mais um, basta adicionar um objeto.
   Cada preset tem a sua própria imagem (escolhida no painel e salva no navegador).
   Ajustes feitos no painel também ficam salvos; "Restaurar padrão" volta ao que está aqui.

   modo:     "logo"    → imagem com largura proporcional à foto, ancorada na borda
             "cobrir"  → preenche a foto inteira mantendo proporção (corta o excesso)
             "esticar" → preenche a foto inteira deformando, se preciso
   tamanho:  largura da imagem em % da largura da foto (só no modo "logo")
   ancoraH:  "direita" | "centro" | "esquerda"
   ancoraV:  "baixo" | "centro" | "topo"
   margemH / margemV: distância da borda ancorada, em % da LARGURA da foto
                      (assim o encaixe é igual em fotos de qualquer tamanho)
   opacidade: 0–100
   ===================================================================== */
const PRESETS = [
  { nome: "Preset 1", modo: "logo",   tamanho: 20,  ancoraH: "direita",  ancoraV: "baixo",  margemH: 2, margemV: 2, opacidade: 100 },
  { nome: "Preset 2", modo: "logo",   tamanho: 15,  ancoraH: "esquerda", ancoraV: "topo",   margemH: 2, margemV: 2, opacidade: 100 },
  { nome: "Preset 3", modo: "logo",   tamanho: 40,  ancoraH: "centro",   ancoraV: "centro", margemH: 0, margemV: 0, opacidade: 30 },
  { nome: "Preset 4", modo: "cobrir", tamanho: 100, ancoraH: "centro",   ancoraV: "centro", margemH: 0, margemV: 0, opacidade: 100 },
];
const SUFIXO_ARQUIVO = "-editada";
const CHAVE_STORAGE = "editorSobreposicao.cfg.v1";
const ATRASO_RERENDER = 350;               // ms de espera após mexer no painel
const CAMPOS = ["modo", "tamanho", "ancoraH", "ancoraV", "margemH", "margemV", "opacidade"];
/* ===================================================================== */

const $ = id => document.getElementById(id);
const entrada = $("entrada"), ovEntrada = $("ovEntrada"), zona = $("zona"), grade = $("grade");
const btnZip = $("btnZip"), btnLimpar = $("btnLimpar"), btnRemoverOv = $("btnRemoverOv");
const msg = $("msg"), ovPrev = $("ovPrev"), ovInfo = $("ovInfo");
const opcoesLogo = $("opcoesLogo"), botoesPreset = $("presets");

let presets = PRESETS.map(p => ({ ...p }));
let ativo = 0;
const overlays = [];         // overlays[i] = Image do preset i
const ovBlobs = [];          // ovBlobs[i] = arquivo original do preset i
const itens = [];            // { file, nome, preset (null = usa o ativo), blob, url, img, card }
const nomesUsados = new Set();
let token = 0;               // invalida renderizações antigas
let timer = null;
let prevUrl = null;

function mostrar(texto, tipo = "") {
  msg.textContent = texto;
  msg.className = tipo;
}

/* ---------- Armazenamento das imagens dos presets (IndexedDB) ---------- */
const dbp = new Promise((res, rej) => {
  try {
    const r = indexedDB.open("editorSobreposicao", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("ov");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  } catch (e) { rej(e); }
});
dbp.catch(() => {});
const idb = (modo, fn) => dbp.then(db => new Promise((res, rej) => {
  const t = db.transaction("ov", modo);
  const rq = fn(t.objectStore("ov"));
  t.oncomplete = () => res(rq.result);
  t.onerror = () => rej(t.error);
}));

/* ---------- Configuração (localStorage) ---------- */
function salvarConfig() {
  try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify({ ativo, presets })); } catch {}
}

function carregarConfig() {
  let salvo = {};
  try { salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE)) || {}; } catch {}
  const lista = Array.isArray(salvo.presets) ? salvo.presets : [];
  presets = PRESETS.map((p, i) => ({ ...p, ...lista[i], nome: p.nome }));
  ativo = Math.min(Math.max(salvo.ativo | 0, 0), PRESETS.length - 1);
}

function agendar() {
  salvarConfig();
  clearTimeout(timer);
  timer = setTimeout(renderizarTodos, ATRASO_RERENDER);
}

/* ---------- Painel ---------- */
function ler(id) {
  const el = $(id);
  return el.type === "range" ? parseFloat(el.value) : el.value;
}

function atualizarSaida(el) {
  if (el.type !== "range") return;
  const saida = el.closest("label").querySelector("output");
  if (saida) saida.textContent = `${el.value} ${el.dataset.un || ""}`;
}

function mostrarPreset() {
  const p = presets[ativo];
  for (const k of CAMPOS) {
    const el = $(k);
    el.value = p[k];
    atualizarSaida(el);
  }
  opcoesLogo.classList.toggle("oculto", p.modo !== "logo");
  [...botoesPreset.children].forEach((b, i) => b.classList.toggle("ativo", i === ativo));

  if (prevUrl) URL.revokeObjectURL(prevUrl);
  prevUrl = ovBlobs[ativo] ? URL.createObjectURL(ovBlobs[ativo]) : null;
  if (prevUrl) ovPrev.src = prevUrl; else ovPrev.removeAttribute("src");
  ovPrev.classList.toggle("on", !!prevUrl);

  const ov = overlays[ativo];
  ovInfo.textContent = ov
    ? `${ovBlobs[ativo].name || "imagem salva"} — ${ov.naturalWidth}×${ov.naturalHeight}`
    : "Nenhuma imagem neste preset.";
  btnRemoverOv.disabled = !ov;
}

function montarBotoesPreset() {
  PRESETS.forEach((p, i) => {
    const b = document.createElement("button");
    b.textContent = p.nome;
    b.onclick = () => { ativo = i; mostrarPreset(); agendar(); };
    botoesPreset.appendChild(b);
  });
}

/* ---------- Desenho ---------- */
function desenharOverlay(ctx, w, h, p, ov) {
  const ow = ov.naturalWidth, oh = ov.naturalHeight;
  ctx.globalAlpha = p.opacidade / 100;
  ctx.imageSmoothingQuality = "high";

  if (p.modo === "esticar") {
    ctx.drawImage(ov, 0, 0, w, h);
  } else if (p.modo === "cobrir") {
    const s = Math.max(w / ow, h / oh);
    const dw = ow * s, dh = oh * s;
    ctx.drawImage(ov, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else {
    // Tamanho e distâncias proporcionais à largura da foto, medidos a partir da borda ancorada
    const dw = w * p.tamanho / 100, dh = dw * oh / ow;
    const mH = w * p.margemH / 100, mV = w * p.margemV / 100;
    const x = p.ancoraH === "direita" ? w - mH - dw : p.ancoraH === "esquerda" ? mH : (w - dw) / 2;
    const y = p.ancoraV === "baixo" ? h - mV - dh : p.ancoraV === "topo" ? mV : (h - dh) / 2;
    ctx.drawImage(ov, x, y, dw, dh);
  }
  ctx.globalAlpha = 1;
}

function carregarImagem(arquivo) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("imagem inválida")); };
    img.src = url;
  });
}

// Gera o PNG final na resolução original da foto
async function renderizar(arquivo, p, ov) {
  const img = await carregarImagem(arquivo);
  const canvas = document.createElement("canvas");
  const w = canvas.width = img.naturalWidth;
  const h = canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  if (ov) desenharOverlay(ctx, w, h, p, ov);
  return new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error("falha ao gerar PNG")), "image/png"));
}

/* ---------- Itens e cards ---------- */
function nomeUnico(base) {
  let nome = `${base}${SUFIXO_ARQUIVO}.png`, n = 2;
  while (nomesUsados.has(nome)) nome = `${base}${SUFIXO_ARQUIVO}-${n++}.png`;
  nomesUsados.add(nome);
  return nome;
}

function baixarBlob(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copiarBlob(blob) {
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error("navegador sem suporte à cópia de imagem");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    mostrar("Imagem copiada para a área de transferência!", "ok");
  } catch (e) {
    mostrar("Não foi possível copiar: " + e.message + ". Use o botão Baixar.", "erro");
  }
}

function criarCard(item) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<img alt=""><div class="nome"></div><select></select>
    <div class="botoes">
      <button class="mini">Copiar</button>
      <button class="mini sec">Baixar PNG</button>
    </div>`;
  item.card = card;
  item.img = card.querySelector("img");
  const nome = card.querySelector(".nome");
  nome.textContent = nome.title = item.nome;

  const sel = card.querySelector("select");
  sel.innerHTML = `<option value="">Preset ativo</option>` +
    PRESETS.map((p, i) => `<option value="${i}">${p.nome}</option>`).join("");
  sel.onchange = () => { item.preset = sel.value === "" ? null : Number(sel.value); renderizarTodos(); };

  const [bCopiar, bBaixar] = card.querySelectorAll("button");
  bCopiar.onclick = () => item.blob && copiarBlob(item.blob);
  bBaixar.onclick = () => item.blob && baixarBlob(item.blob, item.nome);
  grade.appendChild(card);
}

function removerItem(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.card.remove();
  nomesUsados.delete(item.nome);
  itens.splice(itens.indexOf(item), 1);
}

// Renderiza todas as fotos em sequência; uma nova chamada cancela a anterior
async function renderizarTodos() {
  if (!itens.length) return;
  const meu = ++token;
  await pronto;
  if (meu !== token) return;
  btnZip.disabled = true;
  const semImagem = new Set();
  const total = itens.length;
  let n = 0, falhas = 0;

  for (const item of [...itens]) {
    if (meu !== token) return;
    mostrar(`Processando ${++n} de ${total}...`);
    const i = item.preset ?? ativo;
    if (!overlays[i]) semImagem.add(presets[i].nome);
    try {
      const blob = await renderizar(item.file, presets[i], overlays[i]);
      if (meu !== token) return;
      if (item.url) URL.revokeObjectURL(item.url);
      item.blob = blob;
      item.url = URL.createObjectURL(blob);
      item.img.src = item.url;
    } catch {
      removerItem(item);
      falhas++;
    }
    await new Promise(r => setTimeout(r)); // libera a interface entre fotos
  }

  if (meu !== token) return;
  btnZip.disabled = btnLimpar.disabled = !itens.length;
  let texto = `${itens.length} imagem(ns) pronta(s).`;
  if (semImagem.size) texto += ` Sem imagem em: ${[...semImagem].join(", ")}.`;
  if (falhas) texto += ` ${falhas} falha(s) ao ler.`;
  mostrar(texto, semImagem.size || falhas ? "erro" : "ok");
}

function adicionar(lista) {
  const arquivos = [...lista];
  const fotos = arquivos.filter(f => f.type.startsWith("image/"));
  const ignorados = arquivos.length - fotos.length;
  if (!fotos.length) { mostrar("Nenhum arquivo de imagem válido.", "erro"); return; }

  for (const file of fotos) {
    const item = { file, nome: nomeUnico(file.name.replace(/\.[^.]+$/, "") || "imagem"), preset: null, blob: null, url: null };
    itens.push(item);
    criarCard(item);
  }
  btnLimpar.disabled = false;
  renderizarTodos().then(() => {
    if (ignorados) mostrar(msg.textContent + ` ${ignorados} arquivo(s) ignorado(s) (não são imagens).`, "erro");
  });
}

/* ---------- ZIP (sem bibliotecas, método "store" sem compressão) ---------- */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function criarZip(lista) {
  const enc = new TextEncoder();
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const locais = [], centrais = [];
  let offset = 0, tamCentral = 0;

  for (const { nome, blob } of lista) {
    const dados = new Uint8Array(await blob.arrayBuffer());
    const nomeB = enc.encode(nome);
    const crc = crc32(dados);

    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);            // nomes em UTF-8
    l.setUint16(10, hora, true);
    l.setUint16(12, data, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, dados.length, true);
    l.setUint32(22, dados.length, true);
    l.setUint16(26, nomeB.length, true);
    locais.push(l, nomeB, dados);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, data, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nomeB.length, true);
    c.setUint32(42, offset, true);
    centrais.push(c, nomeB);

    offset += 30 + nomeB.length + dados.length;
    tamCentral += 46 + nomeB.length;
  }

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, lista.length, true);
  fim.setUint16(10, lista.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, offset, true);

  return new Blob([...locais, ...centrais, fim], { type: "application/zip" });
}

/* ---------- Eventos ---------- */
for (const k of CAMPOS) {
  const el = $(k);
  el.addEventListener("input", () => {
    presets[ativo][k] = ler(k);
    atualizarSaida(el);
    opcoesLogo.classList.toggle("oculto", presets[ativo].modo !== "logo");
    agendar();
  });
}

$("btnPadrao").addEventListener("click", () => {
  Object.assign(presets[ativo], PRESETS[ativo]);
  mostrarPreset();
  agendar();
});

ovEntrada.addEventListener("change", async () => {
  const f = ovEntrada.files[0];
  ovEntrada.value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) { mostrar("O arquivo do preset não é uma imagem.", "erro"); return; }
  try {
    overlays[ativo] = await carregarImagem(f);
    ovBlobs[ativo] = f;
    idb("readwrite", s => s.put(f, "ov" + ativo)).catch(() => {});
    mostrarPreset();
    agendar();
  } catch {
    mostrar("Não foi possível ler a imagem do preset.", "erro");
  }
});

btnRemoverOv.addEventListener("click", () => {
  delete overlays[ativo];
  delete ovBlobs[ativo];
  idb("readwrite", s => s.delete("ov" + ativo)).catch(() => {});
  mostrarPreset();
  agendar();
});

btnZip.addEventListener("click", async () => {
  try {
    btnZip.disabled = true;
    mostrar("Gerando ZIP...");
    const zip = await criarZip(itens.filter(i => i.blob));
    baixarBlob(zip, "imagens-editadas.zip");
    mostrar(`ZIP com ${itens.length} imagem(ns) gerado.`, "ok");
  } catch (e) {
    mostrar("Erro ao gerar o ZIP: " + e.message, "erro");
  } finally {
    btnZip.disabled = !itens.length;
  }
});

btnLimpar.addEventListener("click", () => {
  token++;
  [...itens].forEach(removerItem);
  btnZip.disabled = btnLimpar.disabled = true;
  mostrar("");
});

entrada.addEventListener("change", () => {
  adicionar(entrada.files);
  entrada.value = "";
});

// Arrastar e soltar fotos (em toda a página)
["dragenter", "dragover"].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("sobre"); }));
["dragleave", "drop"].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("sobre"); }));
window.addEventListener("drop", e => adicionar(e.dataTransfer.files));

/* ---------- Início ---------- */
carregarConfig();
montarBotoesPreset();
mostrarPreset();

// Recupera as imagens dos presets salvas no navegador
const pronto = (async () => {
  for (let i = 0; i < presets.length; i++) {
    try {
      const b = await idb("readonly", s => s.get("ov" + i));
      if (b) { overlays[i] = await carregarImagem(b); ovBlobs[i] = b; }
    } catch {}
  }
  mostrarPreset();
})();
