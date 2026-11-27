(() => {
  'use strict';

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fullTurn = 2 * Math.PI;
  const palette = ['#edd9e6', '#f5e1d7', '#e3e9d8', '#dfe7f0', '#ede0ef', '#f4e9d6', '#e7e1ef'];
  const root = document.documentElement;
  const themeSource = document.querySelector('.album-wheels') ?? root;
  const canMix = window.CSS?.supports('color', 'color-mix(in srgb, white, black)');
  let colors;
  let colorKey;

  function readWheelColors() {
    const style = getComputedStyle(themeSource);
    const tint = style.getPropertyValue('--wheel-tint').trim();
    const base = style.getPropertyValue('--wheel-base').trim() || '#f3eef3';
    const divider = style.getPropertyValue('--wheel-divider').trim() || '#fffcfa';
    const label = style.getPropertyValue('--wheel-label').trim() || '#443344';
    const key = [tint, base, divider, label].join('|');
    if (key === colorKey) return false;
    colorKey = key;
    const sectors = canMix && tint
      ? palette.map(color => 'color-mix(in srgb, ' + color + ' 48%, ' + tint + ')')
      : palette;
    colors = { base, divider, label, sectors };
    return true;
  }

  readWheelColors();
  const wheelSettings = {
    activities: {
      name: 'Activity wheel',
      empty: 'No activities yet.',
      fallback: [],
    },
    cuisines: {
      name: 'Cuisine wheel',
      empty: 'No cuisines yet.',
      fallback: [
        '粤菜', '川菜', '湘菜', '江浙菜', '西北菜', '云贵菜', '东北菜', '火锅',
        '烧烤烤肉', '海鲜', '小吃简餐', '自助餐', '日式料理', '韩式料理', '东南亚菜', '西餐',
      ],
    },
  };

  function setupWheel(wheel) {
    const kind = wheel.dataset.wheel || 'activities';
    const settings = wheelSettings[kind];
    const disc = wheel.querySelector('.weekend-dial canvas');
    const spin = wheel.querySelector('.weekend-play button');
    const result = wheel.querySelector('.weekend-play [role="status"]');
    if (!settings || !disc || !spin || !result) return;

    const context = disc.getContext('2d');
    const configured = globalThis.GomokuPublishedContent?.[kind];
    const options = Array.isArray(configured)
      ? configured.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean)
      : settings.fallback;
    let rotation = 0;
    let animation = null;

    function fitLabel(text, width, fontSize) {
      const font = size => `600 ${size}px "Gomoku Pixel", "Microsoft YaHei", sans-serif`;
      context.font = font(fontSize);
      const measured = context.measureText(text).width;
      if (measured <= width) return text;

      context.font = font(Math.max(10, Math.floor(fontSize * width / measured)));
      if (context.measureText(text).width <= width) return text;

      let visible = '';
      for (const character of text) {
        if (context.measureText(visible + character + '…').width > width) break;
        visible += character;
      }
      return `${visible}…`;
    }

    function drawWheel() {
      const size = disc.clientWidth;
      if (!context || size < 4) return;

      const pixels = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
      if (disc.width !== pixels || disc.height !== pixels) {
        disc.width = pixels;
        disc.height = pixels;
      }
      context.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
      context.clearRect(0, 0, size, size);

      const center = size / 2;
      const radius = center - 1;
      context.beginPath();
      context.arc(center, center, radius, 0, fullTurn);
      context.fillStyle = colors.base;
      context.fill();

      const slice = fullTurn / Math.max(1, options.length);
      const fontSize = Math.max(11, Math.min(17, radius * 0.105));
      const hasLabelSpace = options.length <= 1 || slice * radius * 0.57 >= fontSize + 2;

      options.forEach((option, index) => {
        const start = -Math.PI / 2 + slice * index;
        context.beginPath();
        context.moveTo(center, center);
        context.arc(center, center, radius, start, start + slice);
        context.closePath();
        context.fillStyle = colors.sectors[index % colors.sectors.length];
        context.fill();

        if (options.length > 1) {
          context.lineWidth = 1;
          context.strokeStyle = colors.divider;
          context.stroke();
        }

        if (!hasLabelSpace) return;

        const mid = start + slice / 2;
        const upsideDown = Math.cos(mid) < 0;
        context.save();
        context.translate(center, center);
        context.rotate(mid + (upsideDown ? Math.PI : 0));
        context.fillStyle = colors.label;
        context.textAlign = upsideDown ? 'left' : 'right';
        context.textBaseline = 'middle';
        const inset = radius * 0.88 * (upsideDown ? -1 : 1);
        const label = fitLabel(option, radius * 0.66, fontSize);
        context.fillText(label, inset, 0);
        context.restore();
      });
    }

    function showSelection(option, degrees) {
      rotation = degrees;
      disc.style.transform = `rotate(${degrees}deg)`;
      spin.disabled = false;
      result.textContent = `Selected: ${option}`;
    }

    function spinWheel() {
      if (animation || !options.length) return;
      const index = Math.floor(Math.random() * options.length);
      const option = options[index];
      // Bring the selected sector's midpoint to the stationary top pointer.
      const destination = 360 - (index + 0.5) * (360 / options.length);
      if (motionPreference.matches || typeof disc.animate !== 'function') {
        showSelection(option, destination);
        return;
      }

      const distance = (destination - rotation + 360) % 360;
      const currentSpin = disc.animate([
        { transform: `rotate(${rotation}deg)` },
        { transform: `rotate(${rotation + 4 * 360 + distance}deg)` },
      ], { duration: 3000, easing: 'cubic-bezier(.16,.72,.18,1)', fill: 'forwards' });
      animation = currentSpin;
      spin.disabled = true;
      result.textContent = 'Spinning…';

      currentSpin.finished.then(() => {
        if (animation !== currentSpin) return;
        animation = null;
        showSelection(option, destination);
        currentSpin.cancel();
      }, () => {
        if (animation !== currentSpin) return;
        animation = null;
        spin.disabled = false;
        result.textContent = '';
      });
    }

    if (options.length) disc.setAttribute('aria-label', `${settings.name}: ${options.join(', ')}`);
    spin.disabled = options.length === 0;
    result.textContent = options.length ? '' : settings.empty;
    spin.addEventListener('click', spinWheel);
    drawWheel();
    if (document.fonts) document.fonts.ready.then(drawWheel);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(drawWheel).observe(disc);
    } else {
      window.addEventListener('resize', drawWheel);
    }
    return drawWheel;
  }

  const redraws = Array.from(document.querySelectorAll('.weekend-wheel'), setupWheel).filter(Boolean);
  if (!redraws.length) return;

  const themeProperties = new Set(['--daylight-paper', '--daylight-tint']);
  const transitioning = new Set();
  let themeFrame = 0;
  let lastRead = -Infinity;

  function queueThemeRedraw() {
    if (!themeFrame) themeFrame = requestAnimationFrame(refreshTheme);
  }

  function refreshTheme(time) {
    themeFrame = 0;
    // The page interpolates daylight colors over 18 seconds. A few samples
    // per second are enough to catch the visible palette changes.
    if (!transitioning.size || time - lastRead >= 125) {
      lastRead = time;
      if (readWheelColors()) redraws.forEach(draw => draw());
    }
    if (transitioning.size) queueThemeRedraw();
  }

  function daylightTransition(event) {
    if (event.target !== root || !themeProperties.has(event.propertyName)) return;
    if (event.type === 'transitionrun') transitioning.add(event.propertyName);
    else transitioning.delete(event.propertyName);
    queueThemeRedraw();
  }

  root.addEventListener('transitionrun', daylightTransition);
  root.addEventListener('transitionend', daylightTransition);
  root.addEventListener('transitioncancel', daylightTransition);
  // Reduced-motion transitions apply the final colors immediately.
  new MutationObserver(queueThemeRedraw).observe(root, { attributes: true, attributeFilter: ['style'] });
})();
