import { onMount, onCleanup } from 'solid-js';

/**
 * Phone-only replacement for the live VineScene: the fully grown vines were
 * rendered offline (scripts/capture_vines.mjs) into three transparent
 * WebP strips — left edge, right edge and the top garland band. They scroll
 * with the page, "grow" via a scroll-driven clip-path, and sway with a cheap
 * CSS transform. Zero WebGL, zero GLB downloads on phones.
 *
 * props.onReady(): called once the images are decoded (or on timeout) so the
 * loading overlay can lift.
 */
export default function VineStrips(props) {
  let rootRef;
  const set = props.set || { width: 390, docH: 4000, side: 164, top: 340, navH: 64 };
  const base = `/media/vine_${set.width}`;

  onMount(() => {
    const root = rootRef;
    const docH = () => document.documentElement.scrollHeight;
    // Scale strips to this phone's width; the page height may differ slightly
    // from the capture, so the canes simply end where the capture ended.
    const fit = () => {
      const vw = document.documentElement.clientWidth;
      // Desktop fallback (software WebGL): keep the canes at a natural size
      // along the edges instead of stretching a phone capture to the width.
      const k = set.desktop ? 1.3 : vw / set.width;
      root.style.setProperty('--k', String(k));
      root.style.height = `${Math.min(docH(), Math.round(set.docH * k))}px`;
    };
    // The vines pre-exist along the whole page (no grow-in mask); they simply
    // scroll with the content and sway.
    let raf = 0;
    const onScroll = () => {};
    fit();
    window.addEventListener('resize', fit, { passive: true });
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);

    // Ready once the visible images are decoded (or after 2.5s).
    const imgs = Array.from(root.querySelectorAll('img'));
    let fired = false;
    const fire = () => { if (fired) return; fired = true; props.onReady?.(); };
    Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))).then(fire);
    const t = setTimeout(fire, 2500);

    onCleanup(() => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      ro.disconnect();
    });
  });

  const strip = (side) => `
    position: absolute; top: 0; ${side}: 0;
    width: calc(${set.side}px * var(--k, 1));
    height: 100%;
    object-fit: cover; object-position: top ${side};
    transform-origin: top center;
    animation: vine-sway-${side} ${side === 'left' ? '7.5s' : '8.5s'} ease-in-out infinite;
    will-change: transform; backface-visibility: hidden;
  `;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      class="vine-strips"
      style="
        position: absolute; left: 0; top: 0; width: 100%;
        pointer-events: none; z-index: 1; overflow: hidden;
        -webkit-mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%);
      "
    >
      <style>{`
        @keyframes vine-sway-left  { 0%,100% { transform: rotate(0deg) } 45% { transform: rotate(0.55deg) translateX(2px) } 75% { transform: rotate(0.2deg) translateX(1px) } }
        @keyframes vine-sway-right { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-0.55deg) translateX(-2px) } 80% { transform: rotate(-0.2deg) translateX(-1px) } }
        @keyframes vine-sway-top   { 0%,100% { transform: translateY(0) } 50% { transform: translateY(2px) } }
        @media (prefers-reduced-motion: reduce) { .vine-strips img { animation: none !important; } }
      `}</style>
      <div class="vine-strips-inner" style="position:absolute; inset:0;">
      <img src={`${base}_left.webp`} alt="" decoding="async" style={strip('left')} />
      <img src={`${base}_right.webp`} alt="" decoding="async" style={strip('right')} />
      {!set.desktop && <img
        src={`${base}_top.webp`}
        alt=""
        decoding="async"
        style={`position:absolute; top:0; left:0; width:100%; height: calc(${set.top}px * var(--k, 1)); object-fit: cover; object-position: top center; animation: vine-sway-top 8s ease-in-out infinite; will-change: transform; backface-visibility: hidden;`}
      />}
      </div>
    </div>
  );
}
