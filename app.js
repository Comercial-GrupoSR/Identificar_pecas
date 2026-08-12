// ===== Configuração =====
// URL fixa do Apps Script (App da Web) ligado à sua planilha.
// Se um dia trocar de planilha, basta atualizar essa linha e publicar de novo.
const API_URL = 'https://script.google.com/macros/s/AKfycbyXIYGd3D5-EODFc9Jm9R_egQS76EIT89SiK0KFpSVSKsNRsojOzCKuVPwOVCivvABY/exec';

const elStatus = document.getElementById('statusLine');
const elResult = document.getElementById('resultArea');
const form = document.getElementById('formBusca');
const input = document.getElementById('inputCodigo');
const btnBuscar = document.getElementById('btnBuscar');
const tabCodigo = document.getElementById('tabCodigo');
const tabRamal = document.getElementById('tabRamal');
const ramaisList = document.getElementById('ramaisList');
const syncStatusText = document.getElementById('syncStatusText');
const btnSincronizar = document.getElementById('btnSincronizar');

const DADOS_KEY = 'obra_dados_locais_v1';
const FILA_KEY = 'obra_fila_pendente_v1';

let modo = 'codigo'; // 'codigo' | 'ramal'
let ultimosItens = [];
let ultimoTermo = '';
let filtroAtual = 'todos'; // 'todos' | 'Separado' | 'Não encontrada' | 'pendente'

function setStatus(msg, isErr) {
  elStatus.textContent = msg || '';
  elStatus.className = 'status-line' + (isErr ? ' err' : '');
}

