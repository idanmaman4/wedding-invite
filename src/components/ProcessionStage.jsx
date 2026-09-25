import { createSignal, Show } from 'solid-js';
import ProcessionClip from './ProcessionClip';
import Procession from './Procession';

/**
 * The RSVP card's 3D stage. Prefers the pre-rendered clip (cheap on every
 * device); falls back to the live WebGL scene if the clip cannot play.
 */
export default function ProcessionStage() {
  // ?live=1 (dev) forces the WebGL scene — used by the offline clip capture.
  const forceLive = typeof location !== 'undefined' && new URLSearchParams(location.search).has('live');
  const [useLive, setUseLive] = createSignal(!!forceLive);
  return (
    <Show when={!useLive()} fallback={<Procession />}>
      <ProcessionClip onFail={() => setUseLive(true)} />
    </Show>
  );
}
