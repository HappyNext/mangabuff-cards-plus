(function() {
  'use strict';

  // --- 1. Настройки через chrome.storage ---
  const DEFAULT_CONFIG = {
    period: 30,
    source: 'all',
    format: 'ranks',
    showMinMax: true
  };
  
  let currentConfig = { ...DEFAULT_CONFIG };

  function getConfig() {
    return currentConfig;
  }

  function setConfigValue(key, value) {
    currentConfig[key] = value;
    chrome.storage.local.set({ mb_config: currentConfig });
  }

  // --- 2. Кэширование ---
  const CACHE = new Map();

  // --- 3. Стили ---
  const style = document.createElement('style');
  style.textContent = `
    .mb-stats-badge {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(24, 24, 27, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      padding: 10px 14px;
      margin: 12px 0;
      color: #e4e4e7;
      font-size: 13px;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      position: relative;
    }
    .mb-stats-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .mb-stats-title {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a1a1aa;
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .mb-settings-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #71717a;
      padding: 2px;
      display: flex;
      align-items: center;
      transition: color 0.15s ease;
    }
    .mb-settings-btn:hover {
      color: #38bdf8;
    }
    .mb-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 2px;
    }
    .mb-stat-item {
      display: flex;
      flex-direction: column;
    }
    .mb-stat-label {
      font-size: 11px;
      color: #71717a;
    }
    .mb-stat-val {
      font-weight: 700;
      font-size: 15px;
      color: #38bdf8;
    }
    .mb-stat-val.q1 { color: #34d399; }
    .mb-stat-val.q3 { color: #f43f5e; }

    /* Окно настроек */
    .mb-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    }
    .mb-modal-box {
      background: #18181b;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 14px;
      width: 360px;
      padding: 20px;
      color: #f4f4f5;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
      font-family: inherit;
    }
    .mb-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .mb-modal-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    .mb-modal-close {
      background: none;
      border: none;
      color: #a1a1aa;
      font-size: 18px;
      cursor: pointer;
    }
    .mb-modal-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }
    .mb-modal-row label {
      font-size: 12px;
      color: #a1a1aa;
      font-weight: 500;
    }
    .mb-modal-row select {
      background: #27272a;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 8px 10px;
      color: #fafafa;
      font-size: 13px;
      outline: none;
    }
    .mb-modal-row select:focus {
      border-color: #38bdf8;
    }
    .mb-save-btn {
      background: #8b5cf6;
      border: none;
      border-radius: 8px;
      color: #fff;
      padding: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      margin-top: 8px;
    }
    .mb-save-btn:hover { background: #7c3aed; }
  `;
  document.head.appendChild(style);

  // --- 4. Логика скрипта ---
  function formatPoints(points, targetRank = 'S') {
    if (!points && points !== 0) return '—';
    const cfg = getConfig();
    if (cfg.format === 'points') return `${points} pts`;

    const RANK_WEIGHTS = { X: 256, S: 128, A: 16, B: 8, C: 4, D: 2, E: 1 };
    const baseWeight = RANK_WEIGHTS[targetRank] || 128;
    const count = points / baseWeight;
    const formatted = Number.isInteger(count) ? count : Number(count.toFixed(2));
    return `${formatted} ${targetRank}`;
  }

  function detectCardRank(modal) {
    // В расширении используем фоллбэк на S, если ранга нет в явном виде
    return 'S';
  }

  async function fetchCardStats(cardId) {
    const cfg = getConfig();
    const cacheKey = `${cardId}_${cfg.period}_${cfg.source}`;
    if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

    try {
      // ИСПРАВЛЕНИЕ: Добавлен window.location.origin для расширений
      const url = `${window.location.origin}/market/cards/${cardId}/price-history?days=${cfg.period}&source=${cfg.source}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      CACHE.set(cacheKey, data);
      return data;
    } catch (e) {
      console.error('[MangaBuff Plus] Ошибка API:', e);
      return null;
    }
  }

  function openSettingsModal() {
    if (document.querySelector('.mb-modal-overlay')) return;
    const cfg = getConfig();
    const overlay = document.createElement('div');
    overlay.className = 'mb-modal-overlay';
    overlay.innerHTML = `
      <div class="mb-modal-box">
        <div class="mb-modal-header">
          <h3>Настройки аналитики</h3>
          <button class="mb-modal-close">✕</button>
        </div>
        <div class="mb-modal-row">
          <label>Период аналитики:</label>
          <select id="mb-set-period">
            <option value="7" ${cfg.period == 7 ? 'selected' : ''}>7 дней</option>
            <option value="30" ${cfg.period == 30 ? 'selected' : ''}>30 дней</option>
            <option value="60" ${cfg.period == 60 ? 'selected' : ''}>60 дней</option>
          </select>
        </div>
        <div class="mb-modal-row">
          <label>Отображение цен:</label>
          <select id="mb-set-format">
            <option value="ranks" ${cfg.format === 'ranks' ? 'selected' : ''}>В рангах (2 S)</option>
            <option value="points" ${cfg.format === 'points' ? 'selected' : ''}>В очках (256 pts)</option>
          </select>
        </div>
        <div class="mb-modal-row">
          <label>Фильтр сделок:</label>
          <select id="mb-set-source">
            <option value="all" ${cfg.source === 'all' ? 'selected' : ''}>Все сделки</option>
            <option value="market" ${cfg.source === 'market' ? 'selected' : ''}>Только маркет</option>
            <option value="requests" ${cfg.source === 'requests' ? 'selected' : ''}>Только заявки</option>
          </select>
        </div>
        <button class="mb-save-btn">Сохранить</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.mb-modal-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelector('.mb-save-btn').onclick = () => {
      setConfigValue('period', parseInt(document.getElementById('mb-set-period').value, 10));
      setConfigValue('format', document.getElementById('mb-set-format').value);
      setConfigValue('source', document.getElementById('mb-set-source').value);
      CACHE.clear();
      overlay.remove();
      const currentBadge = document.querySelector('.mb-stats-badge');
      if (currentBadge) currentBadge.remove();
      handleModal();
    };
  }

  function createBadgeHtml(data, rank = 'S') {
    const cfg = getConfig();
    if (!data || !data.stats || !data.count) {
      return `
        <div class="mb-stats-header">
          <span class="mb-stats-title">Рынок (${cfg.period} дн.)</span>
          <button class="mb-settings-btn" title="Настройки">⚙</button>
        </div>
        <span style="color: #71717a; margin-top: 4px;">Нет данных</span>
      `;
    }
    const s = data.stats;
    return `
      <div class="mb-stats-header">
        <span class="mb-stats-title">Рынок (${cfg.period} дн.) • Сделок: ${data.count}</span>
        <button class="mb-settings-btn" title="Настройки">⚙</button>
      </div>
      <div class="mb-stats-grid">
        <div class="mb-stat-item"><span class="mb-stat-label">Медиана</span><span class="mb-stat-val">${formatPoints(s.median_points, rank)}</span></div>
        <div class="mb-stat-item"><span class="mb-stat-label">Мин (Q1)</span><span class="mb-stat-val q1">${formatPoints(s.q1_points, rank)}</span></div>
        <div class="mb-stat-item"><span class="mb-stat-label">Макс (Q3)</span><span class="mb-stat-val q3">${formatPoints(s.q3_points, rank)}</span></div>
      </div>
    `;
  }

  function extractBaseCardId(modal) {
    const requestLink = modal.querySelector('a[href*="/market/requests/create?card_id="]');
    if (requestLink) {
      const match = requestLink.href.match(/card_id=(\d+)/);
      if (match) return match[1];
    }
    const usersLink = modal.querySelector('a[href*="/cards/"][href*="/users"]');
    if (usersLink) {
      const match = usersLink.href.match(/\/cards\/(\d+)\/users/);
      if (match) return match[1];
    }
    return null;
  }

  async function handleModal() {
    const modal = document.querySelector('.manga-cards__container');
    if (!modal) return;

    const cardId = extractBaseCardId(modal);
    if (!cardId) return;

    const existingBadge = modal.querySelector('.mb-stats-badge');
    if (existingBadge) {
      if (existingBadge.dataset.cardId === cardId) return;
      existingBadge.remove();
    }

    const targetContainer = modal.querySelector('.manga-cards__info');
    if (!targetContainer) return;

    const badge = document.createElement('div');
    badge.className = 'mb-stats-badge';
    badge.dataset.cardId = cardId;
    badge.innerHTML = `<span style="color: #a1a1aa;"> Загрузка...</span>`;
    
    const insertBeforeEl = modal.querySelector('.manga-cards__controls') || targetContainer.firstChild;
    targetContainer.insertBefore(badge, insertBeforeEl);

    const data = await fetchCardStats(cardId);
    badge.innerHTML = createBadgeHtml(data, detectCardRank(modal));

    const gearBtn = badge.querySelector('.mb-settings-btn');
    if (gearBtn) gearBtn.onclick = (e) => { e.stopPropagation(); openSettingsModal(); };
  }

  // --- 5. Инициализация расширения ---
  function initExtension() {
    const observer = new MutationObserver(() => {
      handleModal();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Проверка сразу при старте (если модалка уже была открыта)
    handleModal();
  }

  // Старт после загрузки настроек из хранилища браузера
  chrome.storage.local.get(['mb_config'], (result) => {
    if (result.mb_config) {
      Object.assign(currentConfig, result.mb_config);
    }
    initExtension();
  });

})();