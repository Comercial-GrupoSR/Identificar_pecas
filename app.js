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

let modo = 'codigo'; // 'codigo' | 'ramal'
let ramaisCarregados = false;

function setStatus(msg, isErr) {
  elStatus.textContent = msg || '';
  elStatus.className = 'status-line' + (isErr ? ' err' : '');
}

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
    carregarRamais();
  }
  input.focus();
}

tabCodigo.addEventListener('click', () => setModo('codigo'));
tabRamal.addEventListener('click', () => setModo('ramal'));

async function carregarRamais() {
  if (ramaisCarregados) return;
  try {
    const res = await fetch(`${API_URL}?action=listarRamais`);
    const data = await res.json();
    if (data.ok) {
      ramaisList.innerHTML = (data.ramais || [])
        .map((r) => `<option value="${escapeHtml(r)}">`)
        .join('');
      ramaisCarregados = true;
    }
  } catch (err) {
    console.error(err);
  }
}

// ===== Busca =====
form.addEventListener('submit', (e) => {
  e.preventDefault();
  buscar();
});

async function buscar() {
  const termo = input.value.trim();
  if (!termo) return;
  const apiUrl = API_URL;

  btnBuscar.disabled = true;
  btnBuscar.innerHTML = '<span class="spinner"></span>';
  setStatus('Buscando...');
  elResult.innerHTML = '';

  try {
    const action = modo === 'ramal' ? 'buscarRamal' : 'buscar';
    const param = modo === 'ramal' ? 'ramal' : 'codigo';
    const res = await fetch(`${apiUrl}?action=${action}&${param}=${encodeURIComponent(termo)}`);
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.erro || 'Erro ao buscar.', true);
      return;
    }
    renderResultados(termo, data.itens || []);
    if ((data.itens || []).length === 0) {
      setStatus(modo === 'ramal' ? 'Nenhuma peça encontrada para esse ramal.' : 'Nenhum item encontrado para esse código.', true);
    } else {
      setStatus('');
    }
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível conectar à planilha. Verifique sua internet.', true);
  } finally {
    btnBuscar.disabled = false;
    btnBuscar.textContent = 'Buscar';
  }
}

function renderResultados(termo, itens) {
  if (itens.length === 0) {
    const rotulo = modo === 'ramal' ? 'ramal' : 'código';
    elResult.innerHTML = `<div class="empty">Nada encontrado para o ${rotulo} <strong>${escapeHtml(termo)}</strong>.</div>`;
    return;
  }

  const totalQtde = itens.reduce((acc, it) => acc + (parseFloat(it.qtde) || 0), 0);
  const resumo = modo === 'ramal'
    ? `${escapeHtml(termo)} · ${itens.length} peça(s) · ${totalQtde} unidade(s) no total`
    : `${itens.length} local(is) · ${totalQtde} peça(s) no total`;
  const html = [`<div class="summary">${resumo}</div>`, '<div class="cards">'];

  itens.forEach((it) => {
    const marcado = (it.situacao || '').trim();
    const isOk = marcado === 'Separado';
    const isBad = marcado === 'Não encontrada';
    html.push(`
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

  html.push('</div>');
  elResult.innerHTML = html.join('');

  elResult.querySelectorAll('.actions button').forEach((btn) => {
    btn.addEventListener('click', () => onMarcar(btn));
  });
}

async function onMarcar(btn) {
  const card = btn.closest('.card');
  const linha = card.getAttribute('data-linha');
  const acaoClicada = btn.getAttribute('data-acao');
  const jaEstaAtivo = btn.classList.contains('active');
  // clicar de novo no mesmo status desmarca (volta a vazio)
  const novaSituacao = jaEstaAtivo ? '' : acaoClicada;

  card.classList.add('busy');
  const apiUrl = API_URL;
  try {
    const res = await fetch(`${apiUrl}?action=atualizar&linha=${encodeURIComponent(linha)}&situacao=${encodeURIComponent(novaSituacao)}`);
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.erro || 'Erro ao salvar.', true);
      return;
    }
    card.classList.remove('marked-ok', 'marked-bad');
    card.querySelectorAll('.actions button').forEach((b) => b.classList.remove('active'));
    if (novaSituacao === 'Separado') {
      card.classList.add('marked-ok');
      card.querySelector('.ok-btn').classList.add('active');
    } else if (novaSituacao === 'Não encontrada') {
      card.classList.add('marked-bad');
      card.querySelector('.bad-btn').classList.add('active');
    }
    setStatus('Situação salva na planilha.');
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível salvar. Verifique sua conexão.', true);
  } finally {
    card.classList.remove('busy');
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== Inicialização =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