// ===== Armazenamento local (offline) =====
function salvarDadosLocais(itens) {
  localStorage.setItem(DADOS_KEY, JSON.stringify({ itens: itens, atualizadoEm: Date.now() }));
}
function carregarDadosLocais() {
  try {
    const raw = localStorage.getItem(DADOS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function carregarFila() {
  try {
    const raw = localStorage.getItem(FILA_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function salvarFila(fila) {
  localStorage.setItem(FILA_KEY, JSON.stringify(fila));
}
function adicionarNaFila(linha, situacao) {
  const fila = carregarFila();
  fila[linha] = situacao;
  salvarFila(fila);
  atualizarBarraSync();
}

// ===== Baixar planilha inteira (precisa de internet) =====
async function baixarDadosCompletos(silencioso) {
  if (!navigator.onLine) {
    if (!silencioso) setStatus('Sem internet no momento — não é possível sincronizar agora.', true);
    return false;
  }
  try {
    if (!silencioso) setStatus('Baixando dados da planilha...');
    const res = await fetch(`${API_URL}?action=listarTudo`);
    const data = await res.json();
    if (data.ok) {
      salvarDadosLocais(data.itens);
      if (!silencioso) setStatus('Dados atualizados no aparelho.');
      atualizarBarraSync();
      return true;
    }
    if (!silencioso) setStatus(data.erro || 'Falha ao sincronizar.', true);
  } catch (err) {
    console.error(err);
    if (!silencioso) setStatus('Falha ao sincronizar. Verifique sua internet.', true);
  }
  return false;
}

// ===== Enviar marcações pendentes para a planilha =====
async function sincronizarFila(silencioso) {
  if (!navigator.onLine) return;
  const fila = carregarFila();
  const linhas = Object.keys(fila);
  if (linhas.length === 0) return;

  for (const linha of linhas) {
    try {
      const situacao = fila[linha];
      const res = await fetch(`${API_URL}?action=atualizar&linha=${encodeURIComponent(linha)}&situacao=${encodeURIComponent(situacao)}`);
      const data = await res.json();
      if (data.ok) {
        delete fila[linha];
        salvarFila(fila);
      }
    } catch (err) {
      console.error(err);
      break; // sem internet de novo, tenta o resto depois
    }
  }
  atualizarBarraSync();
}

// ===== Barra de status de sincronização =====
function atualizarBarraSync() {
  const fila = carregarFila();
  const pendentes = Object.keys(fila).length;
  const dados = carregarDadosLocais();

  if (!navigator.onLine) {
    syncStatusText.textContent = pendentes > 0
      ? `⚠ Sem internet · ${pendentes} pendente(s)`
      : '⚠ Sem internet · usando dados salvos';
    syncStatusText.className = 'offline';
    return;
  }

  if (pendentes > 0) {
    syncStatusText.textContent = `${pendentes} marcação(ões) aguardando envio…`;
    syncStatusText.className = 'pending';
    return;
  }

  if (dados && dados.atualizadoEm) {
    const min = Math.round((Date.now() - dados.atualizadoEm) / 60000);
    const quando = min < 1 ? 'agora mesmo' : min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)}h`;
    syncStatusText.textContent = `Sincronizado ${quando}`;
  } else {
    syncStatusText.textContent = 'Ainda não sincronizado';
  }
  syncStatusText.className = '';
}

btnSincronizar.addEventListener('click', async () => {
  btnSincronizar.disabled = true;
  await sincronizarFila(true);
  await baixarDadosCompletos(false);
  btnSincronizar.disabled = false;
});

window.addEventListener('online', () => {
  atualizarBarraSync();
  sincronizarFila(true).then(() => baixarDadosCompletos(true));
});
window.addEventListener('offline', atualizarBarraSync);

// ===== Alternar modo de busca =====
function setModo(novoModo) {
  modo = novoModo;
  elResult.innerHTML = '';
  setStatus('');
  input.value = '';

  if (modo === 'codigo') {
    tabCodigo.classList.add('active');
    tabRamal.classList.remove('active');
    input.placeholder = 'Digite o código da peça…';
    input.setAttribute('inputmode', 'numeric');
    input.removeAttribute('list');
  } else {
    tabRamal.classList.add('active');
    tabCodigo.classList.remove('active');
    input.placeholder = 'Digite ou escolha o ramal…';
    input.setAttribute('inputmode', 'text');
    input.setAttribute('list', 'ramaisList');
    preencherListaRamais();
  }
  input.focus();
}

tabCodigo.addEventListener('click', () => setModo('codigo'));
tabRamal.addEventListener('click', () => setModo('ramal'));

function preencherListaRamais() {
  const dados = carregarDadosLocais();
  if (!dados) return;
  const vistos = {};
  const lista = [];
  dados.itens.forEach((it) => {
    const l = String(it.local || '').trim();
    if (l && !vistos[l]) { vistos[l] = true; lista.push(l); }
  });
  lista.sort();
  ramaisList.innerHTML = lista.map((r) => `<option value="${escapeHtml(r)}">`).join('');
}

// ===== Busca =====
form.addEventListener('submit', (e) => {
  e.preventDefault();
  buscar();
});

async function buscar() {
  const termo = input.value.trim();
  if (!termo) return;

  let dados = carregarDadosLocais();
  if (!dados) {
    setStatus('Baixando dados da planilha pela primeira vez...');
    const ok = await baixarDadosCompletos(true);
    if (!ok) {
      setStatus('Sem dados salvos no aparelho ainda. Conecte à internet uma vez para sincronizar.', true);
      return;
    }
    dados = carregarDadosLocais();
  }

  const termoNorm = termo.trim().toLowerCase();
  const itens = dados.itens.filter((it) => {
    return modo === 'ramal'
      ? String(it.local || '').trim().toLowerCase() === termoNorm
      : String(it.codigo || '').trim() === termo.trim();
  });

  renderResultados(termo, itens);
  setStatus('');
}

function renderResultados(termo, itens) {
  ultimosItens = itens;
  ultimoTermo = termo;
  filtroAtual = 'todos';

  if (itens.length === 0) {
    const rotulo = modo === 'ramal' ? 'ramal' : 'código';
    elResult.innerHTML = `<div class="empty">Nada encontrado para o ${rotulo} <strong>${escapeHtml(termo)}</strong>.</div>`;
    return;
  }

  renderTudo();
}

function contarPorSituacao(itens) {
  const c = { todos: itens.length, Separado: 0, 'Não encontrada': 0, pendente: 0 };
  itens.forEach((it) => {
    const s = (it.situacao || '').trim();
    if (s === 'Separado') c.Separado++;
    else if (s === 'Não encontrada') c['Não encontrada']++;
    else c.pendente++;
  });
  return c;
}

function itensFiltrados() {
  if (filtroAtual === 'todos') return ultimosItens;
  if (filtroAtual === 'pendente') return ultimosItens.filter((it) => !(it.situacao || '').trim());
  return ultimosItens.filter((it) => (it.situacao || '').trim() === filtroAtual);
}

function renderTudo() {
  const totalQtde = ultimosItens.reduce((acc, it) => acc + (parseFloat(it.qtde) || 0), 0);
  const resumo = modo === 'ramal'
    ? `${escapeHtml(ultimoTermo)} · ${ultimosItens.length} peça(s) · ${totalQtde} unidade(s) no total`
    : `${ultimosItens.length} local(is) · ${totalQtde} peça(s) no total`;

  const c = contarPorSituacao(ultimosItens);
  const chips = [
    { key: 'todos', label: `Todos (${c.todos})`, cls: '' },
    { key: 'Separado', label: `Separado (${c.Separado})`, cls: 'f-ok' },
    { key: 'Não encontrada', label: `Não encontrada (${c['Não encontrada']})`, cls: 'f-bad' },
    { key: 'pendente', label: `Pendente (${c.pendente})`, cls: 'f-pend' }
  ];

  const html = [
    `<div class="summary">
      <span>${resumo}</span>
      <button class="export-btn" id="btnExportar" type="button">⬇ Exportar PDF</button>
    </div>`,
    `<div class="filter-bar">${chips.map((ch) =>
      `<button class="filter-chip ${ch.cls} ${filtroAtual === ch.key ? 'active' : ''}" data-filtro="${ch.key}">${ch.label}</button>`
    ).join('')}</div>`
  ];

  const filtrados = itensFiltrados();
  if (filtrados.length === 0) {
    html.push('<div class="empty">Nenhum item nesse filtro.</div>');
  } else {
    html.push(renderCardsHtml(filtrados));
  }

  elResult.innerHTML = html.join('');

  elResult.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      filtroAtual = btn.getAttribute('data-filtro');
      renderTudo();
    });
  });
  const btnExp = document.getElementById('btnExportar');
  if (btnExp) btnExp.addEventListener('click', exportarPDF);

  elResult.querySelectorAll('.actions button').forEach((btn) => {
    btn.addEventListener('click', () => onMarcar(btn));
  });
}

function renderCardsHtml(itens) {
  const parts = ['<div class="cards">'];
  itens.forEach((it) => {
    const marcado = (it.situacao || '').trim();
    const isOk = marcado === 'Separado';
    const isBad = marcado === 'Não encontrada';
    parts.push(`
      <div class="card ${isOk ? 'marked-ok' : ''} ${isBad ? 'marked-bad' : ''}" data-linha="${it.linha}">
        <div class="stamp ok-stamp">Separado</div>
        <div class="stamp bad-stamp">Não encontrada</div>
        <div class="card-head">
          <div class="desc">${escapeHtml(it.descricao)}</div>
          <div class="codigo-chip">${escapeHtml(it.codigo)}</div>
        </div>
        <div class="meta-row">
          ${modo === 'ramal' ? '' : `
          <div class="meta local">
            <div class="k">Local</div>
            <div class="v">${escapeHtml(it.local)}</div>
          </div>`}
          <div class="meta qtde">
            <div class="k">Qtde</div>
            <div class="v">${escapeHtml(it.qtde)}</div>
          </div>
        </div>
        <div class="actions">
          <button class="ok-btn ${isOk ? 'active' : ''}" data-acao="Separado">✓ Separado</button>
          <button class="bad-btn ${isBad ? 'active' : ''}" data-acao="Não encontrada">✕ Não encontrada</button>
        </div>
      </div>
    `);
  });
  parts.push('</div>');
  return parts.join('');
}

function exportarPDF() {
  if (!window.jspdf || !ultimosItens.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const itens = itensFiltrados();
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  doc.setFontSize(14);
  doc.text('Separação de Peças — Obra', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  const rotulo = modo === 'ramal' ? 'Ramal' : 'Código';
  doc.text(`${rotulo}: ${ultimoTermo}   ·   Filtro: ${rotuloFiltro(filtroAtual)}   ·   Gerado em ${dataStr}`, 14, 22);

  const colunas = modo === 'ramal'
    ? ['Código', 'Descrição', 'Qtde', 'Situação']
    : ['Código', 'Descrição', 'Local', 'Qtde', 'Situação'];

  const linhas = itens.map((it) => {
    const situacao = (it.situacao || '').trim() || 'Pendente';
    return modo === 'ramal'
      ? [String(it.codigo), String(it.descricao), String(it.qtde), situacao]
      : [String(it.codigo), String(it.descricao), String(it.local), String(it.qtde), situacao];
  });

  doc.autoTable({
    head: [colunas],
    body: linhas,
    startY: 28,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [27, 27, 24] },
    didParseCell: function (data) {
      if (data.section === 'body' && data.column.index === colunas.length - 1) {
        const v = data.cell.raw;
        if (v === 'Separado') { data.cell.styles.textColor = [47, 158, 68]; }
        else if (v === 'Não encontrada') { data.cell.styles.textColor = [201, 42, 42]; }
        else { data.cell.styles.textColor = [150, 150, 150]; }
      }
    }
  });

  const nomeArquivo = `separacao-${modo === 'ramal' ? 'ramal' : 'codigo'}-${String(ultimoTermo).replace(/[^\w-]/g, '_')}.pdf`;
  doc.save(nomeArquivo);
}

function rotuloFiltro(f) {
  if (f === 'todos') return 'Todos';
  if (f === 'pendente') return 'Pendente';
  return f;
}

async function onMarcar(btn) {
  const card = btn.closest('.card');
  const linha = card.getAttribute('data-linha');
  const acaoClicada = btn.getAttribute('data-acao');
  const jaEstaAtivo = btn.classList.contains('active');
  const novaSituacao = jaEstaAtivo ? '' : acaoClicada;

  // Atualiza local (na hora, mesmo offline)
  const item = ultimosItens.find((it) => String(it.linha) === String(linha));
  if (item) item.situacao = novaSituacao;

  const dadosLocais = carregarDadosLocais();
  if (dadosLocais) {
    const itemLocal = dadosLocais.itens.find((it) => String(it.linha) === String(linha));
    if (itemLocal) {
      itemLocal.situacao = novaSituacao;
      salvarDadosLocais(dadosLocais.itens);
    }
  }

  renderTudo();

  // Tenta enviar para a planilha; se falhar, entra na fila
  if (!navigator.onLine) {
    adicionarNaFila(linha, novaSituacao);
    setStatus('Sem internet: marcação salva no aparelho, será enviada depois.', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}?action=atualizar&linha=${encodeURIComponent(linha)}&situacao=${encodeURIComponent(novaSituacao)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.erro || 'Erro ao salvar.');
    setStatus('Situação salva na planilha.');
  } catch (err) {
    console.error(err);
    adicionarNaFila(linha, novaSituacao);
    setStatus('Sem conexão no momento: marcação salva no aparelho, será enviada depois.', true);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== Inicialização =====
atualizarBarraSync();
sincronizarFila(true).then(() => baixarDadosCompletos(true));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
