'use strict';

/**
 * The bot itself: every handler, the broadcast, the export job — and nothing
 * about *how* it is run. `index.js` wraps this in long polling for a laptop;
 * `api/telegram/*.js` wraps the same bot in a webhook on Vercel.
 *
 *   1. Admin console — /stats, /rsvps, /pending, /search, /invite against the
 *      site's API, with a button menu so nothing has to be typed.
 *   2. Broadcaster — `broadcast()` fans an incoming RSVP out to every subscriber.
 *   3. Daily export — `exportJob()` sends an XLSX of everything to everyone;
 *      /export and /exportall do the same on demand.
 *
 * Subscribers and half-finished flows live behind store.js / ui.js, both in
 * the site's database (Supabase) via the admin API, however the bot is run.
 */

const { Bot, GrammyError, HttpError, InputFile } = require('grammy');

const api = require('./api');
const store = require('./store');
const fmt = require('./format');
const exporter = require('./export');
const schedule = require('./schedule');
const ui = require('./ui');

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
const NO_PERMISSION = 'אין הרשאה 🙏 רק עידן וורד יכולים להשתמש בפקודות הניהול.';

/** What Telegram shows in the "/" menu. */
const COMMANDS = [
  { command: 'menu', description: 'תפריט הכפתורים' },
  { command: 'start', description: 'הרשמה לעדכונים' },
  { command: 'stop', description: 'הפסקת עדכונים' },
  { command: 'stats', description: 'סיכום אישורי הגעה' },
  { command: 'rsvps', description: 'מי כבר ענה' },
  { command: 'pending', description: 'מי עדיין לא ענה' },
  { command: 'search', description: 'חיפוש לפי שם או טלפון' },
  { command: 'invite', description: 'הזמנה אישית חדשה (בשלבים)' },
  { command: 'side', description: 'צד ברירת מחדל להזמנות חדשות' },
  { command: 'export', description: 'דוח אקסל מלא אליי' },
  { command: 'exportall', description: 'שליחת דוח אקסל לכל המנויים' },
  { command: 'whoami', description: 'מה ה-chat id שלי' },
  { command: 'help', description: 'רשימת הפקודות' },
];

