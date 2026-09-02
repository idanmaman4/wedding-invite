import { onMount, onCleanup } from 'solid-js';
import { WeddingScene } from '../three/WeddingScene';
import { animateHeroText } from '../animations/gsapSetup';

export default function Hero() {
  let canvasRef, titleRef, subtitleRef, dateRef, venueRef, scrollRef;
  let scene;

  onMount(() => {
    // Initialize Three.js scene
    scene = new WeddingScene(canvasRef);

    // Animate hero text characters
    animateHeroText(titleRef);

    // Fade in remaining text elements
    import('gsap').then(({ gsap }) => {
      gsap.from(subtitleRef, {
        opacity: 0,
        y: 30,
        duration: 1.2,
        ease: 'power3.out',
        delay: 1.4,
      });
      gsap.from(dateRef, {
        opacity: 0,
        y: 30,
        duration: 1.2,
        ease: 'power3.out',
        delay: 1.7,
      });
      gsap.from(venueRef, {
        opacity: 0,
        y: 20,
        duration: 1.0,
        ease: 'power3.out',
        delay: 2.0,
      });
      gsap.from(scrollRef, {
        opacity: 0,
        y: 10,
        duration: 1.0,
        ease: 'power2.out',
        delay: 2.5,
      });

      // Subtle infinite pulse on scroll indicator
      gsap.to(scrollRef, {
        opacity: 0.3,
        duration: 1.5,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        delay: 3.0,
      });
    });
  });

  onCleanup(() => scene?.dispose());

  return (
    <section
      id="hero"
      class="relative h-screen w-full overflow-hidden flex items-center justify-center"
    >
      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        class="absolute inset-0 w-full h-full"
        style="display:block"
      />

      {/* Dark overlay gradient for text readability */}
      <div
        class="absolute inset-0 pointer-events-none"
        style="background: radial-gradient(ellipse at center, rgba(8,8,8,0.35) 0%, rgba(8,8,8,0.65) 100%)"
      />

      {/* Hero text content */}
      <div class="relative z-10 text-center pointer-events-none select-none px-6">
        <p
          ref={subtitleRef}
          class="font-sans text-xs tracking-[0.5em] text-gold uppercase mb-6"
          style="opacity:0"
        >
          You are cordially invited to celebrate
        </p>

        <h1
          ref={titleRef}
          class="font-serif font-light text-cream leading-none tracking-wide"
          style="font-size: clamp(3.5rem, 10vw, 8rem)"
        >
          Idan &amp; Vered
        </h1>

        <div
          ref={dateRef}
          class="mt-8 flex items-center justify-center gap-4"
          style="opacity:0"
        >
          <div class="h-px w-16 bg-gold/50" />
          <p class="font-serif text-xl italic text-gold-light">June 14, 2027</p>
          <div class="h-px w-16 bg-gold/50" />
        </div>

        <p
          ref={venueRef}
          class="mt-4 font-sans text-sm text-cream/60 tracking-widest"
          style="opacity:0"
        >
          The Garden Palace, Tel Aviv
        </p>
      </div>

      {/* Scroll indicator */}
      <div
        ref={scrollRef}
        class="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none"
        style="opacity:0"
      >
        <span class="font-sans text-xs tracking-widest text-cream/50 uppercase">Scroll</span>
        <div class="w-px h-12 bg-gradient-to-b from-gold/60 to-transparent" />
      </div>
    </section>
  );
}
