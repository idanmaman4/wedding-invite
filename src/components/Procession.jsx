import { onMount, onCleanup } from 'solid-js';
import { gsap, ScrollTrigger } from '../animations/gsapSetup';

/**
 * 3D procession standing on top of the RSVP card: once the card scrolls into
 * view the bride and groom walk in from either side and meet under the canopy
 * (time-based, plays once per entry). Renders nothing (and collapses) if
 * procession.glb is absent or WebGL is unavailable.
 */
export default function Procession() {
  let wrapRef;
  let canvasRef;

  onMount(() => {
    let scene = null;
    let trigger = null;
    let tween = null;
    let disposed = false;
    const hide = () => {
      if (wrapRef) wrapRef.style.display = 'none';
      trigger?.kill();
      trigger = null;
      ScrollTrigger.refresh();
    };

    onCleanup(() => {
      disposed = true;
      tween?.kill();
      trigger?.kill();
      scene?.dispose();
    });

    // ProcessionScene (three GLTF/DRACO loaders + the GLB) is only fetched on
    // this fallback path, so the clip-only page never downloads it.
    import('../three/ProcessionScene').then(({ ProcessionScene }) => {
      if (disposed) return;
      try {
        scene = new ProcessionScene(canvasRef);
      } catch (e) {
        scene = null;
      }
      if (!scene || !scene.available) { hide(); return; }
      // Probe handles: dev, or the offline clip capture (?live=1 on a static build).
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('live')) { window.__procession = scene; window.__gsap = gsap; }

      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const state = { p: 0 };
      let played = false;
      const play = () => {
        played = true;
        tween?.kill();
        state.p = 0;
        scene.setProgress(0);
        // Unhurried walk then a gentle arrival; linear so stride pacing is honest.
        tween = gsap.to(state, {
          p: 1, duration: 7.5, ease: 'none', delay: 0.3,
          onUpdate: () => scene.setProgress(state.p),
        });
      };
      const reset = () => { played = false; tween?.kill(); state.p = 0; scene.setProgress(0); };
      scene.__stopWalk = () => tween?.kill(); // probe hook (used by the capture)

      // Arm the walk only once the model is actually on screen-ready: a trigger
      // that fires before the GLB has loaded would finish the walk unseen.
      scene.ready.then((ok) => {
        if (!ok) { hide(); return; }
        // The rest of the page animates regardless of the OS motion setting, so
        // the walk plays too; reduced-motion only drops the idle sway.
        if (reduced) scene.idle = false;
        trigger = ScrollTrigger.create({
          trigger: wrapRef,
          start: 'top 95%',
          end: 'bottom top',
          onEnter: play,
          onEnterBack: play,
          onLeave: reset,
          onLeaveBack: reset,
        });
        // Already on screen when the model arrived: walk now.
        if (!played && trigger.isActive) play();
        // Belt and braces: the scene's own visibility observer.
        scene.onInView = () => { if (!played) play(); };
        if (!played && scene.inView) play();
      });
    }, hide);
  });

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      class="procession"
      style="
        position: relative;
        width: calc(100% + 80px);
        margin: -32px -40px 22px;
        aspect-ratio: 2.1 / 1;
        min-height: 170px;
        max-height: min(250px, 29vh); /* short laptop viewports: keep title + stage + button in one view */
        pointer-events: none;
        overflow: hidden;
        background:
          radial-gradient(ellipse 70% 38% at 50% 100%, rgba(201,169,110,0.20), rgba(201,169,110,0) 100%),
          linear-gradient(to bottom, rgba(253,250,247,0.9), rgba(255,255,255,0) 45%);
      "
    >
      <canvas ref={canvasRef} style="display: block; width: 100%; height: 100%;" />
      {/* stage edge: hairline the figures stand on, fading at both ends */}
      <div style="position:absolute; left:0; right:0; bottom:0; height:1px; background: linear-gradient(to right, transparent, rgba(201,169,110,0.55) 20%, rgba(201,169,110,0.55) 80%, transparent);" />
    </div>
  );
}
