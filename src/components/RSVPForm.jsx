import { createSignal, Show, onMount } from 'solid-js';
import { gsap } from 'gsap';
import { submitRSVP, submitting, submitted, submitError } from '../store/rsvp';
import { revealOnScroll } from '../animations/gsapSetup';

// Step indices
const STEP_WELCOME    = 0;
const STEP_NAME       = 1;
const STEP_ATTENDANCE = 2;
const STEP_PLUS_ONE   = 3;
const STEP_PHONE      = 4;
const STEP_DIETARY    = 5;
const STEP_MESSAGE    = 6;
const STEP_DONE       = 7;

const TOTAL_DOTS = 7; // dots for steps 1-7 (exclude welcome and done)

export default function RSVPForm() {
  const [step, setStep] = createSignal(STEP_WELCOME);
  const [name, setName] = createSignal('');
  const [attending, setAttending] = createSignal(null);
  const [plusOne, setPlusOne] = createSignal(false);
  const [phone, setPhone] = createSignal('');
  const [dietary, setDietary] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [submitDone, setSubmitDone] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  let sectionRef;
  let containerRef;
  let nameInputRef;
  let phoneInputRef;
  let dietaryInputRef;
  let messageInputRef;

  onMount(() => {
    revealOnScroll([sectionRef], 0);
  });

  // Slide animation: current slides out left, next slides in from right
  const goTo = (nextStep) => {
    if (!containerRef) {
      setStep(nextStep);
      return;
    }
    gsap.to(containerRef, {
      x: '-100%',
      opacity: 0,
      duration: 0.4,
      ease: 'power2.in',
      onComplete: () => {
        setStep(nextStep);
        gsap.fromTo(
          containerRef,
          { x: '100%', opacity: 0 },
          { x: '0%', opacity: 1, duration: 0.4, ease: 'power2.out' }
        );
        // Focus relevant input after transition
        setTimeout(() => {
          if (nextStep === STEP_NAME && nameInputRef) nameInputRef.focus();
          if (nextStep === STEP_PHONE && phoneInputRef) phoneInputRef.focus();
          if (nextStep === STEP_DIETARY && dietaryInputRef) dietaryInputRef.focus();
          if (nextStep === STEP_MESSAGE && messageInputRef) messageInputRef.focus();
        }, 420);
      },
    });
  };

  const handleAttendance = (val) => {
    setAttending(val);
    if (val) {
      goTo(STEP_PLUS_ONE);
    } else {
      // Declining — skip to message
      goTo(STEP_MESSAGE);
    }
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    try {
      await submitRSVP({
        name: name().trim(),
        attending: attending() === true,
        plus_one: plusOne(),
        phone: phone().trim(),
        dietary: dietary().trim(),
        message: message().trim(),
      });
      setSubmitDone(true);
      goTo(STEP_DONE);
    } catch (e) {
      setErrorMsg(e?.message || 'Something went wrong. Please try again.');
      goTo(STEP_DONE);
    }
  };

  // Progress dot count: steps 1–6 (name through message)
  const dotStep = () => Math.min(Math.max(step() - 1, 0), TOTAL_DOTS);

  // Shared card style
  const cardStyle = `
    background: white;
    border: 1px solid rgba(178,34,34,0.2);
    border-radius: 2px;
    padding: 48px;
    box-shadow: 0 4px 40px rgba(178,34,34,0.08);
    max-width: 520px;
    width: 100%;
    margin: 0 auto;
  `;

  // Big action button style
  const bigBtnBase = `
    display: block;
    width: 100%;
    padding: 16px;
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.2rem;
    cursor: pointer;
    transition: all 0.2s;
    background: white;
    border: 2px solid #B22222;
    color: #B22222;
    text-align: center;
    letter-spacing: 0.04em;
  `;

  const inputStyle = `
    width: 100%;
    background: rgba(178,34,34,0.02);
    border: 1px solid rgba(178,34,34,0.2);
    color: #1A0A0A;
    font-family: 'Inter', sans-serif;
    font-size: 0.95rem;
    padding: 12px 16px;
    outline: none;
    transition: border-color 0.2s;
    border-radius: 1px;
  `;

  const labelStyle = `
    display: block;
    font-family: 'Inter', sans-serif;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #B22222;
    margin-bottom: 10px;
  `;

  const skipBtnStyle = `
    font-family: 'Inter', sans-serif;
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    color: rgba(26,10,10,0.4);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  `;

  const nextBtnStyle = `
    font-family: 'Inter', sans-serif;
    font-size: 0.8rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #B22222;
    background: rgba(178,34,34,0.05);
    border: 1px solid rgba(178,34,34,0.5);
    padding: 10px 24px;
    cursor: pointer;
    transition: all 0.2s;
  `;

  const headingStyle = `
    font-family: 'Cormorant Garamond', serif;
    font-size: 2rem;
    font-weight: 300;
    color: #1A0A0A;
    margin-bottom: 12px;
    line-height: 1.2;
  `;

  const subheadStyle = `
    font-family: 'Inter', sans-serif;
    font-size: 0.85rem;
    color: rgba(26,10,10,0.5);
    margin-bottom: 28px;
  `;

  return (
    <section
      ref={sectionRef}
      id="rsvp"
      class="py-32 px-6"
      style="opacity:0"
    >
      {/* Section heading */}
      <div class="text-center mb-12">
        <p class="font-sans text-xs tracking-[0.4em] uppercase mb-4" style="color: #B22222">
          Kindly reply by May 1, 2027
        </p>
        <h2 class="font-serif text-5xl md:text-6xl font-light mb-6" style="color: #1A0A0A">
          RSVP
        </h2>
        <div class="max-w-xs mx-auto h-px" style="background: linear-gradient(to right, transparent, rgba(178,34,34,0.4), transparent)" />
      </div>

      {/* Progress dots — visible for steps 1–6 */}
      <Show when={step() >= STEP_NAME && step() <= STEP_MESSAGE}>
        <div class="flex justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_DOTS }).map((_, i) => (
            <div
              style={`
                width: 8px; height: 8px; border-radius: 50%;
                transition: background 0.3s;
                background: ${i < dotStep() ? '#B22222' : 'rgba(178,34,34,0.2)'};
              `}
            />
          ))}
        </div>
      </Show>

      {/* Slide container */}
      <div style="overflow: hidden; position: relative;">
        <div ref={containerRef} style="will-change: transform, opacity;">

          {/* ── STEP 0: Welcome ── */}
          <Show when={step() === STEP_WELCOME}>
            <div style={cardStyle}>
              <div style="text-align: center;">
                <div style="font-size: 2.5rem; margin-bottom: 16px; color: #B22222;">✿</div>
                <h2 style={headingStyle}>Will you join us?</h2>
                <p style={subheadStyle}>
                  Idan &amp; Vered warmly invite you to celebrate their wedding on June 14, 2027.
                </p>
                <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(178,34,34,0.25), transparent); margin: 24px 0;" />
                <button
                  style={bigBtnBase}
                  onClick={() => goTo(STEP_NAME)}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  RSVP Now ✿
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 1: Name ── */}
          <Show when={step() === STEP_NAME}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>What's your name?</h2>
              <p style={subheadStyle}>So we know who to expect at the celebration.</p>
              <label style={labelStyle}>Full Name *</label>
              <input
                ref={nameInputRef}
                type="text"
                value={name()}
                onInput={(e) => setName(e.target.value)}
                placeholder="Your full name"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name().trim()) goTo(STEP_ATTENDANCE);
                }}
              />
              <div style="margin-top: 20px; text-align: right;">
                <button
                  style={nextBtnStyle}
                  disabled={!name().trim()}
                  onClick={() => { if (name().trim()) goTo(STEP_ATTENDANCE); }}
                  onMouseEnter={(e) => { if (name().trim()) { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  Next →
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 2: Attendance ── */}
          <Show when={step() === STEP_ATTENDANCE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>Will you be joining us?</h2>
              <p style={subheadStyle}>
                {name() ? `${name()}, we'd love to have you there.` : "We'd love to have you there."}
              </p>
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <button
                  style={bigBtnBase}
                  onClick={() => handleAttendance(true)}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  Joyfully Accept 🌹
                </button>
                <button
                  style={{ ...bigBtnBase, borderColor: 'rgba(26,10,10,0.25)', color: 'rgba(26,10,10,0.5)' }}
                  onClick={() => handleAttendance(false)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(26,10,10,0.05)'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; }}
                >
                  Regretfully Decline
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 3: Plus One ── */}
          <Show when={step() === STEP_PLUS_ONE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>Are you bringing a guest?</h2>
              <p style={subheadStyle}>We want to make sure we have a seat for them too.</p>
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <button
                  style={bigBtnBase}
                  onClick={() => { setPlusOne(true); goTo(STEP_PHONE); }}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  Yes, I'm bringing a +1
                </button>
                <button
                  style={{ ...bigBtnBase, borderColor: 'rgba(178,34,34,0.35)', color: 'rgba(178,34,34,0.6)' }}
                  onClick={() => { setPlusOne(false); goTo(STEP_PHONE); }}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(178,34,34,0.06)'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; }}
                >
                  No, just me
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 4: Phone ── */}
          <Show when={step() === STEP_PHONE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>Your WhatsApp number</h2>
              <p style={subheadStyle}>So we can send your invitation digitally. Completely optional.</p>
              <label style={labelStyle}>
                Phone Number
                <span style="color: rgba(26,10,10,0.35); text-transform: none; letter-spacing: normal; margin-left: 8px; font-size: 0.7rem;">(optional)</span>
              </label>
              <input
                ref={phoneInputRef}
                type="tel"
                value={phone()}
                onInput={(e) => setPhone(e.target.value)}
                placeholder="+972 50 123 4567"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => { if (e.key === 'Enter') goTo(STEP_DIETARY); }}
              />
              <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center;">
                <button style={skipBtnStyle} onClick={() => goTo(STEP_DIETARY)}>Skip</button>
                <button
                  style={nextBtnStyle}
                  onClick={() => goTo(STEP_DIETARY)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  Next →
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 5: Dietary ── */}
          <Show when={step() === STEP_DIETARY}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>Any dietary requirements?</h2>
              <p style={subheadStyle}>We want everyone to be well fed and happy. Completely optional.</p>
              <label style={labelStyle}>
                Dietary Needs
                <span style="color: rgba(26,10,10,0.35); text-transform: none; letter-spacing: normal; margin-left: 8px; font-size: 0.7rem;">(optional)</span>
              </label>
              <input
                ref={dietaryInputRef}
                type="text"
                value={dietary()}
                onInput={(e) => setDietary(e.target.value)}
                placeholder="Vegetarian, vegan, allergies…"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => { if (e.key === 'Enter') goTo(STEP_MESSAGE); }}
              />
              <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center;">
                <button style={skipBtnStyle} onClick={() => goTo(STEP_MESSAGE)}>Skip</button>
                <button
                  style={nextBtnStyle}
                  onClick={() => goTo(STEP_MESSAGE)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  Next →
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 6: Message ── */}
          <Show when={step() === STEP_MESSAGE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>A message for Idan &amp; Vered</h2>
              <p style={subheadStyle}>Share your wishes, a memory, or words of love. Completely optional.</p>
              <label style={labelStyle}>
                Your Message
                <span style="color: rgba(26,10,10,0.35); text-transform: none; letter-spacing: normal; margin-left: 8px; font-size: 0.7rem;">(optional)</span>
              </label>
              <textarea
                ref={messageInputRef}
                value={message()}
                onInput={(e) => setMessage(e.target.value)}
                placeholder="Share your wishes…"
                rows="4"
                style={{ ...inputStyle, resize: 'none' }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
              />
              <Show when={submitError() || errorMsg()}>
                <div style="margin-top: 12px; padding: 10px 14px; border: 1px solid rgba(178,34,34,0.3); background: rgba(178,34,34,0.06);">
                  <p style="font-family: Inter, sans-serif; font-size: 0.8rem; color: #B22222;">
                    {errorMsg() || submitError()}
                  </p>
                </div>
              </Show>
              <div style="margin-top: 20px;">
                <button
                  style={{
                    ...bigBtnBase,
                    opacity: submitting() ? '0.6' : '1',
                    cursor: submitting() ? 'not-allowed' : 'pointer',
                  }}
                  disabled={submitting()}
                  onClick={handleSubmit}
                  onMouseEnter={(e) => { if (!submitting()) { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  {submitting() ? 'Sending…' : 'Send RSVP 🌹'}
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 7: Done ── */}
          <Show when={step() === STEP_DONE}>
            <div style={cardStyle}>
              <div style="text-align: center;">
                <Show when={!errorMsg()}>
                  <div style="font-size: 3rem; color: #B22222; margin-bottom: 20px;">
                    {attending() ? '🌹' : '💌'}
                  </div>
                  <h2 style={headingStyle}>
                    {attending()
                      ? `We can't wait to see you!`
                      : `We'll miss you dearly.`}
                  </h2>
                  <Show when={name()}>
                    <p style={{ ...subheadStyle, fontSize: '1rem', color: '#B22222' }}>
                      Thank you, {name()}.
                    </p>
                  </Show>
                  <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(178,34,34,0.25), transparent); margin: 24px 0;" />
                  <p style={subheadStyle}>
                    {attending()
                      ? 'Your RSVP has been received with joy. We look forward to celebrating with you on June 14, 2027.'
                      : 'Your response has been noted. We hope to celebrate with you another time.'}
                  </p>
                  <p style="font-family: 'Cormorant Garamond', serif; font-size: 1.1rem; font-style: italic; color: #8B6347; margin-top: 16px;">
                    Idan &amp; Vered
                  </p>
                </Show>
                <Show when={errorMsg()}>
                  <div style="font-size: 2rem; color: #B22222; margin-bottom: 16px;">✿</div>
                  <h2 style={headingStyle}>Something went wrong</h2>
                  <p style={subheadStyle}>{errorMsg()}</p>
                  <button
                    style={nextBtnStyle}
                    onClick={() => { setErrorMsg(''); goTo(STEP_MESSAGE); }}
                  >
                    Try again
                  </button>
                </Show>
              </div>
            </div>
          </Show>

        </div>
      </div>
    </section>
  );
}
