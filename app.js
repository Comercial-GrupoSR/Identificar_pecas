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
const tabResumo = document.getElementById('tabResumo');
const ramaisList = document.getElementById('ramaisList');
const syncStatusText = document.getElementById('syncStatusText');
const btnSincronizar = document.getElementById('btnSincronizar');

const DADOS_KEY = 'obra_dados_locais_v1';
const FILA_KEY = 'obra_fila_pendente_v1';

let modo = 'codigo'; // 'codigo' | 'ramal'
let ultimosItens = [];
let ultimoTermo = '';
let filtroAtual = 'todos'; // 'todos' | 'Separado' | 'Parcial' | 'Não encontrada' | 'pendente'
let cardsEmEdicao = new Set(); // linhas destravadas para poder diminuir/desfazer

// ---- Controle de sincronização por linha (nova versão robusta) ----
const DEBOUNCE_ENVIO_MS = 600;
const timersEnvio = {};       // linha -> timeoutId (debounce antes de enviar)
const envioEmAndamento = {};  // linha -> true se já existe um fetch em curso para essa linha
const valorPendente = {};     // linha -> último valor que ainda precisa ser confirmado no servidor

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
      const fila = carregarFila();
      const itensAjustados = data.itens.map((it) => {
        const linhaStr = String(it.linha);
        if (Object.prototype.hasOwnProperty.call(fila, linhaStr)) {
          return { ...it, situacao: fila[linhaStr] };
        }
        if (Object.prototype.hasOwnProperty.call(valorPendente, linhaStr)) {
          return { ...it, situacao: valorPendente[linhaStr] };
        }
        return it;
      });

      salvarDadosLocais(itensAjustados);

      if (modo === 'resumo') {
        mostrarResumo();
      } else if (ultimosItens.length) {
        itensAjustados.forEach((novo) => {
          const atual = ultimosItens.find((it) => String(it.linha) === String(novo.linha));
          if (atual) atual.situacao = novo.situacao;
        });
        renderTudo();
      }

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

// ===== Enviar marcações pendentes (feitas offline) para a planilha =====
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
      break;
    }
  }
  atualizarBarraSync();
}

// ===== Barra de status de sincronização =====
function atualizarBarraSync() {
  const fila = carregarFila();
  const pendentes = Object.keys(fila).length + Object.keys(valorPendente).length;
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    Object.keys(timersEnvio).forEach((linha) => {
      clearTimeout(timersEnvio[linha]);
      delete timersEnvio[linha];
    });
    Object.keys(valorPendente).forEach((linha) => {
      processarEnvio(linha);
    });
  }
});

// ===== Alternar modo de busca =====
function setModo(novoModo) {
  modo = novoModo;
  elResult.innerHTML = '';
  setStatus('');
  input.value = '';

  [tabCodigo, tabRamal, tabResumo].forEach((t) => t.classList.remove('active'));

  if (modo === 'codigo') {
    tabCodigo.classList.add('active');
    form.style.display = '';
    input.placeholder = 'Digite o código da peça…';
    input.setAttribute('inputmode', 'numeric');
    input.removeAttribute('list');
    input.focus();
  } else if (modo === 'ramal') {
    tabRamal.classList.add('active');
    form.style.display = '';
    input.placeholder = 'Digite ou escolha o ramal…';
    input.setAttribute('inputmode', 'text');
    input.setAttribute('list', 'ramaisList');
    preencherListaRamais();
    input.focus();
  } else if (modo === 'resumo') {
    tabResumo.classList.add('active');
    form.style.display = 'none';
    mostrarResumo();
  }
}

tabCodigo.addEventListener('click', () => setModo('codigo'));
tabRamal.addEventListener('click', () => setModo('ramal'));
tabResumo.addEventListener('click', () => setModo('resumo'));

function mostrarResumo() {
  const dados = carregarDadosLocais();
  if (!dados || !dados.itens || !dados.itens.length) {
    elResult.innerHTML = '<div class="empty">Ainda não há dados sincronizados no aparelho. Toque em 🔄 Sincronizar.</div>';
    return;
  }
  ultimosItens = dados.itens;
  ultimoTermo = 'Todos os itens';
  filtroAtual = 'todos';
  renderTudo();
}

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
  const c = { todos: itens.length, Separado: 0, Parcial: 0, 'Não encontrada': 0, pendente: 0 };
  itens.forEach((it) => {
    const est = parseSituacao(it.situacao, it.qtde).estado;
    if (est === 'completo') c.Separado++;
    else if (est === 'parcial') c.Parcial++;
    else if (est === 'nao_encontrada') c['Não encontrada']++;
    else c.pendente++;
  });
  return c;
}

