import { createSignal, onMount, Show } from 'solid-js';
import { revealOnScroll } from '../animations/gsapSetup';
import { submitRSVP, submitting, submitted, submitError } from '../store/rsvp';

export default function RSVPForm() {
  let sectionRef, formRef, fieldsRef = [];

  // Local form state
  const [name, setName] = createSignal('');
  const [attending, setAttending] = createSignal(true);
  const [plusOne, setPlusOne] = createSignal(false);
  const [dietary, setDietary] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [validationError, setValidationError] = createSignal('');

  onMount(() => {
    revealOnScroll([sectionRef], 0);
    revealOnScroll(fieldsRef.filter(Boolean), 0.1);
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');

    if (!name().trim()) {
      setValidationError('Please enter your name.');
      return;
    }

    try {
      await submitRSVP({
        name: name().trim(),
        attending: attending(),
        plus_one: plusOne(),
        dietary: dietary().trim(),
        message: message().trim(),
      });
    } catch (_err) {
      // Error is already stored in submitError signal from store
    }
  };

  return (
    <section
      ref={sectionRef}
      id="rsvp"
      class="py-32 px-6"
      style="opacity:0"
    >
      <div class="max-w-2xl mx-auto">

        {/* Section heading */}
        <div ref={(el) => (fieldsRef[0] = el)} class="text-center mb-16 opacity-0">
          <p class="font-sans text-xs tracking-[0.4em] text-gold uppercase mb-4">
            Kindly reply by May 1, 2027
          </p>
          <h2 class="font-serif text-5xl md:text-6xl font-light text-cream mb-6">
            RSVP
          </h2>
          <div class="gold-divider max-w-xs mx-auto mb-6" />
          <p class="font-sans text-sm text-cream/50 leading-relaxed">
            We would be honored by your presence. Please let us know if you can join us.
          </p>
        </div>

        {/* Success state */}
        <Show when={submitted()}>
          <div class="text-center py-16 px-8 border border-gold/20 bg-white/[0.02]">
            <div class="text-5xl text-gold mb-6">◇</div>
            <h3 class="font-serif text-4xl font-light text-cream mb-4">
              Thank You
            </h3>
            <div class="gold-divider max-w-xs mx-auto mb-6" />
            <p class="font-sans text-sm text-cream/60 leading-relaxed mb-2">
              Your RSVP has been received with joy.
            </p>
            <p class="font-sans text-sm text-cream/60 leading-relaxed">
              We look forward to celebrating with you on June 14, 2027.
            </p>
            <div class="mt-8">
              <p class="font-serif text-lg italic text-gold-light">Idan &amp; Vered</p>
            </div>
          </div>
        </Show>

        {/* Form */}
        <Show when={!submitted()}>
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            class="space-y-6"
            noValidate
          >
            {/* Name field */}
            <div ref={(el) => (fieldsRef[1] = el)} class="opacity-0">
              <label class="block font-sans text-xs tracking-widest text-gold uppercase mb-2">
                Your Name <span class="text-gold/50">*</span>
              </label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
                class="w-full bg-white/[0.03] border border-gold/20 text-cream placeholder-cream/25 font-sans text-sm px-4 py-3 transition-gold focus:border-gold/60"
                style="outline:none"
              />
            </div>

            {/* Attendance radio */}
            <div ref={(el) => (fieldsRef[2] = el)} class="opacity-0">
              <p class="font-sans text-xs tracking-widest text-gold uppercase mb-3">
                Will you attend?
              </p>
              <div class="flex gap-4">
                <label class="flex-1 cursor-pointer group">
                  <input
                    type="radio"
                    name="attending"
                    class="sr-only"
                    checked={attending() === true}
                    onChange={() => setAttending(true)}
                  />
                  <div
                    class="py-3 text-center border text-sm font-sans tracking-widest transition-all duration-300"
                    classList={{
                      'border-gold bg-gold/10 text-gold': attending() === true,
                      'border-gold/20 text-cream/40 hover:border-gold/40 hover:text-cream/60': attending() !== true,
                    }}
                  >
                    Joyfully Accepts
                  </div>
                </label>
                <label class="flex-1 cursor-pointer group">
                  <input
                    type="radio"
                    name="attending"
                    class="sr-only"
                    checked={attending() === false}
                    onChange={() => setAttending(false)}
                  />
                  <div
                    class="py-3 text-center border text-sm font-sans tracking-widest transition-all duration-300"
                    classList={{
                      'border-gold bg-gold/10 text-gold': attending() === false,
                      'border-gold/20 text-cream/40 hover:border-gold/40 hover:text-cream/60': attending() !== false,
                    }}
                  >
                    Regretfully Declines
                  </div>
                </label>
              </div>
            </div>

            {/* Plus one checkbox — only show if attending */}
            <Show when={attending() === true}>
              <div ref={(el) => (fieldsRef[3] = el)} class="opacity-0">
                <label class="flex items-center gap-3 cursor-pointer group">
                  <div
                    class="w-5 h-5 flex-shrink-0 border transition-all duration-300 flex items-center justify-center"
                    classList={{
                      'border-gold bg-gold/20': plusOne(),
                      'border-gold/30 group-hover:border-gold/50': !plusOne(),
                    }}
                    onClick={() => setPlusOne(!plusOne())}
                  >
                    <Show when={plusOne()}>
                      <span class="text-gold text-xs">✓</span>
                    </Show>
                  </div>
                  <input
                    type="checkbox"
                    class="sr-only"
                    checked={plusOne()}
                    onChange={(e) => setPlusOne(e.target.checked)}
                  />
                  <div>
                    <span class="font-sans text-sm text-cream/70">I will be bringing a guest</span>
                    <span class="font-sans text-xs text-cream/30 ml-2">(+1)</span>
                  </div>
                </label>
              </div>
            </Show>

            {/* Dietary restrictions */}
            <div ref={(el) => (fieldsRef[4] = el)} class="opacity-0">
              <label class="block font-sans text-xs tracking-widest text-gold uppercase mb-2">
                Dietary Requirements
                <span class="ml-2 text-cream/30 normal-case tracking-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={dietary()}
                onInput={(e) => setDietary(e.target.value)}
                placeholder="Vegetarian, vegan, allergies, etc."
                class="w-full bg-white/[0.03] border border-gold/20 text-cream placeholder-cream/25 font-sans text-sm px-4 py-3 transition-gold"
                style="outline:none"
              />
            </div>

            {/* Message */}
            <div ref={(el) => (fieldsRef[5] = el)} class="opacity-0">
              <label class="block font-sans text-xs tracking-widest text-gold uppercase mb-2">
                A Message for the Couple
                <span class="ml-2 text-cream/30 normal-case tracking-normal">(optional)</span>
              </label>
              <textarea
                value={message()}
                onInput={(e) => setMessage(e.target.value)}
                placeholder="Share your wishes, memories, or words of love…"
                rows="4"
                class="w-full bg-white/[0.03] border border-gold/20 text-cream placeholder-cream/25 font-sans text-sm px-4 py-3 transition-gold resize-none"
                style="outline:none"
              />
            </div>

            {/* Error messages */}
            <Show when={validationError()}>
              <div class="px-4 py-3 border border-red-400/30 bg-red-400/10">
                <p class="font-sans text-sm text-red-300">{validationError()}</p>
              </div>
            </Show>

            <Show when={submitError()}>
              <div class="px-4 py-3 border border-red-400/30 bg-red-400/10">
                <p class="font-sans text-sm text-red-300">
                  {submitError()}
                </p>
              </div>
            </Show>

            {/* Submit button */}
            <div ref={(el) => (fieldsRef[6] = el)} class="opacity-0 pt-2">
              <button
                type="submit"
                disabled={submitting()}
                class="w-full py-4 font-sans text-xs tracking-[0.3em] uppercase transition-all duration-300 relative overflow-hidden"
                style={
                  submitting()
                    ? 'background: rgba(201,169,110,0.1); border: 1px solid rgba(201,169,110,0.3); color: rgba(201,169,110,0.5); cursor:not-allowed'
                    : 'background: rgba(201,169,110,0.08); border: 1px solid rgba(201,169,110,0.5); color: #C9A96E; cursor:pointer'
                }
                onMouseEnter={(e) => {
                  if (!submitting()) {
                    e.target.style.background = 'rgba(201,169,110,0.18)';
                    e.target.style.borderColor = 'rgba(201,169,110,0.8)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!submitting()) {
                    e.target.style.background = 'rgba(201,169,110,0.08)';
                    e.target.style.borderColor = 'rgba(201,169,110,0.5)';
                  }
                }}
              >
                <Show
                  when={submitting()}
                  fallback={<span>Send RSVP</span>}
                >
                  <span class="flex items-center justify-center gap-3">
                    <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle
                        class="opacity-25"
                        cx="12" cy="12" r="10"
                        stroke="currentColor" stroke-width="4"
                      />
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Sending…
                  </span>
                </Show>
              </button>
            </div>
          </form>
        </Show>
      </div>
    </section>
  );
}
