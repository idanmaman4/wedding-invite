import { ErrorBoundary, onMount, onCleanup, createSignal, Show } from 'solid-js';
import VineStrips from './components/VineStrips';
import vineSets from './vineSets.json';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Details from './components/Details';
import RSVPForm from './components/RSVPForm';
import { gsap } from './animations/gsapSetup';
import { isSlowGpu } from './gpu';

function ErrorFallback(err) {
  return (
    <div style="padding:40px;color:#1A0A0A;font-family:monospace;background:#FDFAF7;min-height:100vh">
      <p style="font-size:1.2rem;margin-bottom:1rem;color:#B22222">משהו השתבש</p>
      <pre style="color:#8B6347;font-size:0.8rem">{String(err)}</pre>
    </div>
  );
}

export default function HomePage() {
  let vineCanvasRef;
  let vineScene;
  let loaderRef;

  // Phones get pre-rendered vine strips (no WebGL); wider screens run the live
  // scene unless WebGL would run in software, where they get the widest strip
  // set at a fixed scale instead. `?vine=live` forces the live scene (used by
  // the strip capture).
  const pickStrips = () => {
    if (typeof window === 'undefined') return null;
    if (new URLSearchParams(location.search).has('vine')) return null;
    if (!vineSets.length) return null;
    const vw = document.documentElement.clientWidth;
    if (vw >= 768) {
      if (!isSlowGpu()) return null;
      return { ...vineSets[vineSets.length - 1], desktop: true };
    }
    return vineSets.reduce((a, b) => (Math.abs(b.width - vw) < Math.abs(a.width - vw) ? b : a));
  };
  const [stripSet] = createSignal(pickStrips());
  let stripsReady;
  const stripsReadyPromise = new Promise((res) => { stripsReady = res; });

  onMount(() => {
    if (stripSet()) {
      vineScene = { ready: stripsReadyPromise, dispose() {} };
      if (vineCanvasRef) vineCanvasRef.style.display = 'none';
    } else {
      // The live scene (three + GLTF/DRACO loaders) is code-split so phones on
      // the strips path never download it. Wrap it so the loader contract
      // (`ready` promise, `dispose`) holds while the chunk is still in flight.
      let disposed = false;
      const live = import('./three/VineScene').then(({ VineScene }) => {
        if (disposed) return null;
        const scene = new VineScene(vineCanvasRef);
        if (import.meta.env.DEV) window.__vine = scene; // dev-only debug handle
        return scene;
      });
      vineScene = {
        ready: live.then((scene) => scene?.ready),
        dispose() { disposed = true; live.then((scene) => scene?.dispose(), () => {}); },
      };
    }
    if (import.meta.env.DEV) window.__vine = vineScene; // dev-only debug handle (live path swaps in the real scene once its chunk lands)

    // --- Loading overlay: dismiss once the vine scene is ready (or on a hard timeout) ---
    let readyFired = false;
    let hardTimeout;
    const fireReady = () => {
      if (readyFired) return;
      readyFired = true;
      clearTimeout(hardTimeout);
      // Signal at the START of the fade so the hero entrance runs under the overlay.
      window.__weddingReady = true;
      window.dispatchEvent(new Event('wedding:ready'));
      if (!loaderRef) return;
      gsap.to(loaderRef, {
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        onComplete: () => { loaderRef.style.display = 'none'; },
      });
    };

    if (vineScene?.ready && typeof vineScene.ready.then === 'function') {
      vineScene.ready.then(fireReady, fireReady);
    } else {
      setTimeout(fireReady, 1500);
    }
    // Never trap the visitor behind the loader.
    hardTimeout = setTimeout(fireReady, 8000);
    onCleanup(() => clearTimeout(hardTimeout));
  });
  onCleanup(() => vineScene?.dispose());

  return (
    <>
      {/* Loading overlay — sits above the nav (z-50) until the vine scene is ready */}
      <div
        ref={loaderRef}
        class="fixed inset-0 z-[60] flex items-center justify-center"
        style="background:#FDFAF7"
        role="status"
        aria-live="polite"
        aria-label="טוען"
      >
        <style>{`
          @keyframes wedding-loader-spin { to { transform: rotate(360deg); } }
          .wedding-loader-ring { animation: wedding-loader-spin 1.1s linear infinite; }
          @media (prefers-reduced-motion: reduce) {
            .wedding-loader-ring { animation: none; }
          }
        `}</style>
        <div class="flex flex-col items-center gap-6">
          <span
            class="font-serif font-light"
            style="font-size:2rem;color:#C9A96E;letter-spacing:0.1em;line-height:1"
          >
            ע &amp; ו
          </span>
          <div
            class="wedding-loader-ring"
            style="width:40px;height:40px;border:1.5px solid rgba(201,169,110,0.25);border-top-color:#C9A96E;border-radius:50%"
          />
          <span
            class="font-sans text-xs font-medium tracking-[0.12em]"
            style="color:rgba(26,10,10,0.45)"
          >
            מכינים את הגן
          </span>
        </div>
      </div>

      <Show when={stripSet()}>
        <VineStrips set={stripSet()} onReady={() => stripsReady?.()} />
      </Show>
      <canvas
        ref={vineCanvasRef}
        aria-hidden="true"
        style="
          position:fixed;inset:0;pointer-events:none;z-index:1;
          -webkit-mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%);
          mask-image: linear-gradient(to right, transparent 0, black 10px, black calc(100% - 10px), transparent 100%);
        "
      />
      <Nav />
      <main>
        <ErrorBoundary fallback={ErrorFallback}>
          <Hero />
        </ErrorBoundary>
        <Details />
        <RSVPForm />

        <footer
          class="py-16 text-center"
          style="border-top: 1px solid rgba(201,169,110,0.2)"
        >
          {/* Decorative flourish */}
          <div class="flex items-center justify-center gap-3 mb-6">
            <div class="h-px w-16" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.4))" />
            <span style="color: #C9A96E; font-size: 1.1rem">✦</span>
            <div class="h-px w-16" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.4))" />
          </div>

          {/* Names */}
          <p
            class="font-serif text-3xl font-light mb-2"
            style="color: #1A0A0A"
          >
            <span style="color: #1A0A0A">עידן</span>
            <span style="color: #C9A96E; margin: 0 0.2em">&amp;</span>
            <span style="color: #1A0A0A">ורד</span>
          </p>

          <p
            class="font-sans text-sm font-normal tracking-[0.1em] mb-6"
            style="color: rgba(26,10,10,0.5)"
          >
            25 באוקטובר 2026 · אולם תרין, ראשון לציון
          </p>

          <div class="h-px w-16 mx-auto mb-6" style="background: rgba(201,169,110,0.25)" />

          <p class="font-sans text-sm" style="color: rgba(26,10,10,0.72)">
            נעשה באהבה
          </p>
        </footer>
      </main>
    </>
  );
}