function itensFiltrados() {
  if (filtroAtual === 'todos') return ultimosItens;
  return ultimosItens.filter((it) => {
    const est = parseSituacao(it.situacao, it.qtde).estado;
    if (filtroAtual === 'Separado') return est === 'completo';
    if (filtroAtual === 'Parcial') return est === 'parcial';
    if (filtroAtual === 'Não encontrada') return est === 'nao_encontrada';
    if (filtroAtual === 'pendente') return est === 'pendente';
    return true;
  });
}

function contarUnidadesPorSituacao(itens) {
  let separadas = 0;
  let naoEncontradas = 0;
  let pendentes = 0;
  itens.forEach((it) => {
    const total = parseFloat(it.qtde) || 0;
    const est = parseSituacao(it.situacao, it.qtde);
    if (est.estado === 'nao_encontrada') {
      naoEncontradas += total;
    } else {
      separadas += est.found;
      pendentes += (total - est.found);
    }
  });
  return { separadas, naoEncontradas, pendentes };
}

function renderTudo() {
  const totalQtde = ultimosItens.reduce((acc, it) => acc + (parseFloat(it.qtde) || 0), 0);
  const resumo = modo === 'ramal'
    ? `${escapeHtml(ultimoTermo)} · ${ultimosItens.length} peça(s) · ${totalQtde} unidade(s) no total`
    : modo === 'resumo'
      ? `${ultimosItens.length} peça(s) cadastradas · ${totalQtde} unidade(s) no total`
      : `${ultimosItens.length} local(is) · ${totalQtde} peça(s) no total`;

  const c = contarPorSituacao(ultimosItens);
  const u = contarUnidadesPorSituacao(ultimosItens);
  const chips = [
    { key: 'todos', label: `Todos (${c.todos})`, cls: '' },
    { key: 'Separado', label: `Separado (${c.Separado})`, cls: 'f-ok' },
    { key: 'Parcial', label: `Parcial (${c.Parcial})`, cls: 'f-partial' },
    { key: 'Não encontrada', label: `Não encontrada (${c['Não encontrada']})`, cls: 'f-bad' },
    { key: 'pendente', label: `Pendente (${c.pendente})`, cls: 'f-pend' }
  ];

  const html = [
    `<div class="summary"> <span>${resumo}</span> <div class="summary-btns"><button class="export-btn" id="btnExportar" type="button">⬇ Baixar PDF</button><button class="export-btn drive-btn" id="btnDrive" type="button">☁️ Salvar no Drive</button></div> </div>`,
    `<div class="stats-row">
      <div class="stat-box stat-ok"><span class="stat-num">${u.separadas}</span><span class="stat-label">Separadas</span></div>
      <div class="stat-box stat-pend"><span class="stat-num">${u.pendentes}</span><span class="stat-label">Pendentes</span></div>
      <div class="stat-box stat-bad"><span class="stat-num">${u.naoEncontradas}</span><span class="stat-label">Não encontradas</span></div>
    </div>`,
    `<div class="filter-bar">${chips.map((ch) => `<button class="filter-chip ${ch.cls} ${filtroAtual === ch.key ? 'active' : ''}" data-filtro="${ch.key}">${ch.label}</button>`).join('')}</div>`
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
  const btnDrive = document.getElementById('btnDrive');
  if (btnDrive) btnDrive.addEventListener('click', exportarParaDrive);

  elResult.querySelectorAll('.qty-edit-toggle').forEach((btn) => {
    btn.addEventListener('click', () => onToggleEdicao(btn));
  });
  elResult.querySelectorAll('.qty-plus').forEach((btn) => {
    btn.addEventListener('click', () => onQtdChange(btn, 1));
  });
  elResult.querySelectorAll('.qty-minus').forEach((btn) => {
    btn.addEventListener('click', () => onQtdChange(btn, -1));
  });
  elResult.querySelectorAll('.bad-btn').forEach((btn) => {
    btn.addEventListener('click', () => onNaoEncontrada(btn));
  });
}

function renderCardsHtml(itens) {
  const parts = ['<div class="cards">'];
  itens.forEach((it) => {
    const total = parseFloat(it.qtde) || 0;
    const est = parseSituacao(it.situacao, it.qtde);
    const isOk = est.estado === 'completo';
    const isBad = est.estado === 'nao_encontrada';
    const isPartial = est.estado === 'parcial';
    const found = est.found;

    // Card já com quantidade (Separado ou Parcial) nasce com o "−" travado —
    // precisa tocar em "Editar" para diminuir/desfazer. O "+" continua
    // sempre liberado, inclusive no parcial, já que adicionar não precisa
    // de trava (só diminuir é que é "desfazer").
    const precisaDestravar = isOk || isPartial;
    const destravado = cardsEmEdicao.has(String(it.linha));
    const minusTravado = precisaDestravar && !destravado;

    // "Não encontrada" só faz sentido enquanto não há nada separado ainda.
    // Com quantidade > 0 (total ou parcial), o botão fica desabilitado —
    // para "desmarcar" seria preciso primeiro zerar a quantidade via edição.
    const naoEncontradaDesabilitado = (isOk || isPartial) && !isBad;

    parts.push(`
      <div class="card ${isOk ? 'marked-ok' : ''} ${isBad ? 'marked-bad' : ''} ${isPartial ? 'marked-partial' : ''}" data-linha="${it.linha}" data-total="${total}">
        <div class="stamp ok-stamp">Separado</div>
        <div class="stamp bad-stamp">Não encontrada</div>
        <div class="stamp partial-stamp">Parcial ${found}/${total}</div>
        <div class="card-head">
          <div class="codigo-chip">${escapeHtml(it.codigo)}</div>
        </div>
        <div class="desc">${escapeHtml(it.descricao)}</div>
        <div class="meta-row">
          ${modo === 'ramal' ? '' : `
          <div class="meta local">
            <div class="k">Local</div>
            <div class="v">${escapeHtml(it.local)}</div>
          </div>`}
        </div>
        <div class="actions">
          <div class="qty-track">
            <div class="qty-label">Separado: <strong class="qty-value">${found}</strong> / ${total}</div>
            <div class="qty-stepper">
              ${precisaDestravar ? `<button class="qty-edit-toggle ${destravado ? 'active' : ''}" type="button" title="${destravado ? 'Travar' : 'Editar quantidade'}">${destravado ? '🔓' : '✎'}</button>` : ''}
              <button class="qty-btn qty-minus" type="button" ${(minusTravado || found <= 0) ? 'disabled' : ''}>−</button>
              <button class="qty-btn qty-plus" type="button" ${found >= total ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <button class="bad-btn ${isBad ? 'active' : ''}" data-acao="Não encontrada" ${naoEncontradaDesabilitado ? 'disabled' : ''}>✕ Não encontrada</button>
        </div>
      </div>
    `);
  });
  parts.push('</div>');
  return parts.join('');
}

function construirDocPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const itens = itensFiltrados();
  const agora = new Date();
  const dataStr = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  doc.setFontSize(14);
  doc.text('Separação de Peças — Obra', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  const rotulo = modo === 'ramal' ? 'Ramal' : modo === 'resumo' ? 'Resumo geral' : 'Código';
  doc.text(`${rotulo}: ${ultimoTermo} · Filtro: ${rotuloFiltro(filtroAtual)} · Gerado em ${dataStr}`, 14, 22);

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

  return doc;
}

function nomeArquivoPDF() {
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
  const prefixo = modo === 'ramal' ? 'ramal' : modo === 'resumo' ? 'resumo-geral' : 'codigo';
  const sufixo = modo === 'resumo' ? carimbo : `${String(ultimoTermo).replace(/[^\w-]/g, '_')}-${carimbo}`;
  return `separacao-${prefixo}-${sufixo}.pdf`;
}

function exportarPDF() {
  if (!window.jspdf || !ultimosItens.length) return;
  const doc = construirDocPDF();
  doc.save(nomeArquivoPDF());
}

async function exportarParaDrive() {
  if (!window.jspdf || !ultimosItens.length) return;
  if (!navigator.onLine) {
    setStatus('Sem internet: não é possível salvar no Drive agora.', true);
    return;
  }
  setStatus('Gerando PDF e enviando para o Drive...');
  try {
    const doc = construirDocPDF();
    const base64 = doc.output('datauristring').split(',')[1];
    const nomeArquivo = nomeArquivoPDF();

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'salvarPDF', nomeArquivo, conteudoBase64: base64 })
    });
    const data = await res.json();
    if (data.ok) {
      setStatus('PDF salvo no Drive.');
    } else {
      setStatus(data.erro || 'Falha ao salvar no Drive.', true);
    }
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível salvar no Drive agora.', true);
  }
}

