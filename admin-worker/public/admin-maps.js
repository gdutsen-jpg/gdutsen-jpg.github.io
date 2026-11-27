"use strict";

globalThis.createGomokuMapEditor = (() => {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const collator = new Intl.Collator("zh-CN");

  function makePanel(panel, onEdit) {
    const kind = panel.dataset.visitMap;
    const dataset = globalThis.GomokuTravelMaps?.[kind];
    if (!Array.isArray(dataset?.viewBox) || !dataset?.regions?.length) {
      return null;
    }

    const svg = panel.querySelector(".visited-map");
    const select = panel.querySelector(".visited-select");
    const toggle = panel.querySelector(".visited-toggle");
    const count = panel.querySelector(".visited-count");
    const paths = new Map();
    const updates = new Map();
    let published = new Set();
    let locked = true;

    svg.setAttribute("viewBox", dataset.viewBox.join(" "));
    const geometry = document.createDocumentFragment();
    for (const { id, name, path: coordinates } of dataset.regions) {
      const path = document.createElementNS(svgNamespace, "path");
      const title = document.createElementNS(svgNamespace, "title");
      path.dataset.region = String(id);
      path.setAttribute("d", coordinates);
      path.append(title);
      geometry.append(path);
      paths.set(String(id), { path, title, name });
    }
    svg.append(geometry);

    const options = document.createDocumentFragment();
    const regions = [...paths].sort(([, first], [, second]) => collator.compare(first.name, second.name));
    for (const [id, { name }] of regions) {
      options.append(new Option(name, id));
    }
    select.append(options);

    function isVisited(id) {
      return updates.get(id) ?? published.has(id);
    }

    function updateSelection() {
      for (const [id, { path }] of paths) {
        path.classList.toggle("is-selected", select.value === id);
      }
      toggle.textContent = isVisited(select.value) ? "取消标记" : "标记为去过";
      toggle.disabled = locked || !paths.has(select.value);
    }

    function render() {
      let total = 0;
      for (const [id, { path, title, name }] of paths) {
        const visited = isVisited(id);
        path.classList.toggle("is-visited", visited);
        title.textContent = visited ? `${name} · 去过` : name;
        total += Number(visited);
      }
      count.textContent = `已标记 ${total} 处`;
      updateSelection();
    }

    function toggleVisit(id) {
      if (locked || !paths.has(id)) {
        return;
      }
      const visited = !isVisited(id);
      if (visited === published.has(id)) {
        updates.delete(id);
      } else {
        updates.set(id, visited);
      }
      select.value = id;
      render();
      onEdit();
    }

    svg.addEventListener("click", (event) => {
      const region = event.target.closest("path[data-region]");
      if (region) {
        toggleVisit(region.dataset.region);
      }
    });
    select.addEventListener("change", updateSelection);
    toggle.addEventListener("click", () => toggleVisit(select.value));
    render();

    return {
      kind,
      changes() {
        return [...updates].sort(([first], [second]) => first.localeCompare(second))
          .map(([id, visited]) => ({ map: kind, id, visited }));
      },
      setPublished(ids) {
        published = new Set(ids.filter((id) => paths.has(id)));
        for (const [id, desired] of updates) {
          if (desired === published.has(id)) {
            updates.delete(id);
          }
        }
        render();
      },
      markSaved(changes) {
        for (const { map, id, visited } of changes) {
          if (map === kind) {
            if (visited) {
              published.add(id);
            } else {
              published.delete(id);
            }
            updates.delete(id);
          }
        }
        render();
      },
      setLocked(value) {
        locked = value;
        svg.classList.toggle("is-editable", !locked);
        select.disabled = locked;
        toggle.disabled = locked || !paths.has(select.value);
      }
    };
  }

  return (section, onEdit) => {
    const error = section.querySelector("#visited-map-error");
    const maps = section.querySelector(".visited-maps");
    const panels = Array.from(section.querySelectorAll("[data-visit-map]"))
      .map((panel) => makePanel(panel, onEdit));
    const geometryAvailable = panels.length === 2 && panels.every(Boolean);
    let ready = false;

    function showError(message) {
      error.textContent = message;
      error.hidden = !message;
    }

    if (!geometryAvailable) {
      maps.hidden = true;
      showError("地图加载失败。请刷新管理页。");
    }

    return {
      changes() {
        return geometryAvailable ? panels.flatMap((panel) => panel.changes()) : [];
      },
      receive(visited) {
        if (!geometryAvailable) {
          return;
        }
        ready = panels.every(({ kind }) => Array.isArray(visited?.[kind]));
        showError(ready ? "" : "暂时无法读取已保存的足迹。");
        if (ready) {
          panels.forEach((panel) => panel.setPublished(visited[panel.kind]));
        }
      },
      markSaved(changes) {
        panels.forEach((panel) => panel.markSaved(changes));
      },
      setLocked(locked) {
        if (geometryAvailable) {
          panels.forEach((panel) => panel.setLocked(locked || !ready));
        }
        return locked || !ready;
      }
    };
  };
})();
