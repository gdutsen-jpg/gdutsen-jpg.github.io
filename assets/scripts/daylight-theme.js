(() => {
  const root = document.documentElement;
  // Local clock hours, with light paper and a slightly stronger accent tint.
  const overnight = [[248, 247, 252], [221, 218, 239]];
  const palette = [
    [0, ...overnight],
    [6, [251, 247, 249], [237, 217, 227]],
    [10, [252, 250, 244], [238, 226, 207]],
    [14, [246, 250, 247], [213, 231, 221]],
    [18, [252, 247, 248], [238, 213, 223]],
    [22, ...overnight],
    [24, ...overnight],
  ];

  function colorBetween(from, to, fraction) {
    const channels = from.map((value, index) => (
      value + (to[index] - value) * fraction
    ).toFixed(2));
    return `rgb(${channels.join(', ')})`;
  }

  function applyDaylight() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const nextIndex = palette.findIndex(([at]) => at > hour);
    const [start, paper, tint] = palette[nextIndex - 1];
    const [end, nextPaper, nextTint] = palette[nextIndex];
    const fraction = (hour - start) / (end - start);
    root.style.setProperty('--daylight-paper', colorBetween(paper, nextPaper, fraction));
    root.style.setProperty('--daylight-tint', colorBetween(tint, nextTint, fraction));
  }

  let timer;
  function syncDaylight() {
    clearInterval(timer);
    applyDaylight();
    if (!document.hidden) timer = setInterval(applyDaylight, 20_000);
  }

  syncDaylight();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('daylight-ready')));
  }
  document.addEventListener('visibilitychange', syncDaylight);
  window.addEventListener('pageshow', syncDaylight);
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