function rotuloFiltro(f) {
  if (f === 'todos') return 'Todos';
  if (f === 'pendente') return 'Pendente';
  return f;
}

// ===== Sincronização robusta (envio) =====

function persistirSituacao(linha, novaSituacao) {
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

  valorPendente[String(linha)] = novaSituacao;
  atualizarBarraSync();

  if (timersEnvio[linha]) clearTimeout(timersEnvio[linha]);
  timersEnvio[linha] = setTimeout(() => {
    delete timersEnvio[linha];
    processarEnvio(linha);
  }, DEBOUNCE_ENVIO_MS);
}

async function processarEnvio(linha) {
  const linhaStr = String(linha);
  if (envioEmAndamento[linhaStr]) return;
  const situacao = valorPendente[linhaStr];
  if (situacao === undefined) return;

  envioEmAndamento[linhaStr] = true;
  await enviarSituacao(linhaStr, situacao);
  delete envioEmAndamento[linhaStr];

  if (valorPendente[linhaStr] !== undefined) {
    processarEnvio(linhaStr);
  }
}

async function enviarSituacao(linha, novaSituacao) {
  if (!navigator.onLine) {
    adicionarNaFila(linha, novaSituacao);
    setStatus('Sem internet: marcação salva no aparelho, será enviada depois.', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}?action=atualizar&linha=${encodeURIComponent(linha)}&situacao=${encodeURIComponent(novaSituacao)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.erro || 'Erro ao salvar.');

    if (data.situacao !== undefined && String(data.situacao).trim() !== String(novaSituacao).trim()) {
      throw new Error('A planilha confirmou um valor diferente do enviado.');
    }

    if (valorPendente[linha] === novaSituacao) {
      delete valorPendente[linha];
    }
    setStatus('Situação salva na planilha.');
    atualizarBarraSync();
  } catch (err) {
    console.error(err);
    adicionarNaFila(linha, novaSituacao);
    setStatus('Sem conexão no momento: marcação salva no aparelho, será enviada depois.', true);
  }
}