/** True for the errors that mean "this chat is gone" rather than "try again". */
function isDeadChat(err) {
  if (!(err instanceof GrammyError)) return false;
  if (err.error_code === 403) return true;
  const d = String(err.description || '').toLowerCase();
  return (
    err.error_code === 400 &&
    (d.includes('chat not found') || d.includes('user is deactivated') || d.includes('bot was blocked'))
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (s) => String(s || '').replace(/\D+/g, '');

/**
 * Build the bot.
 *
 * @param {object} opts
 * @param {string}   opts.token     from BotFather; never logged
 * @param {string[]} [opts.adminIds] chat ids that are admins regardless of anything
 * @param {boolean}  [opts.openAdmin] whether every subscriber is an admin (default true)
 * @param {object}   [opts.log]     console-like sink
 */
function createBot({ token, adminIds = [], openAdmin = true, log = console } = {}) {
  if (!token) throw new Error('createBot: a Telegram bot token is required');

  const bot = new Bot(token);
  const ADMIN_IDS = adminIds.map(String);

  /**
   * Open admin: anyone who has sent /start (i.e. is in the subscriber registry)
   * may run the admin commands. This is deliberately permissive — the bot is
   * publicly findable, so with it on anyone who starts the bot can read the
   * guest list and phone numbers. `openAdmin: false` restores the allow-list.
   */
  async function isAdmin(chatId) {
    if (ADMIN_IDS.includes(String(chatId))) return true;
    return openAdmin && (await store.has(chatId));
  }

  /** Reply and return false when the sender may not run admin commands. */
  async function requireAdmin(ctx) {
    const id = ctx.chat && ctx.chat.id;
    if (await isAdmin(id)) return true;
    await ctx.reply(`${NO_PERMISSION}\n\nה-chat id שלך: <code>${fmt.esc(id)}</code>`, HTML);
    return false;
  }

  /**
   * Turn any API failure into a readable Hebrew line instead of a crash. The
   * result is sent as HTML, and an error message can quote a response body
   * (`<`, `&`…) — unescaped, Telegram rejects the whole reply and the
   * person sees nothing at all.
   */
  function apiErrorMessage(err, what) {
    if (err instanceof api.ApiError) {
      if (err.missing) return `⚠️ ה-API עדיין לא חושף ${fmt.esc(what)}. נסו שוב אחרי שהאתר יתעדכן.`;
      if (err.unauthorized) return '⚠️ סיסמת המנהל שגויה — בדקו את ADMIN_PASSWORD בשירות.';
      return `⚠️ ${fmt.esc(err.message)}`;
    }
    return `⚠️ שגיאה לא צפויה: ${fmt.esc(err && err.message ? err.message : err)}`;
  }

  /**
   * Send a possibly-long answer as however many messages it takes. `keyboard`,
   * when given, rides on the last one so the buttons sit at the bottom.
   */
  async function replyChunks(ctx, messages, keyboard) {
    for (let i = 0; i < messages.length; i++) {
      const last = i === messages.length - 1;
      await ctx.reply(messages[i], last && keyboard ? { ...HTML, reply_markup: keyboard } : HTML);
    }
  }

  // ─── Subscription ──────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const chat = ctx.chat;
    const from = ctx.from || {};
    let isNew;
    try {
      isNew = await store.add({
        chat_id: chat.id,
        first_name: from.first_name || chat.first_name || '',
        username: from.username || chat.username || '',
      });
    } catch (err) {
      // Saying nothing would leave them believing they are subscribed.
      log.error('[start] could not save the subscriber:', err && err.message ? err.message : err);
      await ctx.reply(`⚠️ לא הצלחתי לשמור את ההרשמה — נסו /start שוב בעוד רגע.\n${apiErrorMessage(err, 'רשימת המנויים')}`, HTML);
      return;
    }

    const lines = [
      `שלום ${fmt.esc(from.first_name || '')} 👋`,
      '',
      isNew ? 'נרשמת לעדכונים — תקבלו הודעה על כל אישור הגעה חדש. ✅' : 'אתם כבר רשומים לעדכונים ✅',
    ];

    if (await isAdmin(chat.id)) {
      lines.push('', 'יש לכם גישה לפקודות הניהול 🔑');
    } else {
      lines.push(
        '',
        `ה-chat id שלך הוא <code>${fmt.esc(chat.id)}</code>`,
        'כדי לקבל גישה לפקודות הניהול, הוסיפו את המספר הזה למשתנה <code>TELEGRAM_ADMIN_IDS</code> והפעילו את הבוט מחדש.',
      );
    }

    lines.push('', 'בחרו מה לעשות:');
    await ctx.reply(lines.join('\n'), { ...HTML, reply_markup: ui.mainMenu() });
  });

  bot.command('menu', async (ctx) => {
    await ctx.reply('מה תרצו לעשות?', { ...HTML, reply_markup: ui.mainMenu() });
  });

  bot.command('stop', async (ctx) => {
    const removed = await store.remove(ctx.chat.id);
    await ctx.reply(
      removed ? 'הוסרת מרשימת העדכונים. /start כדי לחזור. 👋' : 'לא היית רשומים לעדכונים.',
    );
  });

  bot.command('whoami', async (ctx) => {
    await ctx.reply(
      `ה-chat id שלך: <code>${fmt.esc(ctx.chat.id)}</code>\n` +
        ((await isAdmin(ctx.chat.id)) ? 'הרשאות ניהול: ✅' : 'הרשאות ניהול: ❌'),
      HTML,
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(fmt.HELP, { ...HTML, reply_markup: ui.mainMenu() });
  });

  // ─── Reading the guest list ────────────────────────────────────────────────

  /**
   * Everyone who answered.
   *
   * Invite rows carry the side, so they are preferred — but somebody who opened
   * the site without a personal link has no invite at all, and must still be
   * listed. So both sources are merged: answered invites first, then any RSVP
   * row that no invite accounts for.
   */
  async function collectResponded() {
    let invites = [];
    try {
      invites = await api.getInvites();
    } catch (err) {
      if (!api.isRecoverable(err)) throw err;
    }

    const responded = invites.filter((i) => i.responded);
    const claimed = new Set(responded.map((i) => i.guest_id).filter((id) => id !== null && id !== undefined));
    const claimedNames = new Set(responded.map((i) => (i.name || '').trim()).filter(Boolean));

    let guests = [];
    try {
      guests = await api.getGuests();
    } catch (err) {
      if (!api.isRecoverable(err) || !responded.length) throw err;
    }

    // A guest row is a walk-in when no answered invite points at it. Older API
    // payloads omit guest_id, so fall back to matching on the name.
    const walkIns = guests.filter(
      (g) => !claimed.has(g.id) && !(claimed.size === 0 && claimedNames.has((g.name || '').trim())),
    );

    return [...responded, ...walkIns];
  }

  /** Upload one already-built workbook to a chat, with its Hebrew caption. */
  function sendExportDocument(chatId, filePath, fileName, caption) {
    return bot.api.sendDocument(chatId, new InputFile(filePath, fileName), {
      caption,
      parse_mode: 'HTML',
    });
  }

  /**
   * The command bodies live here so a menu button and a typed command run
   * exactly the same code. Each one answers on `ctx`, whether that is a
   * message or a tapped button.
   */
  const actions = {
    async stats(ctx) {
      try {
        const stats = await api.getStats();
        await ctx.reply(fmt.formatStats(stats), { ...HTML, reply_markup: ui.backToMenu() });
      } catch (err) {
        await ctx.reply(apiErrorMessage(err, 'נתוני סטטיסטיקה'), { ...HTML, reply_markup: ui.backToMenu() });
      }
    },

    async rsvps(ctx) {
      try {
        const rows = await collectResponded();
        const lines = rows.map((row, i) => fmt.rsvpLine(i + 1, row));
        await replyChunks(ctx, fmt.chunk(`✅ <b>מי שכבר ענה</b> — ${rows.length}`, lines), ui.backToMenu());
      } catch (err) {
        await ctx.reply(apiErrorMessage(err, 'רשימת המאשרים'), { ...HTML, reply_markup: ui.backToMenu() });
      }
    },

    async pending(ctx) {
      try {
        const invites = await api.getInvites();
        const rows = invites.filter((i) => !i.responded);
        const lines = rows.map((row, i) => fmt.pendingLine(i + 1, row));
        await replyChunks(ctx, fmt.chunk(`⏳ <b>טרם ענו</b> — ${rows.length}`, lines), ui.backToMenu());
      } catch (err) {
        await ctx.reply(apiErrorMessage(err, 'רשימת ההזמנות'), { ...HTML, reply_markup: ui.backToMenu() });
      }
    },

    /** Build the XLSX and send it to whoever asked. */
    async export(ctx) {
      await ctx.reply('בונה את הדוח… ⏳');

      let built;
      try {
        built = await exporter.buildExport({ now: new Date() });
      } catch (err) {
        const message =
          err instanceof exporter.ExportDataError
            ? exporter.fallbackNotice(err)
            : apiErrorMessage(err, 'בניית הדוח');
        await ctx.reply(message, { ...HTML, reply_markup: ui.backToMenu() });
        return;
      }

      try {
        await sendExportDocument(ctx.chat.id, built.filePath, built.fileName, built.caption);
        await ctx.reply('הדוח נשלח ✅', { ...HTML, reply_markup: ui.backToMenu() });
      } catch (err) {
        await ctx.reply(
          `⚠️ לא הצלחתי לשלוח את הקובץ: ${fmt.esc(err && err.message ? err.message : err)}`,
          { ...HTML, reply_markup: ui.backToMenu() },
        );
      } finally {
        built.cleanup();
      }
    },
  };

  bot.command('stats', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await actions.stats(ctx);
  });

  bot.command('rsvps', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await actions.rsvps(ctx);
  });

  bot.command('pending', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await actions.pending(ctx);
  });

  bot.command('export', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await actions.export(ctx);
  });

  // ─── Search ────────────────────────────────────────────────────────────────

  /** Run a search and answer with the results. Shared by the command and the button. */
  async function runSearch(ctx, query) {
    const needle = query.toLowerCase();
    const needleDigits = digits(query);
    const matches = (name, phone) =>
      String(name || '').toLowerCase().includes(needle) ||
      (needleDigits.length >= 3 && digits(phone).includes(needleDigits));

    const lines = [];
    const problems = [];

    try {
      const invites = (await api.getInvites()).filter((i) => matches(i.name, i.phone));
      invites.forEach((inv, i) => {
        lines.push(
          inv.responded
            ? `${lines.length + 1}. 📨 ${fmt.rsvpLine(i + 1, inv).replace(/^\d+\.\s*/, '')}`
            : `${lines.length + 1}. 📨 ${fmt.pendingLine(i + 1, inv).replace(/^\d+\.\s*/, '')} · טרם ענו`,
        );
      });
    } catch (err) {
      problems.push(apiErrorMessage(err, 'הזמנות'));
    }

    try {
      const guests = (await api.getGuests()).filter((g) => matches(g.name, g.phone));
      guests.forEach((g, i) => {
        lines.push(`${lines.length + 1}. 💌 ${fmt.rsvpLine(i + 1, g).replace(/^\d+\.\s*/, '')}`);
      });
    } catch (err) {
      problems.push(apiErrorMessage(err, 'אישורי הגעה'));
    }

    if (!lines.length && problems.length) {
      await ctx.reply(problems.join('\n'), { ...HTML, reply_markup: ui.backToMenu() });
      return;
    }

    // The query is echoed in every chunk's header; a pasted wall of text would
    // push each one past Telegram's 4096 and the whole answer would be lost.
    const shown = query.length > 100 ? `${query.slice(0, 99)}…` : query;
    const header = `🔍 <b>תוצאות עבור</b> "${fmt.esc(shown)}" — ${lines.length}`;
    const messages = fmt.chunk(header, lines);
    if (problems.length) messages.push(problems.join('\n'));
    await replyChunks(ctx, messages, ui.backToMenu());
  }

  async function askSearchTerm(ctx) {
    await ui.startFlow(ctx.chat.id, 'search');
    await ctx.reply('🔍 <b>חיפוש</b>\n\nשלחו שם או מספר טלפון.', { ...HTML, reply_markup: ui.cancelOnly() });
  }

  bot.command('search', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const query = String(ctx.match || '').trim();
    if (!query) {
      // Nothing typed after the command: ask, and read the next message as the term.
      await askSearchTerm(ctx);
      return;
    }
    await runSearch(ctx, query);
  });

  // ─── Creating an invitation, one step at a time ────────────────────────────
  //
  // `/invite` on its own walks three steps — name, then phone, then side as
  // buttons — keeping state in ui.js. The old one-line form
  // (`/invite שם | טלפון | צד`) still works for anyone who prefers typing.

  const INVITE_STEP_NAME = 0;
  const INVITE_STEP_PHONE = 1;
  const INVITE_STEP_SIDE = 2;
  const INVITE_STEP_RENAME = 3; // a shared contact's name, replaced before creating

  /**
   * This chat's default side, or '' to ask. A failed lookup just means asking:
   * it must never stop an invitation from being made.
   */
  async function defaultSideFor(chatId) {
    try {
      return await store.getDefaultSide(chatId);
    } catch (err) {
      log.error('[side] could not read the default side:', err.message);
      return '';
    }
  }

  async function askInviteName(ctx) {
    await ui.startFlow(ctx.chat.id, 'invite');
    await ctx.reply(
      '➕ <b>הזמנה חדשה</b> · שלב 1 מתוך 3\n\nמה השם של המוזמנים?',
      { ...HTML, reply_markup: ui.cancelOnly() },
    );
  }

  async function askInvitePhone(ctx, name) {
    // Reachable straight from `/invite <name>`, so start the flow if the caller
    // has not already.
    if (!(await ui.getFlow(ctx.chat.id))) await ui.startFlow(ctx.chat.id, 'invite');
    await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_PHONE, data: { name } });
    await ctx.reply(
      `➕ <b>${fmt.esc(name)}</b> · שלב 2 מתוך 3\n\n` +
        'שלחו מספר טלפון, או שתפו איש קשר מהמקלדת למטה.',
      { ...HTML, reply_markup: ui.phoneStep() },
    );
    // A separate message, because a reply keyboard and inline buttons cannot
    // ride on the same one.
    await ctx.reply('📇 אפשר גם לשתף איש קשר:', { reply_markup: ui.shareContact() });
  }

  async function askInviteSide(ctx, name) {
    // A default side means there is nothing to ask.
    const side = await defaultSideFor(ctx.chat.id);
    if (side) {
      const flow = await ui.getFlow(ctx.chat.id);
      await finishInvite(ctx, { ...((flow && flow.data) || {}), name, side });
      return;
    }
    await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_SIDE });
    await ctx.reply(
      `➕ <b>${fmt.esc(name)}</b> · שלב 3 מתוך 3\n\nלאיזה צד הם שייכים?`,
      { ...HTML, reply_markup: ui.sideStep() },
    );
  }

  /**
   * The link plus the forwardable text for an invite that now exists.
   * `offerRename` adds a "different name" button (invites made straight from
   * a contact card carry the card's name, which may not be the right one).
   */
  async function sendInviteResult(ctx, invite, { headline, offerRename = false } = {}) {
    const { name, phone, side } = invite;
    const url = invite.url || api.inviteUrl(invite.token);
    await ctx.reply(
      `${headline || '✅ נוצרה הזמנה ל'}<b>${fmt.esc(name)}</b>\n` +
        `👥 צד ${fmt.esc(fmt.sideLabel(side))}\n` +
        `📞 ${phone ? fmt.esc(phone) : '—'}\n` +
        `🔗 ${fmt.esc(url)}\n\n` +
        'הנוסח המוכן לשליחה בהודעה הבאה — אפשר להעתיק אותו כמו שהוא.',
      HTML,
    );
    // The printed invitation card with the text (and personal link) as its
    // caption — unformatted, so it can be copied straight into WhatsApp as-is;
    // the button opens WhatsApp on the guest's chat with it already written.
    const text = fmt.buildInvitationText(name, url);
    const reply_markup = ui.afterInvite(
      phone ? fmt.whatsappShareUrl(phone, text) : null,
      offerRename ? invite.token : null,
    );
    if (text.length <= fmt.CAPTION_LIMIT) {
      try {
        await ctx.replyWithPhoto(api.invitationCardUrl(), { caption: text, reply_markup });
        return;
      } catch (err) {
        // Telegram could not fetch the card: the text alone still does the job.
        log.error('[invite] could not send the invitation card:', err.message);
      }
    }
    await ctx.reply(text, { link_preview_options: { is_disabled: true }, reply_markup });
  }

  /** Create the invitation and hand back the link plus forwardable text. */
  async function finishInvite(ctx, { name, phone, side }, { offerRename = false } = {}) {
    await ui.endFlow(ctx.chat.id);
    try {
      const invite = await api.createInvite({ name, phone: phone || '', side });
      // The API echoes what it stored; fall back to what was asked for.
      await sendInviteResult(
        ctx,
        { ...invite, name: invite.name || name, phone: invite.phone || phone || '', side: invite.side || side },
        { offerRename },
      );
    } catch (err) {
      await ctx.reply(apiErrorMessage(err, 'יצירת הזמנות (POST /api/invites)'), {
        ...HTML,
        reply_markup: ui.backToMenu(),
      });
    }
  }

  bot.command('invite', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const raw = String(ctx.match || '').trim();
    if (!raw) {
      await askInviteName(ctx);
      return;
    }

    // The typed one-liner: name | phone | side.
    const parts = (raw.includes('|') ? raw.split('|') : raw.split(',')).map((p) => p.trim());
    const [name, phone, sideInput] = parts;

    if (!name) {
      await askInviteName(ctx);
      return;
    }
    // Given only a name, carry on through the steps rather than rejecting it.
    if (parts.length < 3) {
      await askInvitePhone(ctx, name);
      return;
    }

    const side = fmt.parseSide(sideInput);
    if (!side) {
      await ui.startFlow(ctx.chat.id, 'invite');
      await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_SIDE, data: { name, phone: phone || '' } });
      await ctx.reply(
        `⚠️ צד לא מוכר: "${fmt.esc(sideInput)}"\n\nבחרו צד:`,
        { ...HTML, reply_markup: ui.sideStep() },
      );
      return;
    }

    await finishInvite(ctx, { name, phone: phone || '', side });
  });

  // ─── The steps themselves ──────────────────────────────────────────────────

  /**
   * A shared contact becomes an invitation. Mid-invite it fills the phone
   * step; at any other time it starts a new invite with the contact's name
   * and number, so only the side is left to pick (one tap) before the link
   * and the ready-to-send text come back.
   */
  bot.on('message:contact', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const contact = ctx.message.contact;
    const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
    const phone = contact.phone_number || '';

    const flow = await ui.getFlow(ctx.chat.id);
    if (flow && flow.flow === 'invite' && flow.step === INVITE_STEP_PHONE) {
      const name = flow.data.name || contactName;
      await ui.advanceFlow(ctx.chat.id, { data: { name, phone } });
      await askInviteSide(ctx, name);
      return;
    }

    const name = contactName || phone;
    // With a default side there is nothing to ask: create it now, and offer
    // a different name on the result.
    const side = await defaultSideFor(ctx.chat.id);
    if (side) {
      await finishInvite(ctx, { name, phone, side }, { offerRename: true });
      return;
    }
    await ui.startFlow(ctx.chat.id, 'invite', { name, phone });
    await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_SIDE });
    await askContactSide(ctx, name, phone);
  });

  async function askContactSide(ctx, name, phone) {
    await ctx.reply(
      `📇 הזמנה ל<b>${fmt.esc(name)}</b>${phone ? ` · ${fmt.esc(phone)}` : ''}\n\n` +
        'לאיזה צד הם שייכים? (אפשר גם לתת להזמנה שם אחר)\n' +
        'טיפ: עם /side לא אשאל על הצד בכל פעם.',
      { ...HTML, reply_markup: ui.sideStep({ rename: true }) },
    );
  }

  // ─── Default side ──────────────────────────────────────────────────────────

  async function showDefaultSide(ctx) {
    const current = await defaultSideFor(ctx.chat.id);
    await ctx.reply(
      '⚙️ <b>צד ברירת מחדל</b>\n\n' +
        'הזמנות חדשות שלכם — גם מאיש קשר ששיתפתם — ייווצרו ישר בצד הזה, בלי לשאול.\n' +
        `כרגע: <b>${current ? fmt.esc(fmt.sideLabel(current)) : 'לשאול בכל פעם'}</b>`,
      { ...HTML, reply_markup: ui.defaultSideMenu(current) },
    );
  }

  async function saveDefaultSide(ctx, side) {
    try {
      const saved = await store.setDefaultSide(ctx.chat.id, side);
      await ctx.reply(
        saved
          ? `✅ מעכשיו הזמנות חדשות שלכם נוצרות בצד <b>${fmt.esc(fmt.sideLabel(saved))}</b> בלי לשאול.\nלשינוי: /side`
          : '✅ מעכשיו אשאל על הצד בכל הזמנה.',
        { ...HTML, reply_markup: ui.backToMenu() },
      );
    } catch (err) {
      await ctx.reply(apiErrorMessage(err, 'שמירת צד ברירת מחדל'), { ...HTML, reply_markup: ui.backToMenu() });
    }
  }

  bot.command('side', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const raw = String(ctx.match || '').trim();
    if (!raw) {
      await showDefaultSide(ctx);
      return;
    }
    if (/^(none|off|clear|ask|ללא|לשאול|בלי)$/i.test(raw)) {
      await saveDefaultSide(ctx, '');
      return;
    }
    const side = fmt.parseSide(raw);
    if (!side) {
      await ctx.reply(`⚠️ צד לא מוכר: "${fmt.esc(raw)}"`, HTML);
      await showDefaultSide(ctx);
      return;
    }
    await saveDefaultSide(ctx, side);
  });

  bot.callbackQuery(/^defside:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const choice = ctx.match[1];
    if (choice !== 'none' && !Object.prototype.hasOwnProperty.call(api.SIDES, choice)) {
      await showDefaultSide(ctx);
      return;
    }
    await saveDefaultSide(ctx, choice === 'none' ? '' : choice);
  });

  // ─── A different name for a contact's invite ───────────────────────────────

  // Before it exists: still choosing the side.
  bot.callbackQuery('invite:rename', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    const flow = await ui.getFlow(ctx.chat.id);
    if (!flow || flow.flow !== 'invite') {
      await ctx.reply('הבקשה פגה. שתפו את איש הקשר שוב.', { ...HTML, reply_markup: ui.mainMenu() });
      return;
    }
    await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_RENAME });
    await ctx.reply(
      `✏️ איזה שם לכתוב בהזמנה? (במקום "${fmt.esc(flow.data.name || '')}")`,
      { ...HTML, reply_markup: ui.cancelOnly() },
    );
  });

  // After it exists (made straight away with the default side): same link, new name.
  bot.callbackQuery(/^invite:rename:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;
    await ui.startFlow(ctx.chat.id, 'rename', { token: ctx.match[1] });
    await ctx.reply('✏️ איזה שם לכתוב בהזמנה? הקישור נשאר אותו קישור.', {
      ...HTML,
      reply_markup: ui.cancelOnly(),
    });
  });

  /** Free text is only ever an answer to a step the bot is waiting on. */
  bot.on('message:text', async (ctx, next) => {
    const text = String(ctx.message.text || '').trim();
    // Anything starting with "/" belongs to a command handler further down the
    // chain — pass it on rather than swallowing it.
    if (text.startsWith('/')) return next();

    const flow = await ui.getFlow(ctx.chat.id);
    if (!flow) return next();
    if (!(await requireAdmin(ctx))) return;

    if (flow.flow === 'search') {
      await ui.endFlow(ctx.chat.id);
      await runSearch(ctx, text);
      return;
    }

    if (flow.flow === 'rename') {
      if (!text) {
        await ctx.reply('צריך שם. נסו שוב:', { ...HTML, reply_markup: ui.cancelOnly() });
        return;
      }
      await ui.endFlow(ctx.chat.id);
      try {
        const invite = await api.updateInvite(flow.data.token, { name: text });
        await sendInviteResult(ctx, invite, { headline: '✏️ השם עודכן: ', offerRename: true });
      } catch (err) {
        await ctx.reply(apiErrorMessage(err, 'עדכון הזמנה (PATCH /api/invites)'), {
          ...HTML,
          reply_markup: ui.backToMenu(),
        });
      }
      return;
    }

    if (flow.flow !== 'invite') return next();

    if (flow.step === INVITE_STEP_NAME) {
      if (!text) {
        await ctx.reply('צריך שם. נסו שוב:', { ...HTML, reply_markup: ui.cancelOnly() });
        return;
      }
      await askInvitePhone(ctx, text);
      return;
    }

    if (flow.step === INVITE_STEP_PHONE) {
      await ui.advanceFlow(ctx.chat.id, { data: { phone: text } });
      await askInviteSide(ctx, flow.data.name);
      return;
    }

    if (flow.step === INVITE_STEP_RENAME) {
      if (!text) {
        await ctx.reply('צריך שם. נסו שוב:', { ...HTML, reply_markup: ui.cancelOnly() });
        return;
      }
      await ui.advanceFlow(ctx.chat.id, { step: INVITE_STEP_SIDE, data: { name: text } });
      await askContactSide(ctx, text, flow.data.phone || '');
      return;
    }

    if (flow.step === INVITE_STEP_SIDE) {
      // They typed the side instead of tapping it — accept that too.
      const side = fmt.parseSide(text);
      if (!side) {
        await ctx.reply(
          `⚠️ לא זיהיתי את הצד "${fmt.esc(text)}". בחרו מהכפתורים:`,
          { ...HTML, reply_markup: ui.sideStep() },
        );
        return;
      }
      await finishInvite(ctx, { ...flow.data, side });
    }
  });

  // ─── Buttons ───────────────────────────────────────────────────────────────

  bot.callbackQuery('flow:cancel', async (ctx) => {
    await ui.endFlow(ctx.chat.id);
    await ctx.answerCallbackQuery('בוטל');
    await ctx.reply('בוטל. מה עכשיו?', { ...HTML, reply_markup: ui.mainMenu() });
  });

  bot.callbackQuery(/^invite:side:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await requireAdmin(ctx))) return;

    const side = ctx.match[1];
    const flow = await ui.getFlow(ctx.chat.id);
    if (!flow || flow.flow !== 'invite') {
      await ctx.reply('הבקשה פגה. התחילו מחדש:', { ...HTML, reply_markup: ui.mainMenu() });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(api.SIDES, side)) {
      await ctx.reply('צד לא מוכר. בחרו שוב:', { ...HTML, reply_markup: ui.sideStep() });
      return;
    }
    await finishInvite(ctx, { ...flow.data, side });
  });

  bot.callbackQuery('invite:nophone', async (ctx) => {
    await ctx.answerCallbackQuery();
    const flow = await ui.getFlow(ctx.chat.id);
    if (!flow || flow.flow !== 'invite') {
      await ctx.reply('הבקשה פגה. התחילו מחדש:', { ...HTML, reply_markup: ui.mainMenu() });
      return;
    }
    await ui.advanceFlow(ctx.chat.id, { data: { phone: '' } });
    await askInviteSide(ctx, flow.data.name);
  });

  bot.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const what = ctx.match[1];

    if (what === 'home') {
      await ui.endFlow(ctx.chat.id);
      await ctx.reply('מה תרצו לעשות?', { ...HTML, reply_markup: ui.mainMenu() });
      return;
    }
    if (what === 'help') {
      await ctx.reply(fmt.HELP, { ...HTML, reply_markup: ui.backToMenu() });
      return;
    }
    if (what === 'side') {
      if (!(await requireAdmin(ctx))) return;
      await showDefaultSide(ctx);
      return;
    }
    if (!(await requireAdmin(ctx))) return;

    if (what === 'stats') return actions.stats(ctx);
    if (what === 'rsvps') return actions.rsvps(ctx);
    if (what === 'pending') return actions.pending(ctx);
    if (what === 'export') return actions.export(ctx);
    if (what === 'invite') return askInviteName(ctx);
    if (what === 'search') return askSearchTerm(ctx);
  });

  // ─── Broadcasting ──────────────────────────────────────────────────────────

  /**
   * Send `text` to every subscriber. Chats that blocked or deleted the bot are
   * pruned from the registry; nothing here is allowed to throw.
   */
  async function broadcast(text) {
    const subscribers = await store.all();
    let sent = 0;
    let dropped = 0;

    for (const sub of subscribers) {
      try {
        await bot.api.sendMessage(sub.chat_id, text, HTML);
        sent += 1;
      } catch (err) {
        if (isDeadChat(err)) {
          // A failed prune must not abort the loop: everyone after this chat
          // would miss the RSVP.
          try {
            await store.remove(sub.chat_id);
          } catch (removeErr) {
            log.error(`[broadcast] could not remove ${sub.chat_id}:`, removeErr && removeErr.message);
          }
          dropped += 1;
          log.log(`[broadcast] removed unreachable subscriber ${sub.chat_id}`);
        } else {
          log.error(`[broadcast] send to ${sub.chat_id} failed:`, err.message);
        }
      }
      await sleep(50); // stay under Telegram's ~30 messages/second ceiling
    }

    return { total: subscribers.length, sent, dropped };
  }

  // ─── Daily export ──────────────────────────────────────────────────────────

  /**
   * The scheduled job, also reused by /exportall. Building it once here keeps
   * the cron run and the manual command on exactly the same code path.
   */
  const exportJob = schedule.createDailyExportJob({
    listSubscribers: () => store.all(),
    removeSubscriber: (chatId) => store.remove(chatId),
    isDeadChat,
    sendDocument: sendExportDocument,
    sendMessage: (chatId, text) => bot.api.sendMessage(chatId, text, HTML),
    log,
  });

  bot.command('exportall', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const subscribers = (await store.all()).length;
    if (!subscribers) {
      await ctx.reply('אין מנויים לשלוח אליהם. שלחו /start כדי להירשם.');
      return;
    }

    await ctx.reply(`שולח את הדוח ל-${subscribers} מנויים… ⏳`);
    const result = await exportJob();

    if (result.notice) {
      await ctx.reply(`⚠️ הדוח לא נוצר — נשלחה הודעת הסבר ל-${result.sent}/${result.total} מנויים.`);
      return;
    }
    await ctx.reply(
      `📤 הדוח נשלח ל-${result.sent}/${result.total} מנויים` +
        (result.dropped ? ` (${result.dropped} הוסרו — חסמו את הבוט)` : '') +
        '.',
    );
  });

  // ─── Resilience ────────────────────────────────────────────────────────────

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) log.error('[bot] Telegram error:', e.description);
    else if (e instanceof HttpError) log.error('[bot] network error:', e.message);
    else log.error('[bot] handler error:', e && e.message ? e.message : e);
  });

  return { bot, broadcast, isAdmin, exportJob, sendExportDocument, HTML };
}

/** Constant-time comparison for the shared secret on the notify endpoint. */
function secretMatches(provided, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

module.exports = { createBot, isDeadChat, secretMatches, COMMANDS, HTML };
