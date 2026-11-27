// ===== js/slider.js =====
export function setupBubbleSlider(trackEl, fillEl, thumbEl, bubbleEl, valEl, hiddenInput, onChange) {
  const min = parseFloat(hiddenInput.min);
  const max = parseFloat(hiddenInput.max);
  const step = parseFloat(hiddenInput.step);

  function pctFromVal(val) { return ((val - min) / (max - min)) * 100; }

  function valFromPct(pct) {
    const raw = min + (pct / 100) * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  }

  function update(val, showBubble) {
    const pct = pctFromVal(val);
    fillEl.style.width = pct + '%';
    thumbEl.style.left = pct + '%';
    hiddenInput.value = val.toFixed(1);
    valEl.textContent = parseFloat(val).toFixed(1);
    if (showBubble) {
      bubbleEl.textContent = parseFloat(val).toFixed(1) + '×';
      bubbleEl.classList.add('show');
      bubbleEl.style.left = 'calc(' + pct + '% + 0px)';
    }
  }

  // initial render
  update(parseFloat(hiddenInput.value), false);

  function handleDown(clientX) {
    thumbEl.classList.add('active');
    bubbleEl.classList.add('show');
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const val = valFromPct(pct);
    update(val, true);
    if (onChange) onChange(hiddenInput.id, val);
  }

  function handleMove(clientX) {
    if (!thumbEl.classList.contains('active')) return;
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const val = valFromPct(pct);
    update(val, true);
  }

  function handleUp() {
    thumbEl.classList.remove('active');
    bubbleEl.classList.remove('show');
  }

  // Mouse
  trackEl.addEventListener('mousedown', (e) => { e.preventDefault(); handleDown(e.clientX); });
  document.addEventListener('mousemove', (e) => handleMove(e.clientX));
  document.addEventListener('mouseup', handleUp);

  // Touch
  trackEl.addEventListener('touchstart', (e) => { handleDown(e.touches[0].clientX); }, { passive: true });
  document.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientX), { passive: true });
  document.addEventListener('touchend', handleUp);
}