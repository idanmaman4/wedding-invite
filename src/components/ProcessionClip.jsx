import { onMount, onCleanup } from 'solid-js';
import { ScrollTrigger } from '../animations/gsapSetup';

/**
 * Pre-rendered procession clip (the live ProcessionScene captured offline at
 * 2x, composited onto the card's white stage). Opaque H.264 MP4 with a VP9
 * WebM alternative, so it plays identically on every browser with no alpha
 * tricks. Plays once when the RSVP card enters view; holds the final frame.
 * Calls `onFail` if the video cannot play, so the caller can fall back to the
 * live WebGL scene.
 */
const MP4 = '/media/procession.mp4';
const WEBM = '/media/procession.webm';

export default function ProcessionClip(props) {
  let wrapRef;
  let videoRef;

  onMount(() => {
    const video = videoRef;
    let failed = false;
    let trigger = null;
    let played = false;

    const fail = () => {
      if (failed) return;
      failed = true;
      trigger?.kill();
      props.onFail?.();
    };

    // Autoplay without a touch. A muted inline video may start on its own,
    // but iOS in Low Power Mode (and some data-saver settings) refuses even
    // that: then switch to the live WebGL walk, which no power setting blocks,
    // instead of waiting for a touch that an idle visitor never gives.
    let stallTimer = null;
    const play = () => {
      played = true;
      try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
      const p = video.play();
      if (p && p.catch) {
        p.catch((err) => {
          if (err && err.name === 'NotAllowedError') fail();
          // AbortError etc.: the load was interrupted; the next trigger retries.
        });
      }
      // Started but never moved (a dead network, a codec it will not play):
      // the live walk is better than a frozen frame.
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!failed && played && video.currentTime < 0.1) fail();
      }, 12000);
    };
    const reset = () => {
      played = false;
      clearTimeout(stallTimer);
      video.pause();
      try { video.currentTime = 0; } catch (e) { /* ignore */ }
    };

    video.muted = true;
    video.defaultMuted = true;          // iOS reads the attribute, not just the property
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'none';
    // A video that has never been decoded shows nothing on iOS until it plays;
    // nudging one frame in gives the card a still image even if autoplay fails.
    video.addEventListener('loadeddata', () => {
      if (video.paused) { try { video.currentTime = 0.04; } catch (e) { /* ignore */ } }
    }, { once: true });
    video.addEventListener('error', fail, { once: true });
    // Start fetching only when the card is within ~1.5 viewports (Lighthouse:
    // keep the first load free of the clip), and arm playback right then —
    // not on `canplay`: iOS Safari often buffers nothing until play() is
    // called, so waiting for canplay meant the walk never started unless the
    // visitor touched the screen.
    let armed = false;
    const arm = () => {
      if (armed) return; armed = true;
      video.preload = 'auto';
      video.querySelectorAll('source').forEach((el) => { if (el.dataset.src) el.src = el.dataset.src; });
      video.load();
      const section = wrapRef.closest('section') || wrapRef;
      // Arm on the whole RSVP section so the walk is already under way by the
      // time the card itself is in view (no visible wait after arriving).
      trigger = ScrollTrigger.create({
        trigger: section,
        start: 'top 80%',
        end: 'bottom top',
        onEnter: play,
        onEnterBack: play,
        onLeave: reset,
        onLeaveBack: reset,
      });
      // Already there (e.g. the automatic scroll finished first): play now.
      // Measured directly — a trigger created without a following scroll
      // does not report itself active until the next scroll event.
      const r = section.getBoundingClientRect();
      if (!played && r.top < window.innerHeight * 0.8 && r.bottom > 0) play();
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { arm(); io.disconnect(); } }, { rootMargin: '150% 0px' });
    io.observe(wrapRef);
    if (import.meta.env.DEV) window.__processionClip = { useWebm: false, video };

    onCleanup(() => {
      io.disconnect();
      clearTimeout(stallTimer);
      trigger?.kill();
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
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
        background: #ffffff;
      "
    >
      <video ref={videoRef} muted autoplay playsinline preload="none" disableremoteplayback style="display:block; width:100%; height:100%; object-fit:cover; object-position:50% 100%; background:#fff;">
        <source data-src={MP4} type="video/mp4" />
        <source data-src={WEBM} type="video/webm" />
      </video>
      <div style="position:absolute; left:0; right:0; bottom:0; height:1px; background: linear-gradient(to right, transparent, rgba(201,169,110,0.55) 20%, rgba(201,169,110,0.55) 80%, transparent);" />
    </div>
  );
}
