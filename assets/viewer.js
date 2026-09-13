(async () => {
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const slug = new URLSearchParams(location.search).get('d');

  let data;
  try { data = await (await fetch('manifest.json?v=' + Date.now())).json(); }
  catch { $('loading').textContent = 'не удалось загрузить manifest.json'; return; }

  const items = data.items || [];
  const idx = items.findIndex(i => i.slug === slug);
  if (idx < 0) { $('loading').textContent = 'чертёж не найден'; $('title').textContent = 'Не найдено'; return; }
  const item = items[idx];

  // ── шапка ────────────────────────────────────────────────
  document.title = item.title + ' — Чертежи';
  $('title').textContent = item.title;
  if (item.folder) { $('folder').textContent = item.folder; $('folder').hidden = false; }
  $('back').href = item.folder ? './?f=' + encodeURIComponent(item.folder) : './';

  // соседние чертежи — в пределах того же раздела
  const sibs = items.filter(i => i.folder === item.folder);
  const si = sibs.indexOf(item);
  const go = d => { const n = sibs[si + d]; if (n) location.href = 'view.html?d=' + encodeURIComponent(n.slug); };
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('prev').disabled = si <= 0;
  $('next').disabled = si >= sibs.length - 1;

  addEventListener('keydown', e => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'Escape' && !document.fullscreenElement) location.href = $('back').href;
  });

  $('dl').href = item.kind === 'file'
    ? item.file
    : 'https://www.geogebra.org/material/download/format/file/id/' + item.material;
  if (item.kind === 'file') $('dl').setAttribute('download', item.title + '.ggb');

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Ссылка скопирована'); }
    catch { toast(location.href); }
  };
  $('fs').onclick = () =>
    document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.();

  function toast(t) {
    const el = $('toast'); el.textContent = t; el.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 1800);
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ── аплет ────────────────────────────────────────────────
  let api = null, is3d = false;
  let showAlgebra = store.get('algebra', '0') === '1';

  const applyPerspective = () => {
    if (!api) return;
    const v = is3d ? 'T' : 'G';
    api.setPerspective(showAlgebra ? 'A' + v : v);
    $('algebra').setAttribute('aria-pressed', String(showAlgebra));
    setTimeout(fit, 250);
  };
  $('algebra').onclick = () => { showAlgebra = !showAlgebra; store.set('algebra', showAlgebra ? '1' : '0'); applyPerspective(); };

  const params = {
    appName: 'classic',
    width: stage.clientWidth,
    height: stage.clientHeight,
    showToolBar: false,
    showMenuBar: false,
    showAlgebraInput: false,
    allowStyleBar: false,
    showResetIcon: true,
    showZoomButtons: true,
    enableRightClick: false,
    enableLabelDrags: false,
    enableShiftDragZoom: true,
    errorDialogsActive: false,
    useBrowserForJS: false,
    preventFocus: true,
    language: 'ru',
    appletOnLoad() {
      api = applet.getAppletObject();
      // 3D-чертежи узнаём по наличию 3D-вида в файле
      is3d = item.perspective ? item.perspective === 'T'
           : (() => { try { return /euclidianView3D/.test(api.getXML()); } catch { return false; } })();
      applyPerspective();
      $('loading')?.remove();
      fit();
    },
  };
  if (item.kind === 'file') params.filename = new URL(item.file, location.href).href;
  else params.material_id = item.material;

  if (typeof GGBApplet === 'undefined') {
    $('loading').innerHTML = 'не удалось загрузить движок GeoGebra —<br>проверь интернет и обнови страницу';
    return;
  }
  const applet = new GGBApplet(params, true);
  applet.inject('ggb');

  // ── подгон под размер окна ───────────────────────────────
  let t;
  function fit() {
    if (api && api.setSize) api.setSize(stage.clientWidth, stage.clientHeight);
  }
  const debounced = () => { clearTimeout(t); t = setTimeout(fit, 120); };
  new ResizeObserver(debounced).observe(stage);
  addEventListener('orientationchange', debounced);
  document.addEventListener('fullscreenchange', debounced);

  setTimeout(() => $('loading')?.remove(), 15000);
})();
