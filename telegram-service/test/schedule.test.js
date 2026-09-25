'use strict';

/**
 * The daily-export job, driven directly with stubbed Telegram calls.
 * No polling is started and no message ever leaves the process.
 *
 *   node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const cron = require('node-cron');
const schedule = require('../schedule');
const exporter = require('../export');
const { NOW, invites, guests } = require('./fixtures');

const BLOCKED = 'blocked-chat';
const isDeadChat = (err) => Boolean(err && err.kind === BLOCKED);
const deadChatError = () => Object.assign(new Error('Forbidden: bot was blocked by the user'), { kind: BLOCKED });

const quiet = { log() {}, error() {} };

/** A stand-in for the real builder that uses the fixtures instead of the API. */
const fakeBuildExport = ({ now }) =>
  exporter.buildExport({
    now,
    tz: 'Asia/Jerusalem',
    collect: async () => ({ invites, guests, stats: null, partial: false }),
  });

function harness(overrides = {}) {
  const state = {
    subscribers: [{ chat_id: 111 }, { chat_id: 222 }, { chat_id: 333 }],
    documents: [],
    messages: [],
    removed: [],
  };

  const deps = {
    listSubscribers: () => state.subscribers.slice(),
    removeSubscriber: (chatId) => {
      state.removed.push(chatId);
      state.subscribers = state.subscribers.filter((s) => s.chat_id !== chatId);
    },
    isDeadChat,
    sendDocument: async (chatId, filePath, fileName, caption) => {
      state.documents.push({ chatId, filePath, fileName, caption });
    },
    sendMessage: async (chatId, text) => {
      state.messages.push({ chatId, text });
    },
    buildExport: fakeBuildExport,
    now: () => NOW,
    delayMs: 0,
    log: quiet,
    ...overrides,
  };

  return { state, deps, job: schedule.createDailyExportJob(deps) };
}

// ─── Configuration ───────────────────────────────────────────────────────────

test('the cron expression defaults to 09:00 daily', () => {
  assert.equal(schedule.cronExpression({}), '0 9 * * *');
  assert.equal(schedule.DEFAULT_CRON, '0 9 * * *');
});

test('DAILY_EXPORT_CRON wins, DAILY_EXPORT_HOUR is shorthand, junk falls back', () => {
  assert.equal(schedule.cronExpression({ DAILY_EXPORT_CRON: '30 7 * * 1' }), '30 7 * * 1');
  assert.equal(schedule.cronExpression({ DAILY_EXPORT_HOUR: '20' }), '0 20 * * *');
  assert.equal(schedule.cronExpression({ DAILY_EXPORT_HOUR: '0' }), '0 0 * * *');
  assert.equal(
    schedule.cronExpression({ DAILY_EXPORT_CRON: '15 6 * * *', DAILY_EXPORT_HOUR: '20' }),
    '15 6 * * *',
  );
  const previous = console.error;
  console.error = () => {};
  try {
    assert.equal(schedule.cronExpression({ DAILY_EXPORT_HOUR: '99' }), '0 9 * * *');
  } finally {
    console.error = previous;
  }
});

test('the default schedule is a valid cron expression for node-cron', () => {
  const { expression, timezone, enabled } = schedule.describeSchedule({});
  assert.equal(cron.validate(expression), true);
  assert.equal(timezone, 'Asia/Jerusalem');
  assert.equal(enabled, true);
});

test('DAILY_EXPORT_ENABLED can switch the schedule off', () => {
  assert.equal(schedule.isEnabled({}), true);
  assert.equal(schedule.isEnabled({ DAILY_EXPORT_ENABLED: 'true' }), true);
  for (const off of ['0', 'false', 'no', 'off']) {
    assert.equal(schedule.isEnabled({ DAILY_EXPORT_ENABLED: off }), false, off);
  }
  const previous = console.log;
  console.log = () => {};
  try {
    assert.equal(schedule.start({}, { DAILY_EXPORT_ENABLED: 'false' }), null);
  } finally {
    console.log = previous;
    schedule.stop();
  }
});

test('createDailyExportJob refuses to build without its dependencies', () => {
  assert.throws(() => schedule.createDailyExportJob({}), TypeError);
});

// ─── The job ─────────────────────────────────────────────────────────────────

test('the job sends the document once per subscriber and cleans the temp file up', async () => {
  const { state, job } = harness();
  const result = await job();

  assert.equal(result.notice, false);
  assert.equal(result.total, 3);
  assert.equal(result.sent, 3);
  assert.equal(result.dropped, 0);
  assert.equal(state.documents.length, 3, 'one sendDocument per subscriber');
  assert.deepEqual(
    state.documents.map((d) => d.chatId),
    [111, 222, 333],
  );
  assert.equal(state.messages.length, 0);

  const [first] = state.documents;
  assert.equal(first.fileName, 'wedding-rsvp-2026-09-04.xlsx');
  assert.match(first.caption, /הזמנות: <b>7<\/b>/);
  // Every subscriber gets the same file, built once.
  assert.equal(new Set(state.documents.map((d) => d.filePath)).size, 1);

  assert.equal(fs.existsSync(result.filePath), false, 'the temp file is deleted after sending');
});

