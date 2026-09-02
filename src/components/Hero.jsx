import { onMount, onCleanup } from 'solid-js';
import { WeddingScene } from '../three/WeddingScene';
import { animateHeroText } from '../animations/gsapSetup';

export default function Hero() {
  let canvasRef, titleRef, subtitleRef, dateRef, venueRef, scrollRef;
  let scene;

  onMount(() => {
    scene = new WeddingScene(canvasRef);

    // Animate hero text characters
    animateHeroText(titleRef);

    import('gsap').then(({ gsap }) => {
      gsap.from(subtitleRef, { opacity: 0, y: 24, duration: 1.2, ease: 'power3.out', delay: 1.5 });
      gsap.from(dateRef,     { opacity: 0, y: 24, duration: 1.2, ease: 'power3.out', delay: 1.8 });
      gsap.from(venueRef,    { opacity: 0, y: 16, duration: 1.0, ease: 'power3.out', delay: 2.1 });
      gsap.from(scrollRef,   { opacity: 0, y: 10, duration: 1.0, ease: 'power2.out', delay: 2.6 });
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
      class="relative h-screen w-full overflow-hidden flex items-center justify-center"
    >
      {/* Three.js canvas — white background, gold rings, red roses */}
      <canvas
        ref={canvasRef}
        class="absolute inset-0 w-full h-full"
        style="display:block"
      />

      {/* Hero text panel — glass card for readability */}
      <div
        class="relative z-10 text-center pointer-events-none select-none px-10 py-12"
        style="
          background: rgba(253,250,247,0.72);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(201,169,110,0.25);
          box-shadow: 0 8px 48px rgba(201,169,110,0.12), 0 2px 12px rgba(0,0,0,0.06);
          max-width: 640px;
          width: 90%;
        "
      >
        {/* Eyebrow */}
        <p
          ref={subtitleRef}
          class="font-sans text-xs tracking-[0.55em] uppercase mb-6"
          style="opacity:0; color: #1A3A6B; letter-spacing: 0.55em"
        >
          You are cordially invited to celebrate
        </p>

        {/* Decorative top flourish */}
        <div class="flex items-center justify-center gap-3 mb-5">
          <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
          <span class="text-base" style="color: #C9A96E">✦</span>
          <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
        </div>

        {/* Main title — tri-color "Idan & Vered" */}
        <h1
          ref={titleRef}
          class="font-serif font-light leading-none"
          style="font-size: clamp(3rem, 9vw, 7rem)"
        >
          <span style="color: #1A3A6B">Idan</span>
          <span style="color: #C9A96E; margin: 0 0.18em">&amp;</span>
          <span style="color: #B22222">Vered</span>
        </h1>

        {/* Bottom flourish */}
        <div class="flex items-center justify-center gap-3 mt-5 mb-6">
          <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
          <span class="text-base" style="color: #C9A96E">✦</span>
          <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
        </div>

        {/* Date */}
        <div
          ref={dateRef}
          class="flex items-center justify-center gap-4 mb-4"
          style="opacity:0"
        >
          <div class="h-px w-12" style="background: rgba(201,169,110,0.5)" />
          <p class="font-serif text-xl italic" style="color: #C9A96E">June 14, 2027</p>
          <div class="h-px w-12" style="background: rgba(201,169,110,0.5)" />
        </div>

        {/* Venue */}
        <p
          ref={venueRef}
          class="font-sans text-sm tracking-widest"
          style="opacity:0; color: #1A3A6B; letter-spacing: 0.25em"
        >
          The Garden Palace · Tel Aviv
        </p>
      </div>

      {/* Scroll indicator */}
      <div
        ref={scrollRef}
        class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
        style="opacity:0"
      >
        <span class="font-sans text-xs tracking-widest uppercase" style="color: rgba(26,58,107,0.45); letter-spacing: 0.3em">Scroll</span>
        <div class="w-px h-10" style="background: linear-gradient(to bottom, rgba(201,169,110,0.6), transparent)" />
      </div>
    </section>
  );
}
