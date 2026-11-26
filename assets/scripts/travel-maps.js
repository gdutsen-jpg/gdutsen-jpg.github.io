(() => {
  'use strict';

  const section = document.getElementById('travel-maps');
  if (!section) return;

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const collator = new Intl.Collator('zh-CN', { sensitivity: 'base' });
  const maps = globalThis.GomokuTravelMaps;

  function setupMap(panel) {
    const kind = panel.dataset.map;
    const dataset = maps?.[kind];
    const svg = panel.querySelector('.travel-map');
    const select = panel.querySelector('.travel-select');
    const toggle = panel.querySelector('.travel-toggle');
    const summary = panel.querySelector('.travel-summary');
    const visitedList = panel.querySelector('.travel-visited');
    if (!svg || !select || !toggle || !summary || !visitedList) return;

    if (!Array.isArray(dataset?.regions) || !dataset.regions.length || !Array.isArray(dataset.viewBox)) {
      select.disabled = true;
      toggle.disabled = true;
      summary.textContent = 'This map is unavailable.';
      return;
    }

    const regions = new Map(dataset.regions.map(region => [String(region.id), region]));
    const ordered = [...regions].sort(([, a], [, b]) => collator.compare(a.name, b.name));
    const storageKey = `gomoku-travel-map-${kind}-v1`;

    function readVisited(saved) {
      try {
        const ids = JSON.parse(saved ?? '[]');
        if (Array.isArray(ids)) return new Set(ids.filter(id => regions.has(id)));
      } catch {
        // Treat an unreadable saved list as empty.
      }
      return new Set();
    }

    let visited = new Set();
    let storageNote = '';
    try {
      visited = readVisited(localStorage.getItem(storageKey));
    } catch {
      storageNote = 'Browser storage is unavailable.';
    }

    svg.setAttribute('viewBox', dataset.viewBox.join(' '));
    const paths = new Map();
    const mapFragment = document.createDocumentFragment();
    for (const [id, region] of regions) {
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('d', region.path);
      path.setAttribute('class', 'travel-region');
      path.dataset.region = id;
      const label = document.createElementNS(svgNamespace, 'title');
      path.append(label);
      paths.set(id, { path, label });
      mapFragment.append(path);
    }
    svg.replaceChildren(mapFragment);

    const options = document.createDocumentFragment();
    const placeholder = select.querySelector('option[value=""]') || document.createElement('option');
    placeholder.value = '';
    if (!placeholder.textContent) placeholder.textContent = 'Choose an area';
    options.append(placeholder);
    for (const [id, region] of ordered) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = region.name;
      options.append(option);
    }
    select.replaceChildren(options);

    function updateControl() {
      const id = select.value;
      toggle.disabled = !regions.has(id);
      toggle.textContent = visited.has(id) ? 'Remove mark' : 'Mark visited';
    }

    function render(detail = '') {
      const items = document.createDocumentFragment();
      for (const [id, region] of ordered) {
        const { path, label } = paths.get(id);
        const isVisited = visited.has(id);
        path.classList.toggle('is-visited', isVisited);
        label.textContent = isVisited ? `${region.name} · Visited` : region.name;
        if (isVisited) {
          const item = document.createElement('li');
          item.textContent = region.name;
          items.append(item);
        }
      }
      visitedList.replaceChildren(items);
      visitedList.hidden = visited.size === 0;
      updateControl();
      const total = `${visited.size} ${visited.size === 1 ? 'place' : 'places'} visited.`;
      summary.textContent = [detail, total, storageNote].filter(Boolean).join(' ');
    }

    function toggleVisit(id) {
      if (!regions.has(id)) return;
      const wasVisited = visited.delete(id);
      if (!wasVisited) visited.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...visited]));
        storageNote = '';
      } catch {
        storageNote = 'This browser could not save the map.';
      }
      select.value = id;
      const name = regions.get(id).name;
      render(wasVisited ? `Removed ${name}.` : `Marked ${name} as visited.`);
    }

    svg.addEventListener('click', event => {
      const path = event.target.closest?.('path[data-region]');
      if (path) toggleVisit(path.dataset.region);
    });
    select.addEventListener('change', updateControl);
    toggle.addEventListener('click', () => toggleVisit(select.value));
    window.addEventListener('storage', event => {
      if (event.key !== storageKey && event.key !== null) return;
      visited = readVisited(event.newValue);
      render();
    });

    render();
  }

  section.querySelectorAll('.travel-map-panel[data-map]').forEach(setupMap);
})();