function onToggleEdicao(btn) {
  const card = btn.closest('.card');
  const linha = String(card.getAttribute('data-linha'));
  if (cardsEmEdicao.has(linha)) {
    cardsEmEdicao.delete(linha);
  } else {
    cardsEmEdicao.add(linha);
  }
  renderTudo();
}

function onQtdChange(btn, delta) {
  const card = btn.closest('.card');
  const linha = card.getAttribute('data-linha');
  const total = parseFloat(card.getAttribute('data-total')) || 0;
  const item = ultimosItens.find((it) => String(it.linha) === String(linha));
  const atual = item ? parseSituacao(item.situacao, total).found : 0;
  const novoFound = Math.max(0, Math.min(atual + delta, total));
  const novaSituacao = situacaoFromFound(novoFound, total);
  persistirSituacao(linha, novaSituacao);
}

function onNaoEncontrada(btn) {
  if (btn.disabled) return;
  const card = btn.closest('.card');
  const linha = card.getAttribute('data-linha');
  const jaEstaAtivo = btn.classList.contains('active');
  const novaSituacao = jaEstaAtivo ? '' : 'Não encontrada';
  persistirSituacao(linha, novaSituacao);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== Situação com quantidade parcial =====
function parseSituacao(situacaoRaw, total) {
  const s = String(situacaoRaw || '').trim();
  const totalNum = parseFloat(total) || 0;
  if (s === 'Separado') return { found: totalNum, estado: 'completo' };
  if (s === 'Não encontrada') return { found: 0, estado: 'nao_encontrada' };
  const m = s.match(/^Parcial\s+([\d.,]+)\s*\/\s*([\d.,]+)$/i);
  if (m) return { found: parseFloat(m[1].replace(',', '.')), estado: 'parcial' };
  return { found: 0, estado: 'pendente' };
}

function situacaoFromFound(found, total) {
  const totalNum = parseFloat(total) || 0;
  const foundNum = Math.max(0, Math.min(found, totalNum));
  if (foundNum <= 0) return '';
  if (foundNum >= totalNum) return 'Separado';
  return `Parcial ${foundNum}/${totalNum}`;
}

// ===== Inicialização =====
atualizarBarraSync();
sincronizarFila(true).then(() => baixarDadosCompletos(true));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
