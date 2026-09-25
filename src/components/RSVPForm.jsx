import { createSignal, Show, onMount } from 'solid-js';
import { gsap } from 'gsap';
import { submitRSVP, submitting, submitted, submitError, readInviteToken, fetchInvite } from '../store/rsvp';
import { revealOnScroll } from '../animations/gsapSetup';
import ProcessionStage from './ProcessionStage';
import { scrollToRSVP } from '../scrollToRSVP';

// Step indices
const STEP_WELCOME    = 0;
const STEP_NAME       = 1;
const STEP_ATTENDANCE = 2;
const STEP_GUESTS     = 3;
const STEP_PHONE      = 4;
const STEP_DIETARY    = 5;
const STEP_MESSAGE    = 6;
const STEP_DONE       = 7;

const TOTAL_DOTS = 7; // dots for steps 1-7 (exclude welcome and done)

export default function RSVPForm() {
  const [step, setStep] = createSignal(STEP_WELCOME);
  const [name, setName] = createSignal('');
  const [attending, setAttending] = createSignal(null);
  const [guests, setGuests] = createSignal(1);
  const [guestsOther, setGuestsOther] = createSignal(false);
  const [phone, setPhone] = createSignal('');
  const [dietary, setDietary] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [submitDone, setSubmitDone] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  // Personal-invite state. `inviteToken` is only set once the token actually
  // resolved, so a stale or bogus link falls back to the ordinary flow.
  const [inviteToken, setInviteToken] = createSignal('');
  const [alreadyAnswered, setAlreadyAnswered] = createSignal(false);

  let sectionRef;
  let containerRef;
  let nameInputRef;
  let phoneInputRef;
  let dietaryInputRef;
  let messageInputRef;

  onMount(() => {
    revealOnScroll([sectionRef], 0);

    // A personal link (?i=<token>) prefills the name and phone and skips the
    // name step. Everything stays editable — "לא אני?" goes back.
    const token = readInviteToken();
    if (!token) return;
    fetchInvite(token).then((invite) => {
      if (!invite) return;               // unknown/expired token → normal flow
      setInviteToken(token);
      if (invite.name) setName(invite.name);
      if (invite.phone) setPhone(invite.phone);
      if (invite.responded) {
        setAlreadyAnswered(true);
        setAttending(invite.attending === true);
        const n = Number(invite.guests) || 1;
        setGuests(n);
        setGuestsOther(n > 5);
      }
    });
  });

  // Slide animation: current slides out left, next slides in from right
  const goTo = (nextStep) => {
    if (!containerRef) {
      setStep(nextStep);
      return;
    }
    // RTL: slide out toward the start edge (right) and in from the end edge.
    const rtl = typeof document !== 'undefined'
      && getComputedStyle(document.documentElement).direction === 'rtl';
    const outX = rtl ? '100%' : '-100%';
    const inX = rtl ? '-100%' : '100%';
    gsap.to(containerRef, {
      x: outX,
      opacity: 0,
      duration: 0.4,
      ease: 'power2.in',
      onComplete: () => {
        setStep(nextStep);
        // Every step brings its own title + button fully into view.
        scrollToRSVP('smooth');
        gsap.fromTo(
          containerRef,
          { x: inX, opacity: 0 },
          { x: '0%', opacity: 1, duration: 0.4, ease: 'power2.out' }
        );
        // Focus relevant input after transition
        setTimeout(() => {
          const opts = { preventScroll: true }; // focusing must not fight the scroll
          if (nextStep === STEP_NAME && nameInputRef) nameInputRef.focus(opts);
          if (nextStep === STEP_PHONE && phoneInputRef) phoneInputRef.focus(opts);
          if (nextStep === STEP_DIETARY && dietaryInputRef) dietaryInputRef.focus(opts);
          if (nextStep === STEP_MESSAGE && messageInputRef) messageInputRef.focus(opts);
        }, 420);
      },
    });
  };

  const handleAttendance = (val) => {
    setAttending(val);
    if (val) {
      goTo(STEP_GUESTS);
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
        guests: guests(),
        plus_one: guests() > 1,
        phone: phone().trim(),
        dietary: dietary().trim(),
        message: message().trim(),
        invite_token: inviteToken() || null,
      });
      setSubmitDone(true);
      // Hand off to the confirmation page (plain pathname routing, see main.jsx);
      // the name/answer travel in the query string so a refresh keeps them.
      const params = new URLSearchParams({
        name: name().trim(),
        attending: attending() === true ? '1' : '0',
      });
      window.location.assign(`/confirmed?${params.toString()}`);
    } catch (e) {
      setErrorMsg(e?.message || 'משהו השתבש, נסו שוב');
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
    padding: 32px 40px 36px;
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
    font-family: 'Frank Ruhl Libre', 'Cormorant Garamond', serif;
    font-size: 1.2rem;
    cursor: pointer;
    transition: all 0.2s;
    background: white;
    border: 2px solid #B22222;
    color: #B22222;
    text-align: center;
    letter-spacing: 0.02em;
  `;

  const inputStyle = `
    width: 100%;
    background: rgba(178,34,34,0.02);
    border: 1px solid rgba(178,34,34,0.2);
    color: #1A0A0A;
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 1rem;
    padding: 12px 16px;
    outline: none;
    transition: border-color 0.2s;
    border-radius: 1px;
  `;

  // Hebrew has no uppercase; tracking kept modest so letters don't drift apart.
  const labelStyle = `
    display: block;
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: #B22222;
    margin-bottom: 10px;
  `;

  const optionalStyle = `
    color: rgba(26,10,10,0.35);
    font-weight: 300;
    letter-spacing: normal;
    margin-inline-start: 6px;
    font-size: 0.8rem;
  `;

  const skipBtnStyle = `
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 0.85rem;
    letter-spacing: 0.04em;
    color: rgba(26,10,10,0.4);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  `;

  const nextBtnStyle = `
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 0.9rem;
    font-weight: 400;
    letter-spacing: 0.08em;
    color: #B22222;
    background: rgba(178,34,34,0.05);
    border: 1px solid rgba(178,34,34,0.5);
    padding: 10px 24px;
    cursor: pointer;
    transition: all 0.2s;
  `;

  const pillStyle = `
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 1.05rem;
    font-weight: 400;
    width: 52px;
    height: 52px;
    color: #1A0A0A;
    background: white;
    border: 1px solid rgba(201,169,110,0.55);
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.18s;
  `;

  const pillActiveStyle = pillStyle + `
    background: #C9A96E;
    border-color: #C9A96E;
    color: white;
  `;

  const headingStyle = `
    font-family: 'Frank Ruhl Libre', 'Cormorant Garamond', serif;
    font-size: 2rem;
    font-weight: 300;
    color: #1A0A0A;
    margin-bottom: 12px;
    line-height: 1.25;
  `;

  const subheadStyle = `
    font-family: 'Heebo', 'Inter', sans-serif;
    font-size: 0.95rem;
    color: rgba(26,10,10,0.5);
    margin-bottom: 28px;
  `;

  return (
    <section
      ref={sectionRef}
      id="rsvp"
      class="py-8 md:py-12 px-6"
      style="opacity:0; scroll-margin-top: 76px"
    >
      {/* Short viewports (laptops at 657–730px, phones with browser bars): keep title + stage + button in one view */}
      <style>{`
        @media (max-height: 760px) {
          #rsvp { padding-top: 1rem !important; padding-bottom: 1rem !important; }
          #rsvp .rsvp-title { font-size: 2.6rem !important; margin-bottom: 0.5rem !important; }
          #rsvp .rsvp-head { margin-bottom: 0.9rem !important; }
          #rsvp .procession { max-height: 20vh !important; min-height: 130px !important; }
        }
      `}</style>
      {/* Section heading */}
      <div class="rsvp-head text-center mb-6">
        <p class="font-sans text-sm font-medium tracking-[0.12em] mb-4" style="color: #B22222">
          נשמח לתשובתכם עד 15 באוקטובר 2026
        </p>
        <h2 class="rsvp-title font-serif text-5xl md:text-6xl font-light mb-4" style="color: #1A0A0A">
          אישור הגעה
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
            <div style={cardStyle + 'overflow: hidden;'}>
              {/* 3D stage: the card's own header — bride and groom walk in and meet under the canopy */}
              <ProcessionStage />
              <div style="text-align: center;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 20px;">
                  <div style="height: 1px; width: 56px; background: linear-gradient(to left, transparent, rgba(201,169,110,0.5));" />
                  <span style="color: #C9A96E; font-size: 1.3rem;">✦</span>
                  <div style="height: 1px; width: 56px; background: linear-gradient(to right, transparent, rgba(201,169,110,0.5));" />
                </div>
                <h2 style={headingStyle}>
                  {alreadyAnswered() ? 'כבר אישרתם — אפשר לעדכן' : 'תבואו לחגוג איתנו?'}
                </h2>
                <p style={subheadStyle}>
                  <Show when={inviteToken() && name()}>
                    <span style="display:block; color:#B22222; margin-bottom:8px;">שלום {name()}!</span>
                  </Show>
                  עידן וורד מזמינים אתכם בשמחה לחגוג את חתונתם ביום ראשון, 25 באוקטובר 2026, באולם האירועים תרין, ראשון לציון. קבלת פנים ב-18:30, חופה ב-19:30.
                </p>
                <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(178,34,34,0.25), transparent); margin: 24px 0;" />
                <button
                  style={bigBtnBase}
                  /* A personal link already knows the name — start at the answer. */
                  onClick={() => goTo(inviteToken() ? STEP_ATTENDANCE : STEP_NAME)}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  {alreadyAnswered() ? 'עדכון התשובה' : 'אישור הגעה'}
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 1: Name ── */}
          <Show when={step() === STEP_NAME}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>מה שמכם?</h2>
              <p style={subheadStyle}>כדי שנדע למי לצפות בחגיגה.</p>
              <label style={labelStyle}>שם מלא *</label>
              <input
                ref={nameInputRef}
                type="text"
                value={name()}
                onInput={(e) => setName(e.target.value)}
                placeholder="השם המלא שלכם"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name().trim()) goTo(STEP_ATTENDANCE);
                }}
              />
              {/* "Forward" sits at the inline end (left in RTL) */}
              <div style="margin-top: 20px; text-align: end;">
                <button
                  style={nextBtnStyle}
                  disabled={!name().trim()}
                  onClick={() => { if (name().trim()) goTo(STEP_ATTENDANCE); }}
                  onMouseEnter={(e) => { if (name().trim()) { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  המשך ←
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 2: Attendance ── */}
          <Show when={step() === STEP_ATTENDANCE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>האם תגיעו?</h2>
              <p style={subheadStyle}>
                {name() ? `${name()}, נשמח מאוד לראותכם שם.` : 'נשמח מאוד לראותכם שם.'}
              </p>
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <button
                  style={bigBtnBase}
                  onClick={() => handleAttendance(true)}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  כן, נגיע!
                </button>
                <button
                  style={bigBtnBase + 'border-color: rgba(26,10,10,0.25); color: rgba(26,10,10,0.5);'}
                  onClick={() => handleAttendance(false)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(26,10,10,0.05)'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; }}
                >
                  לצערנו לא נוכל
                </button>
              </div>
              {/* Personal links can land on the wrong person — let them fix it. */}
              <Show when={inviteToken()}>
                <div style="margin-top: 18px; text-align: center;">
                  <button style={skipBtnStyle} onClick={() => goTo(STEP_NAME)}>
                    לא אני? שנו את השם
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          {/* ── STEP 3: How many guests ── */}
          <Show when={step() === STEP_GUESTS}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>כמה תגיעו?</h2>
              <p style={subheadStyle}>כדי שנשמור לכם מספיק מקומות.</p>
              <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 18px;">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    style={guests() === n && !guestsOther() ? pillActiveStyle : pillStyle}
                    onClick={() => { setGuestsOther(false); setGuests(n); }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  style={guestsOther() ? pillActiveStyle : pillStyle}
                  onClick={() => { setGuestsOther(true); if (guests() < 6) setGuests(6); }}
                >
                  +6
                </button>
              </div>
              <Show when={guestsOther()}>
                <div style="margin-bottom: 18px;">
                  <input
                    type="number"
                    min="6"
                    max="20"
                    value={guests()}
                    onInput={(e) => {
                      const v = Math.max(1, Math.min(20, parseInt(e.currentTarget.value, 10) || 1));
                      setGuests(v);
                    }}
                    style={inputStyle + 'text-align: center; max-width: 140px; margin-inline: auto;'}
                    aria-label="מספר האורחים"
                  />
                </div>
              </Show>
              <div style="display: flex; justify-content: flex-end;">
                <button
                  style={nextBtnStyle}
                  onClick={() => goTo(STEP_PHONE)}
                  onMouseEnter={(e) => { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.color = '#B22222'; }}
                >
                  המשך ←
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 4: Phone ── */}
          <Show when={step() === STEP_PHONE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>מספר הוואטסאפ שלכם</h2>
              <p style={subheadStyle}>כדי שנוכל לשלוח לכם את ההזמנה באופן דיגיטלי. לא חובה.</p>
              <label style={labelStyle}>
                מספר טלפון
                <span style={optionalStyle}>(לא חובה)</span>
              </label>
              {/* Phone numbers are LTR data even in an RTL form: dir="ltr" keeps the
                  digit groups in order while text-align keeps them on the reading edge. */}
              <input
                ref={phoneInputRef}
                type="tel"
                dir="ltr"
                value={phone()}
                onInput={(e) => setPhone(e.target.value)}
                placeholder="050-123-4567"
                style={inputStyle + 'text-align: right;'}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => { if (e.key === 'Enter') goTo(STEP_DIETARY); }}
              />
              <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center;">
                <button style={skipBtnStyle} onClick={() => goTo(STEP_DIETARY)}>דילוג</button>
                <button
                  style={nextBtnStyle}
                  onClick={() => goTo(STEP_DIETARY)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  המשך ←
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 5: Dietary ── */}
          <Show when={step() === STEP_DIETARY}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>העדפות תזונה?</h2>
              <p style={subheadStyle}>חשוב לנו שכולם ייהנו מהארוחה. לא חובה.</p>
              <label style={labelStyle}>
                העדפות תזונה
                <span style={optionalStyle}>(לא חובה)</span>
              </label>
              <input
                ref={dietaryInputRef}
                type="text"
                value={dietary()}
                onInput={(e) => setDietary(e.target.value)}
                placeholder="צמחוני, טבעוני, אלרגיות…"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                onKeyDown={(e) => { if (e.key === 'Enter') goTo(STEP_MESSAGE); }}
              />
              <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center;">
                <button style={skipBtnStyle} onClick={() => goTo(STEP_MESSAGE)}>דילוג</button>
                <button
                  style={nextBtnStyle}
                  onClick={() => goTo(STEP_MESSAGE)}
                  onMouseEnter={(e) => { e.target.style.background = 'rgba(178,34,34,0.12)'; e.target.style.borderColor = '#B22222'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'rgba(178,34,34,0.05)'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                >
                  המשך ←
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 6: Message ── */}
          <Show when={step() === STEP_MESSAGE}>
            <div style={cardStyle}>
              <h2 style={headingStyle}>ברכה לעידן וורד</h2>
              <p style={subheadStyle}>שתפו איחול, זיכרון או מילים מהלב. לא חובה.</p>
              <label style={labelStyle}>
                ברכה לזוג
                <span style={optionalStyle}>(לא חובה)</span>
              </label>
              <textarea
                ref={messageInputRef}
                value={message()}
                onInput={(e) => setMessage(e.target.value)}
                placeholder="כתבו לנו ברכה…"
                rows="4"
                style={inputStyle + 'resize: none;'}
                onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
              />
              <Show when={submitError() || errorMsg()}>
                <div style="margin-top: 12px; padding: 10px 14px; border: 1px solid rgba(178,34,34,0.3); background: rgba(178,34,34,0.06);">
                  <p style="font-family: 'Heebo', 'Inter', sans-serif; font-size: 0.85rem; color: #B22222;">
                    {errorMsg() || submitError()}
                  </p>
                </div>
              </Show>
              <div style="margin-top: 20px;">
                <button
                  style={bigBtnBase + `opacity: ${submitting() ? 0.6 : 1}; cursor: ${submitting() ? 'not-allowed' : 'pointer'};`}
                  disabled={submitting()}
                  onClick={handleSubmit}
                  onMouseEnter={(e) => { if (!submitting()) { e.target.style.background = '#B22222'; e.target.style.color = 'white'; }}}
                  onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#B22222'; }}
                >
                  {submitting() ? 'שולחים…' : alreadyAnswered() ? 'עדכון התשובה' : 'שליחה'}
                </button>
              </div>
            </div>
          </Show>

          {/* ── STEP 7: Done ── */}
          <Show when={step() === STEP_DONE}>
            <div style={cardStyle}>
              <div style="text-align: center;">
                <Show when={!errorMsg()}>
                  <div style="font-size: 2rem; color: #C9A96E; margin-bottom: 20px;">
                    ✦
                  </div>
                  <h2 style={headingStyle}>
                    {attending()
                      ? 'תודה! נתראה בחתונה'
                      : 'תודה שעדכנתם, נתגעגע'}
                  </h2>
                  <Show when={name()}>
                    <p style={subheadStyle + 'font-size: 1rem; color: #B22222;'}>
                      תודה, {name()}.
                    </p>
                  </Show>
                  <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(178,34,34,0.25), transparent); margin: 24px 0;" />
                  <p style={subheadStyle}>
                    {attending()
                      ? 'אישור ההגעה שלכם התקבל בשמחה. מחכים לחגוג איתכם ב-25 באוקטובר 2026.'
                      : 'תשובתכם נרשמה. מקווים לחגוג איתכם בהזדמנות אחרת.'}
                  </p>
                  <p style="font-family: 'Frank Ruhl Libre', 'Cormorant Garamond', serif; font-size: 1.15rem; color: #8B6347; margin-top: 16px;">
                    עידן &amp; ורד
                  </p>
                </Show>
                <Show when={errorMsg()}>
                  <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px;">
                    <div style="height: 1px; width: 32px; background: linear-gradient(to left, transparent, rgba(201,169,110,0.5));" />
                    <span style="color: #C9A96E; font-size: 0.9rem;">✦</span>
                    <div style="height: 1px; width: 32px; background: linear-gradient(to right, transparent, rgba(201,169,110,0.5));" />
                  </div>
                  <h2 style={headingStyle}>משהו השתבש</h2>
                  <p style={subheadStyle}>{errorMsg()}</p>
                  <button
                    style={nextBtnStyle}
                    onClick={() => { setErrorMsg(''); goTo(STEP_MESSAGE); }}
                  >
                    נסו שוב
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
