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

    // iOS/Android block autoplay in Low Power Mode and in some data-saver
    // settings even for muted inline video. When play() is rejected, retry on
    // the visitor's next interaction (scroll counts) so the walk still runs.
    let gestureHooked = false;
    const hookGesture = () => {
      if (gestureHooked) return;
      gestureHooked = true;
      const retry = () => {
        video.play().then(cleanup).catch(() => { /* still blocked; try the next one */ });
      };
      const cleanup = () => {
        gestureHooked = false;
        ['touchstart', 'pointerdown', 'click', 'scroll'].forEach((e) =>
          window.removeEventListener(e, retry, { passive: true }));
      };
      ['touchstart', 'pointerdown', 'click', 'scroll'].forEach((e) =>
        window.addEventListener(e, retry, { passive: true }));
    };

    const play = () => {
      played = true;
      try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
      const p = video.play();
      if (p && p.catch) p.catch(hookGesture);
    };
    const reset = () => {
      played = false;
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
    let readyTimer = null;
    // Start fetching only when the card is within ~1.5 viewports (Lighthouse:
    // keep the first load free of the 0.9 MB clip).
    let armed = false;
    const arm = () => {
      if (armed) return; armed = true;
      video.preload = 'auto';
      MP4 && video.querySelectorAll('source').forEach((el) => { if (el.dataset.src) el.src = el.dataset.src; });
      video.load();
      readyTimer = setTimeout(() => { if (video.readyState < 3) fail(); }, 15000);
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { arm(); io.disconnect(); } }, { rootMargin: '150% 0px' });
    io.observe(wrapRef);
    video.addEventListener('canplay', () => {
      clearTimeout(readyTimer);
      // Arm on the whole RSVP section so the walk is already under way by the
      // time the card itself is in view (no visible wait after arriving).
      trigger = ScrollTrigger.create({
        trigger: wrapRef.closest('section') || wrapRef,
        start: 'top 80%',
        end: 'bottom top',
        onEnter: play,
        onEnterBack: play,
        onLeave: reset,
        onLeaveBack: reset,
      });
      if (!played && trigger.isActive) play();
    }, { once: true });
    if (import.meta.env.DEV) window.__processionClip = { useWebm: false, video };

    onCleanup(() => {
      io.disconnect();
      if (readyTimer) clearTimeout(readyTimer);
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
