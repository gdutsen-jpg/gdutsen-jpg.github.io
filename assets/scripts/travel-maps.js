(() => {
  'use strict';

  const section = document.getElementById('travel-maps');
  if (!section) return;

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const collator = new Intl.Collator('zh-CN', { sensitivity: 'base' });
  const maps = globalThis.GomokuTravelMaps;
  const publishedVisits = globalThis.GomokuPublishedContent?.visited;

  function setupMap(panel) {
    const kind = panel.dataset.map;
    const dataset = maps?.[kind];
    const svg = panel.querySelector('.travel-map');
    const summary = panel.querySelector('.travel-summary');
    const visitedList = panel.querySelector('.travel-visited');
    if (!svg || !summary || !visitedList) return;

    if (!Array.isArray(dataset?.regions) || !dataset.regions.length || !Array.isArray(dataset.viewBox)) {
      summary.textContent = 'This map is unavailable.';
      return;
    }

    const regions = new Map(dataset.regions.map(region => [String(region.id), region]));
    const configuredVisits = publishedVisits?.[kind];
    const visited = new Set(Array.isArray(configuredVisits) ? configuredVisits.filter(id => regions.has(id)) : []);
    const total = `${visited.size} ${visited.size === 1 ? 'place' : 'places'} visited.`;

    svg.setAttribute('viewBox', dataset.viewBox.join(' '));
    const mapFragment = document.createDocumentFragment();
    for (const [id, region] of regions) {
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('d', region.path);
      path.setAttribute('class', 'travel-region');
      path.classList.toggle('is-visited', visited.has(id));
      path.dataset.region = id;
      const label = document.createElementNS(svgNamespace, 'title');
      label.textContent = visited.has(id) ? `${region.name} · Visited` : region.name;
      path.append(label);
      mapFragment.append(path);
    }
    svg.replaceChildren(mapFragment);

    const names = [...visited].map(id => regions.get(id).name).sort(collator.compare);
    const items = names.map(name => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    });
    visitedList.replaceChildren(...items);
    visitedList.hidden = items.length === 0;
    summary.textContent = total;

    svg.addEventListener('click', event => {
      const label = event.target.closest?.('path[data-region]')?.querySelector('title');
      if (label) summary.textContent = `${label.textContent}. ${total}`;
    });
  }

  section.querySelectorAll('.travel-map-panel[data-map]').forEach(setupMap);
})();
