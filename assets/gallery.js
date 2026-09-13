(async () => {
  const grid = document.getElementById('grid');
  const tabs = document.getElementById('tabs');
  const empty = document.getElementById('empty');
  const q = document.getElementById('q');

  let data;
  try {
    data = await (await fetch('manifest.json?v=' + Date.now())).json();
  } catch (e) {
    grid.innerHTML = '<p style="color:var(--muted)">Не удалось загрузить manifest.json. ' +
      'Если открываешь файл локально — подними сервер: <code>npx serve</code></p>';
    return;
  }

  const items = data.items || [];
  const folders = data.folders || [];
  const label = f => f || 'Без раздела';
  let active = new URLSearchParams(location.search).get('f') ?? '*';

  // ── вкладки разделов ──
  const counts = f => items.filter(i => i.folder === f).length;
  const tabList = [['*', 'Все', items.length], ...folders.map(f => [f, label(f), counts(f)])];
  tabs.innerHTML = tabList.map(([v, t, n]) =>
    `<button class="tab" role="tab" data-f="${esc(v)}"><span>${esc(t)}</span><span class="n">${n}</span></button>`
  ).join('');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    active = b.dataset.f;
    const u = new URL(location); active === '*' ? u.searchParams.delete('f') : u.searchParams.set('f', active);
    history.replaceState(null, '', u); render();
  });

  q.addEventListener('input', render);
  render();

  function render() {
    [...tabs.children].forEach(b => b.setAttribute('aria-selected', b.dataset.f === active));
    const needle = q.value.trim().toLowerCase();
    const list = items.filter(i =>
      (active === '*' || i.folder === active) &&
      (!needle || i.title.toLowerCase().includes(needle) || label(i.folder).toLowerCase().includes(needle)));

    empty.hidden = list.length > 0;
    grid.innerHTML = list.map(i => `
      <a class="card" href="view.html?d=${encodeURIComponent(i.slug)}">
        <div class="thumb">${i.thumb
          ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" onerror="this.replaceWith(ph())">`
          : `<span class="ph">◌</span>`}</div>
        <div class="meta">
          <h3>${esc(i.title)}</h3>
          <div class="sub">
            ${i.folder ? `<span class="chip">${esc(i.folder)}</span>` : ''}
            <span>${i.kind === 'file' ? 'свой файл' : 'GeoGebra'}</span>
          </div>
        </div>
      </a>`).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  window.ph = () => { const s = document.createElement('span'); s.className = 'ph'; s.textContent = '◌'; return s; };
})();
