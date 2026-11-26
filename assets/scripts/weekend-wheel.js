(() => {
  'use strict';

  const wheel = document.querySelector('#weekend-wheel');
  if (!wheel) return;

  const disc = wheel.querySelector('#weekend-disc');
  const spin = wheel.querySelector('#weekend-spin');
  const result = wheel.querySelector('#weekend-result');
  const context = disc.getContext('2d');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fullTurn = 2 * Math.PI;
  const palette = ['#edd9e6', '#f5e1d7', '#e3e9d8', '#dfe7f0', '#ede0ef', '#f4e9d6', '#e7e1ef'];
  const configuredActivities = globalThis.GomokuPublishedContent?.activities;
  const activities = Array.isArray(configuredActivities)
    ? configuredActivities.filter(activity => typeof activity === 'string').map(activity => activity.trim()).filter(Boolean)
    : [];
  let rotation = 0;
  let animation = null;

  function fitLabel(text, width) {
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
    context.fillStyle = '#f3eef3';
    context.fill();

    const slice = fullTurn / Math.max(1, activities.length);
    const fontSize = Math.max(11, Math.min(17, radius * 0.105));
    const hasLabelSpace = activities.length <= 1 || slice * radius * 0.57 >= fontSize + 2;

    activities.forEach((activity, index) => {
      const start = -Math.PI / 2 + slice * index;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, start + slice);
      context.closePath();
      context.fillStyle = palette[index % palette.length];
      context.fill();

      if (activities.length > 1) {
        context.lineWidth = 1;
        context.strokeStyle = '#fffcfa';
        context.stroke();
      }

      if (!hasLabelSpace) return;

      const mid = start + slice / 2;
      const upsideDown = Math.cos(mid) < 0;
      context.save();
      context.translate(center, center);
      context.rotate(mid + (upsideDown ? Math.PI : 0));
      context.font = `600 ${fontSize}px "Gomoku Pixel", "Microsoft YaHei", sans-serif`;
      context.fillStyle = '#443344';
      context.textAlign = upsideDown ? 'left' : 'right';
      context.textBaseline = 'middle';
      const inset = radius * 0.88 * (upsideDown ? -1 : 1);
      context.fillText(fitLabel(activity, radius * 0.66), inset, 0);
      context.restore();
    });
  }

  function setRotation(degrees) {
    rotation = degrees;
    disc.style.transform = `rotate(${degrees}deg)`;
  }

  function showSelection(activity, degrees) {
    setRotation(degrees);
    spin.disabled = false;
    result.textContent = `Selected: ${activity}`;
  }

  function spinWheel() {
    if (animation || !activities.length) return;

    const index = Math.floor(Math.random() * activities.length);
    const activity = activities[index];
    // Bring the selected sector's midpoint to the stationary top pointer.
    const destination = 360 - (index + 0.5) * (360 / activities.length);
    if (motionPreference.matches || typeof disc.animate !== 'function') {
      showSelection(activity, destination);
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
      showSelection(activity, destination);
      currentSpin.cancel();
    }, () => {
      if (animation !== currentSpin) return;
      animation = null;
      spin.disabled = false;
      result.textContent = '';
    });
  }

  if (activities.length) disc.setAttribute('aria-label', 'Activity wheel: ' + activities.join(', '));
  spin.disabled = activities.length === 0;
  result.textContent = activities.length ? '' : 'No activities yet.';
  spin.addEventListener('click', spinWheel);
  drawWheel();
  if (document.fonts) document.fonts.ready.then(drawWheel);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(drawWheel).observe(disc);
  } else {
    window.addEventListener('resize', drawWheel);
  }
})();
