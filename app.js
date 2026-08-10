// ===== Configuração =====
const STORAGE_KEY = 'obra_app_url_v1';

const elStatus = document.getElementById('statusLine');
const elResult = document.getElementById('resultArea');
const elConfigArea = document.getElementById('configArea');
const form = document.getElementById('formBusca');
const input = document.getElementById('inputCodigo');
const btnBuscar = document.getElementById('btnBuscar');
const btnConfig = document.getElementById('btnConfig');

function getApiUrl() {
  return localStorage.getItem(STORAGE_KEY) || '';
}
function setApiUrl(url) {
  localStorage.setItem(STORAGE_KEY, url.trim());
}

function setStatus(msg, isErr) {
  elStatus.textContent = msg || '';
  elStatus.className = 'status-line' + (isErr ? ' err' : '');
}

// ===== Painel de configuração =====
function renderConfig(forceOpen) {
  const url = getApiUrl();
  if (url && !forceOpen) {
    elConfigArea.innerHTML = '';
    return;
  }
  elConfigArea.innerHTML = `
    <div class="config-panel">
      <h2>Configurar conexão com a planilha</h2>
      <label>Cole aqui a URL do Apps Script (Web App)</label>
      <input type="text" id="cfgUrl" placeholder="https://script.google.com/macros/s/AAAAA.../exec" value="${url ? url.replace(/"/g, '&quot;') : ''}">
      <div class="row">
        <button id="cfgSalvar" type="button">Salvar</button>
        ${url ? '<button class="ghost" id="cfgCancelar" type="button">Cancelar</button>' : ''}
      </div>
    </div>
  `;
  document.getElementById('cfgSalvar').addEventListener('click', () => {
    const v = document.getElementById('cfgUrl').value.trim();
    if (!v.startsWith('https://script.google.com/')) {
      setStatus('Essa não parece ser uma URL válida do Apps Script.', true);
      return;
    }
    setApiUrl(v);
    setStatus('Conexão salva.');
    renderConfig(false);
  });
  const cancelBtn = document.getElementById('cfgCancelar');
  if (cancelBtn) cancelBtn.addEventListener('click', () => renderConfig(false));
}

btnConfig.addEventListener('click', () => renderConfig(true));

// ===== Busca =====
form.addEventListener('submit', (e) => {
  e.preventDefault();
  buscar();
});

async function buscar() {
  const codigo = input.value.trim();
  if (!codigo) return;
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    setStatus('Configure a conexão com a planilha primeiro (⚙ Configurar).', true);
    renderConfig(true);
    return;
  }

  btnBuscar.disabled = true;
  btnBuscar.innerHTML = '<span class="spinner"></span>';
  setStatus('Buscando...');
  elResult.innerHTML = '';

  try {
    const res = await fetch(`${apiUrl}?action=buscar&codigo=${encodeURIComponent(codigo)}`);
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.erro || 'Erro ao buscar.', true);
      return;
    }
    renderResultados(codigo, data.itens || []);
    if ((data.itens || []).length === 0) {
      setStatus('Nenhum item encontrado para esse código.', true);
    } else {
      setStatus('');
    }
  } catch (err) {
    console.error(err);
    setStatus('Não foi possível conectar à planilha. Verifique a URL configurada.', true);
  } finally {
    btnBuscar.disabled = false;
    btnBuscar.textContent = 'Buscar';
  }
}

function renderResultados(codigo, itens) {
  if (itens.length === 0) {
    elResult.innerHTML = `<div class="empty">Nada encontrado para o código <strong>${escapeHtml(codigo)}</strong>.</div>`;
    return;
  }

  const totalQtde = itens.reduce((acc, it) => acc + (parseFloat(it.qtde) || 0), 0);
  const html = [`<div class="summary">${itens.length} local(is) · ${totalQtde} peça(s) no total</div>`, '<div class="cards">'];

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
          <div class="meta local">
            <div class="k">Local</div>
            <div class="v">${escapeHtml(it.local)}</div>
          </div>
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
  const apiUrl = getApiUrl();
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
renderConfig(false);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