test('a blocked chat is dropped from the registry and the rest still get the file', async () => {
  let attempts = 0;
  const bag = { documents: [] };
  const { state, job } = harness({
    sendDocument: async (chatId, filePath, fileName, caption) => {
      attempts += 1;
      if (chatId === 222) throw deadChatError();
      bag.documents.push({ chatId, filePath, fileName, caption });
    },
  });

  const result = await job();

  assert.equal(attempts, 3, 'every subscriber was still attempted');
  assert.equal(result.sent, 2);
  assert.equal(result.dropped, 1);
  assert.deepEqual(state.removed, [222], 'the blocked chat is pruned from the registry');
  assert.deepEqual(state.subscribers.map((x) => x.chat_id), [111, 333]);
  assert.deepEqual(bag.documents.map((d) => d.chatId), [111, 333]);
  assert.equal(fs.existsSync(result.filePath), false);
});

test('an ordinary send failure is logged but never drops the subscriber', async () => {
  const { state, job } = harness({
    sendDocument: async (chatId) => {
      if (chatId === 111) throw new Error('Too Many Requests: retry after 3');
    },
  });
  const result = await job();
  assert.equal(result.sent, 2);
  assert.equal(result.dropped, 0);
  assert.deepEqual(state.removed, []);
});

test('an API failure sends the Hebrew notice instead of a file', async () => {
  const { state, job } = harness({
    buildExport: async () => {
      throw new exporter.ExportDataError('GET /api/invites לא קיים ב-API');
    },
  });

  const result = await job();

  assert.equal(result.notice, true);
  assert.equal(result.sent, 3);
  assert.equal(state.documents.length, 0, 'no broken file is sent');
  assert.equal(state.messages.length, 3, 'one notice per subscriber');
  for (const m of state.messages) {
    assert.match(m.text, /הדוח היומי/);
    assert.match(m.text, /GET \/api\/invites/);
  }
});

test('a blocked chat is pruned on the notice path too', async () => {
  const { state, job } = harness({
    buildExport: async () => {
      throw new exporter.ExportDataError('ה-API החזיר 500');
    },
    sendMessage: async (chatId) => {
      if (chatId === 333) throw deadChatError();
    },
  });
  const result = await job();
  assert.equal(result.notice, true);
  assert.equal(result.dropped, 1);
  assert.deepEqual(state.removed, [333]);
});

test('an unexpected build crash is still handled as a notice, not a throw', async () => {
  const { state, job } = harness({
    buildExport: async () => {
      throw new Error('EACCES: permission denied, mkdtemp');
    },
  });
  const result = await job();
  assert.equal(result.notice, true);
  assert.equal(state.messages.length, 3);
});

test('with no subscribers nothing is built and nothing is sent', async () => {
  const { state, job } = harness({
    listSubscribers: () => [],
    buildExport: async () => {
      throw new Error('buildExport must not be called');
    },
  });
  const result = await job();
  assert.deepEqual(result, { total: 0, sent: 0, dropped: 0, notice: false, skipped: true });
  assert.equal(state.documents.length, 0);
  assert.equal(state.messages.length, 0);
});

// ─── Wiring ──────────────────────────────────────────────────────────────────

test('start() registers a task that runs the job, and stop() removes it', async () => {
  const { state } = harness();
  const previous = console.log;
  console.log = () => {};
  let task;
  try {
    task = schedule.start(
      {
        listSubscribers: () => state.subscribers.slice(),
        removeSubscriber: () => {},
        isDeadChat,
        sendDocument: async (chatId, filePath, fileName, caption) =>
          state.documents.push({ chatId, filePath, fileName, caption }),
        sendMessage: async () => {},
        buildExport: fakeBuildExport,
        now: () => NOW,
        delayMs: 0,
        log: quiet,
      },
      { DAILY_EXPORT_CRON: '0 9 * * *', DAILY_EXPORT_TZ: 'Asia/Jerusalem' },
    );

    assert.ok(task, 'a task was scheduled');
    assert.equal(task.getPattern(), '0 9 * * *');
    assert.ok(task.getNextRun() instanceof Date);
    assert.equal(schedule.currentTask(), task);

    // Fire it by hand — no waiting for 09:00, no Telegram.
    await task.execute();
    assert.equal(state.documents.length, 3);
    for (const d of state.documents) assert.equal(fs.existsSync(d.filePath), false);
  } finally {
    schedule.stop();
    console.log = previous;
  }
  assert.equal(schedule.currentTask(), null);
});

test('an invalid cron expression is refused instead of crashing the bot', () => {
  const previous = console.error;
  console.error = () => {};
  try {
    const { deps } = harness();
    assert.equal(schedule.start(deps, { DAILY_EXPORT_CRON: 'not a cron' }), null);
    assert.equal(schedule.currentTask(), null);
  } finally {
    console.error = previous;
    schedule.stop();
  }
});
