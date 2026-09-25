'use strict';

/** Shared fixtures: a fake whatsapp-web.js client and a throwaway HTTP server. */

const { createApp } = require('../app');

/** Records every sendMessage instead of talking to WhatsApp. */
function fakeClient(opts = {}) {
  const sent = [];
  return {
    sent,
    contacts: opts.contacts || [],
    destroyed: false,
    async sendMessage(chatId, body) {
      if (opts.failOn && opts.failOn(chatId, body)) throw new Error('send failed');
      sent.push({ chatId, body });
      return { id: 'msg_' + sent.length };
    },
    async getContacts() {
      if (opts.contactsThrow) throw new Error('getContacts boom');
      return opts.contacts || [];
    },
    async destroy() {
      this.destroyed = true;
    },
  };
}

function contact(over = {}) {
  const user = over.user || '972501234567';
  return {
    id: { _serialized: `${user}@c.us`, user, server: 'c.us' },
    number: over.number === undefined ? user : over.number,
    name: over.name,
    pushname: over.pushname,
    shortName: over.shortName,
    verifiedName: over.verifiedName,
    isMyContact: over.isMyContact === undefined ? true : over.isMyContact,
    isGroup: Boolean(over.isGroup),
    isMe: Boolean(over.isMe),
    ...(over.id ? { id: over.id } : {}),
  };
}

const silent = { log() {}, error() {}, warn() {} };

/**
 * Boot the app on an ephemeral port. Returns `{ url, sessions, initCalls, close }`.
 * Bulk delays default to 0 so the sequencing tests do not sleep for real.
 */
async function startApp(over = {}) {
  const sessions = over.sessions || {
    idan: { client: fakeClient(), status: 'connected', qrDataUrl: null },
    vered: { client: null, status: 'disconnected', qrDataUrl: null },
  };
  const initCalls = [];
  const app = createApp({
    sessions,
    initClient: (sender) => {
      initCalls.push(sender);
      sessions[sender].status = 'initializing';
    },
    waKey: over.waKey || '',
    siteUrl: over.siteUrl || 'https://example.test',
    minDelay: over.minDelay === undefined ? 0 : over.minDelay,
    maxDelay: over.maxDelay === undefined ? 0 : over.maxDelay,
    log: silent,
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    sessions,
    initCalls,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** fetch + parsed JSON body in one call. */
async function req(url, path, init = {}) {
  const res = await fetch(url + path, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, headers: res.headers, body, text };
}

const json = (obj) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

module.exports = { fakeClient, contact, startApp, req, json, silent };
