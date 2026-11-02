// ==UserScript==
// @name         MangaBuff Cards Plus
// @namespace    https://github.com/HappyNext/mangabuff-cards-plus
// @version      0.1.0
// @description  Расширенная аналитика, медианные цены и статистика карточек на MangaBuff
// @author       HappyNext
// @match        https://mangabuff.ru/*
// @icon         https://mangabuff.ru/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const CACHE = new Map();

  // Добавление стилей плашки
  const style = document.createElement('style');
  style.textContent = `
    .mb-stats-badge {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(24, 24, 27, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 10px 14px;
      margin: 10px 0;
      color: #e4e4e7;
      font-size: 13px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .mb-stats-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #a1a1aa;
      display: flex;
      justify-content: space-between;
    }
    .mb-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
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
      font-size: 14px;
      color: #38bdf8;
    }
    .mb-stat-val.q1 { color: #34d399; }
    .mb-stat-val.q3 { color: #f43f5e; }
  `;
  document.head.appendChild(style);

  // Получение данных по API
  async function fetchCardStats(cardId) {
    if (CACHE.has(cardId)) return CACHE.get(cardId);

    try {
      const res = await fetch(`/market/card/${cardId}/price-history?days=30&source=all`);
      if (!res.ok) return null;
      const data = await res.json();
      CACHE.set(cardId, data);
      return data;
    } catch (e) {
      console.error('[MangaBuff Plus] Ошибка запроса статистики:', e);
      return null;
    }
  }

  // Отрисовка плашки в модальном окне
  async function renderBadge(modal) {
    if (modal.querySelector('.mb-stats-badge')) return;

    // Ищем ссылку на маркет, где фигурирует card_id
    const marketLink = modal.querySelector('a[href*="/market/requests/create?card_id="]');
    if (!marketLink) return;

    const urlParams = new URLSearchParams(marketLink.search);
    const cardId = urlParams.get('card_id');
    if (!cardId) return;

    const targetContainer = modal.querySelector('.manga-cards__info');
    if (!targetContainer) return;

    // Временная плашка загрузки
    const badge = document.createElement('div');
    badge.className = 'mb-stats-badge';
    badge.innerHTML = `<span style="color: #a1a1aa;"> Загрузка рыночных цен...</span>`;
    
    const insertBeforeEl = modal.querySelector('.manga-cards__controls') || targetContainer.firstChild;
    targetContainer.insertBefore(badge, insertBeforeEl);

    const data = await fetchCardStats(cardId);

    if (!data || !data.stats) {
      badge.innerHTML = `<span style="color: #71717a;">Нет данных о сделках за 30 дней</span>`;
      return;
    }

    const s = data.stats;
    badge.innerHTML = `
      <div class="mb-stats-title">
        <span>Рынок (30 дней)</span>
        <span>Сделок: ${data.count ?? 0}</span>
      </div>
      <div class="mb-stats-grid">
        <div class="mb-stat-item">
          <span class="mb-stat-label">Медиана</span>
          <span class="mb-stat-val">${s.median_points ?? '—'}</span>
        </div>
        <div class="mb-stat-item">
          <span class="mb-stat-label">Мин (Q1)</span>
          <span class="mb-stat-val q1">${s.q1_points ?? '—'}</span>
        </div>
        <div class="mb-stat-item">
          <span class="mb-stat-label">Макс (Q3)</span>
          <span class="mb-stat-val q3">${s.q3_points ?? '—'}</span>
        </div>
      </div>
    `;
  }

  // Наблюдатель за открытием модалки
  const observer = new MutationObserver(() => {
    const modal = document.querySelector('.manga-cards__container');
    if (modal) {
      renderBadge(modal);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();