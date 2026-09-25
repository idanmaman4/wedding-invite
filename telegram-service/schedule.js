'use strict';

/**
 * The daily export schedule.
 *
 * One mechanism only: a **cron expression** evaluated by `node-cron` in an
 * explicit timezone. `DAILY_EXPORT_HOUR` is nothing more than sugar that builds
 * the expression `0 <hour> * * *` when `DAILY_EXPORT_CRON` is not set.
 *
 * The job itself (`createDailyExportJob`) takes every side effect as an
 * injected dependency, so a test can run it with a stubbed `sendDocument` and
 * assert on the fan-out without touching Telegram.
 *
 * This only ever fires while the process is alive — see the README.
 */

const exporter = require('./export');

// node-cron is only needed by the long-running launcher. The serverless
// functions on Vercel import this module for createDailyExportJob and never
// schedule anything, and their root install does not carry node-cron — so it
// is required only when start() actually runs.
let cron = null;
function loadCron() {
  if (!cron) cron = require('node-cron');
  return cron;
}

const DEFAULT_CRON = '0 9 * * *'; // 09:00 every day

const FALSEY = new Set(['0', 'false', 'no', 'off', 'disabled']);

function isEnabled(env = process.env) {
  const raw = String(env.DAILY_EXPORT_ENABLED == null ? '' : env.DAILY_EXPORT_ENABLED).trim().toLowerCase();
  if (!raw) return true;
  return !FALSEY.has(raw);
}

/** `DAILY_EXPORT_CRON` wins; `DAILY_EXPORT_HOUR` is shorthand; else 09:00. */
function cronExpression(env = process.env) {
  const explicit = String(env.DAILY_EXPORT_CRON || '').trim();
  if (explicit) return explicit;

  const hourRaw = String(env.DAILY_EXPORT_HOUR == null ? '' : env.DAILY_EXPORT_HOUR).trim();
  if (hourRaw) {
    const hour = Number(hourRaw);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return `0 ${hour} * * *`;
    console.error(`[export] DAILY_EXPORT_HOUR="${hourRaw}" is not an hour 0–23 — falling back to ${DEFAULT_CRON}`);
  }
  return DEFAULT_CRON;
}

function describeSchedule(env = process.env) {
  return {
    enabled: isEnabled(env),
    expression: cronExpression(env),
    timezone: exporter.exportTimezone(env),
  };
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Send one thing to every subscriber. Chats that blocked or deleted the bot are
 * pruned from the registry — exactly what the RSVP broadcast does. Nothing in
 * here is allowed to throw.
 */
async function fanOut(subscribers, send, { removeSubscriber, isDeadChat, delayMs = 50, log = console }) {
  let sent = 0;
  let dropped = 0;

  for (const sub of subscribers) {
    try {
      await send(sub.chat_id);
      sent += 1;
    } catch (err) {
      if (isDeadChat(err)) {
        try {
          await removeSubscriber(sub.chat_id);
        } catch (removeErr) {
          log.error(`[export] could not remove ${sub.chat_id}:`, removeErr && removeErr.message ? removeErr.message : removeErr);
        }
        dropped += 1;
        log.log(`[export] removed unreachable subscriber ${sub.chat_id}`);
      } else {
        log.error(`[export] send to ${sub.chat_id} failed:`, err && err.message ? err.message : err);
      }
    }
    await sleep(delayMs);
  }

  return { total: subscribers.length, sent, dropped };
}

/**
 * Build the job function. Dependencies:
 *   listSubscribers() -> [{chat_id}]
 *   removeSubscriber(chatId)
 *   isDeadChat(err) -> boolean
 *   sendDocument(chatId, filePath, fileName, caption)
 *   sendMessage(chatId, html)
 *   buildExport({now})   (optional — defaults to the real one)
 *   now()                (optional — defaults to `new Date()`)
 */
function createDailyExportJob({
  listSubscribers,
  removeSubscriber,
  isDeadChat,
  sendDocument,
  sendMessage,
  buildExport = exporter.buildExport,
  now = () => new Date(),
  delayMs = 50,
  log = console,
} = {}) {
  for (const [name, fn] of Object.entries({ listSubscribers, removeSubscriber, isDeadChat, sendDocument, sendMessage })) {
    if (typeof fn !== 'function') throw new TypeError(`createDailyExportJob: ${name} must be a function`);
  }

  return async function runDailyExport() {
    // Either backend: a plain array from the file, or a promise from the API.
    const subscribers = (await listSubscribers()) || [];
    const at = now();

    if (!subscribers.length) {
      log.log('[export] no subscribers — nothing to send');
      return { total: 0, sent: 0, dropped: 0, notice: false, skipped: true };
    }

    let built = null;
    try {
      built = await buildExport({ now: at });
    } catch (err) {
      // The API could not be read at all: a short Hebrew notice, never a
      // broken file, and never a crash.
      log.error('[export] could not build the workbook:', err && err.message ? err.message : err);
      const notice = exporter.fallbackNotice(err, { now: at });
      const result = await fanOut(subscribers, (chatId) => sendMessage(chatId, notice), {
        removeSubscriber,
        isDeadChat,
        delayMs,
        log,
      });
      return { ...result, notice: true, error: err };
    }

    try {
      const result = await fanOut(
        subscribers,
        (chatId) => sendDocument(chatId, built.filePath, built.fileName, built.caption),
        { removeSubscriber, isDeadChat, delayMs, log },
      );
      log.log(`[export] ${built.fileName} — sent ${result.sent}/${result.total}, dropped ${result.dropped}`);
      return { ...result, notice: false, fileName: built.fileName, filePath: built.filePath, partial: built.partial };
    } finally {
      // Never leave the workbook lying around in the temp dir.
      built.cleanup();
    }
  };
}

let task = null;

/** Schedule the job. Returns the node-cron task, or null when not scheduled. */
function start(deps, env = process.env) {
  const { enabled, expression, timezone } = describeSchedule(env);
  if (!enabled) {
    console.log('[export] daily export is disabled (DAILY_EXPORT_ENABLED)');
    return null;
  }
  const cron = loadCron();
  if (!cron.validate(expression)) {
    console.error(`[export] DAILY_EXPORT_CRON="${expression}" is not a valid cron expression — no export scheduled`);
    return null;
  }

  const job = createDailyExportJob(deps);
  stop();
  task = cron.schedule(
    expression,
    async () => {
      try {
        await job();
      } catch (err) {
        console.error('[export] scheduled run failed:', err && err.message ? err.message : err);
      }
    },
    { timezone, name: 'daily-export', noOverlap: true },
  );

  const next = typeof task.getNextRun === 'function' ? task.getNextRun() : null;
  console.log(
    `Daily export scheduled: "${expression}" (${timezone})` + (next ? ` — next run ${next.toISOString()}` : ''),
  );
  return task;
}

function stop() {
  if (!task) return;
  try {
    task.stop();
    if (typeof task.destroy === 'function') task.destroy();
  } catch {
    /* shutting down anyway */
  }
  task = null;
}

const currentTask = () => task;

module.exports = {
  DEFAULT_CRON,
  isEnabled,
  cronExpression,
  describeSchedule,
  fanOut,
  createDailyExportJob,
  start,
  stop,
  currentTask,
};
