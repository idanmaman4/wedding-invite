import { onMount, onCleanup } from 'solid-js';
import { animateHeroText } from '../animations/gsapSetup';
import { isSlowGpu } from '../gpu';

export default function Hero() {
  let canvasRef, titleRef, subtitleRef, dateRef, venueRef, scrollRef;
  let scene;

  onMount(() => {
    // The three.js hero chunk loads after first paint (text + vines render first).
    let disposed = false;
    // Software WebGL renders the particle rings at ~1fps and starves the page;
    // the hero reads fine without them.
    if (!isSlowGpu()) import('../three/WeddingScene').then(({ WeddingScene }) => {
      if (disposed) return;
      scene = new WeddingScene(canvasRef);
      if (import.meta.env.DEV) window.__hero = scene; // dev-only debug handle
    });
    onCleanup(() => { disposed = true; });

    // Animate hero text characters
    animateHeroText(titleRef);

    import('gsap').then(({ gsap }) => {
      // fromTo (not from): these elements start at inline opacity:0, so a plain
      // `from` would tween 0 -> 0 and leave them invisible. Same timings as before.
      gsap.fromTo(subtitleRef, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.2, ease: 'power3.out', delay: 1.5 });
      gsap.fromTo(dateRef,     { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.2, ease: 'power3.out', delay: 1.8 });
      gsap.fromTo(venueRef,    { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1.0, ease: 'power3.out', delay: 2.1 });
      gsap.fromTo(scrollRef,   { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 1.0, ease: 'power2.out', delay: 2.6 });
      gsap.to(scrollRef, {
        opacity: 0.25,
        duration: 1.6,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        delay: 3.2,
      });
    });
  });

  onCleanup(() => scene?.dispose());

  return (
    <section
      id="hero"
      class="relative w-full overflow-hidden flex items-center justify-center"
      style="min-height: 100vh; min-height: 100svh"
    >
      {/* Three.js canvas — white background, gold rings, red roses */}
      <canvas
        ref={canvasRef}
        class="absolute inset-0 w-full h-full"
        style="display:block;z-index:2"
      />

      {/* Hero text panel — no glass card; text uses glow shadow to stay readable over the 3D scene */}
      <div
        class="hero-panel relative z-10 text-center pointer-events-none select-none px-4 sm:px-10 py-12"
        style="
          max-width: 640px;
          width: 90%;
        "
      >
        {/* Eyebrow */}
        <p
          ref={subtitleRef}
          class="font-sans text-sm font-medium tracking-[0.12em] mb-6"
          style="opacity:0; color: rgba(26,10,10,0.55); text-shadow: 0 2px 16px rgba(253,250,247,0.9), 0 1px 2px rgba(253,250,247,0.6)"
        >
          אתם מוזמנים לחגוג איתנו
        </p>

        {/* Decorative top flourish — in RTL the first line sits on the right, so its
            gradient fades toward the outer (right) edge and brightens toward the star */}
        <div class="flex items-center justify-center gap-3 mb-5">
          <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
          <span class="text-base" style="color: #C9A96E">✦</span>
          <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
        </div>

        {/* Main title — tri-color "Idan & Vered". Stays Latin in Cormorant Garamond
            by design; dir="ltr" keeps animateHeroText's per-character inline-blocks
            flowing left-to-right under the page's RTL root. */}
        <h1
          ref={titleRef}
          dir="ltr"
          class="font-light leading-none"
          style="font-family: 'Cormorant Garamond', serif; font-size: clamp(3rem, 9vw, 7rem); text-shadow: 0 2px 24px rgba(253,250,247,0.9), 0 1px 3px rgba(253,250,247,0.6)"
        >
          <span style="color: #1A0A0A">Idan</span>
          <span style="color: #C9A96E; margin: 0 0.18em">&amp;</span>
          <span style="color: #1A0A0A">Vered</span>
        </h1>

        {/* Bottom flourish */}
        <div class="flex items-center justify-center gap-3 mt-5 mb-6">
          <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
          <span class="text-base" style="color: #C9A96E">✦</span>
          <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
        </div>

        {/* Date */}
        <div
          ref={dateRef}
          class="flex items-center justify-center gap-4 mb-4"
          style="opacity:0"
        >
          <div class="hidden sm:block h-px w-12" style="background: rgba(201,169,110,0.5)" />
          <p class="font-serif text-2xl" style="color: #C9A96E; text-shadow: 0 2px 18px rgba(253,250,247,0.9), 0 1px 3px rgba(253,250,247,0.6)"><span class="whitespace-nowrap">י״ד בחשוון תשפ״ז</span><span class="hidden sm:inline"> · </span><span class="block sm:inline">25.10.2026</span></p>
          <div class="hidden sm:block h-px w-12" style="background: rgba(201,169,110,0.5)" />
        </div>

        {/* Venue */}
        <p
          ref={venueRef}
          class="font-sans text-base tracking-[0.06em]"
          style="opacity:0; color: rgba(26,10,10,0.6); text-shadow: 0 2px 16px rgba(253,250,247,0.9), 0 1px 2px rgba(253,250,247,0.6)"
        >
          אולם האירועים תרין · ראשון לציון
        </p>
      </div>

      {/* Scroll indicator */}
      <div
        ref={scrollRef}
        class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
        style="opacity:0"
      >
        <span class="font-sans text-xs font-medium tracking-[0.12em]" style="color: rgba(26,10,10,0.45); text-shadow: 0 2px 12px rgba(253,250,247,0.9), 0 1px 2px rgba(253,250,247,0.6)">גללו</span>
        <div class="w-px h-10" style="background: linear-gradient(to bottom, rgba(201,169,110,0.6), transparent)" />
      </div>
    </section>
  );
}
