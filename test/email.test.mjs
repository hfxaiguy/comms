import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Point email.mjs at test fixtures before it loads
process.env.EMAIL_TEMPLATES_DIR = path.join(__dirname, 'fixtures', 'email-templates');
process.env.EMAIL_CONFIG_PATH   = path.join(__dirname, 'fixtures', 'email.config.json');

// ─── Mutable state captured by mocks via closure ──────────────────────────
// Reassigning these between tests works because closures capture the binding.

let sentEmails         = [];
let loggedMessages     = [];
let blastResponses     = [];  // queue of 'send'|'skip'|'rest' per previewEmailBlast call
let restConfirmed      = true;
let capturedRestPeople = [];
let currentProfiles    = [];

// ─── Module mocks (registered before email.mjs is imported) ───────────────

mock.module('nodemailer', {
  exports: {
    default: {
      createTransport: () => ({
        sendMail: async (opts) => sentEmails.push({ ...opts }),
      }),
    },
  },
});

mock.module('../src/profiles.mjs', {
  exports: {
    loadProfiles: async () => currentProfiles,
    logMessage:   async (...args) => loggedMessages.push(args),
    loadConfig:   () => ({ spreadsheets: [] }),
  },
});

mock.module('../src/prompt.mjs', {
  exports: {
    previewEmailBlast: async () => blastResponses.shift() ?? 'skip',
    confirmSendToRest: async (people) => { capturedRestPeople = people; return restConfirmed; },
    previewEmail:      async () => true,
  },
});

// Import under test AFTER mocks are registered
const { sendBlast, sendEmail } = await import('../src/email.mjs');

// ─── Helpers ──────────────────────────────────────────────────────────────

function reset() {
  sentEmails         = [];
  loggedMessages     = [];
  blastResponses     = [];
  restConfirmed      = true;
  capturedRestPeople = [];
  currentProfiles    = [];
}

function makeProfile(firstName, lastName, email, { group = 'TestGroup', sentTemplates = [] } = {}) {
  return {
    firstName, lastName, group,
    emails:   email ? [{ address: email }] : [],
    messages: sentTemplates.map(t => ({
      templateName: t, text: '', dateSent: '', status: '', channel: '',
    })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

test('throws when group has no members', async () => {
  reset();
  currentProfiles = [makeProfile('Alice', 'Smith', 'alice@test.com', { group: 'Other' })];

  await assert.rejects(
    () => sendBlast('TestGroup', 'hello'),
    /No people found in group/,
  );
});

test('exits early and sends nothing when everyone already received the template', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com', { sentTemplates: ['hello'] }),
    makeProfile('Bob',   'Jones', 'bob@test.com',   { sentTemplates: ['hello'] }),
  ];

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 0);
});

test('skips recipients who already received the template', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com', { sentTemplates: ['hello'] }),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
  ];
  blastResponses = ['send'];

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'bob@test.com');
});

test('skips recipients without an email address', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', null),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
  ];
  blastResponses = ['send'];

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'bob@test.com');
});

test('each individually reviewed email is templated for that recipient', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com'),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
  ];
  blastResponses = ['send', 'send'];

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 2);
  assert.match(sentEmails[0].subject, /Alice/);
  assert.match(sentEmails[0].text,    /Alice Smith/);
  assert.match(sentEmails[1].subject, /Bob/);
  assert.match(sentEmails[1].text,    /Bob Jones/);
});

// ── Critical test ──────────────────────────────────────────────────────────
test('send to rest: every recipient gets their own personalised email', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com'),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
    makeProfile('Carol', 'Lee',   'carol@test.com'),
  ];
  // Choose "send to rest" on Alice's preview, then confirm
  blastResponses = ['rest'];
  restConfirmed  = true;

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 3, 'all three recipients should receive an email');

  const byTo = Object.fromEntries(sentEmails.map(e => [e.to, e]));

  assert.ok(byTo['alice@test.com'], 'Alice should receive an email');
  assert.match(byTo['alice@test.com'].subject, /Alice/,      'Alice subject contains her name');
  assert.match(byTo['alice@test.com'].text,    /Alice Smith/, 'Alice body contains her full name');

  assert.ok(byTo['bob@test.com'], 'Bob should receive an email');
  assert.match(byTo['bob@test.com'].subject, /Bob/,       'Bob subject contains his name');
  assert.match(byTo['bob@test.com'].text,    /Bob Jones/, 'Bob body contains his full name');

  assert.ok(byTo['carol@test.com'], 'Carol should receive an email');
  assert.match(byTo['carol@test.com'].subject, /Carol/,   'Carol subject contains her name');
  assert.match(byTo['carol@test.com'].text,    /Carol Lee/, 'Carol body contains her full name');
});
// ──────────────────────────────────────────────────────────────────────────

test('send to rest: subjects are not all the same (no template caching bug)', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com'),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
    makeProfile('Carol', 'Lee',   'carol@test.com'),
  ];
  blastResponses = ['rest'];
  restConfirmed  = true;

  await sendBlast('TestGroup', 'hello');

  const subjects = sentEmails.map(e => e.subject);
  const unique   = new Set(subjects);
  assert.equal(unique.size, 3, `all subjects should be unique, got: ${subjects.join(', ')}`);
});

test('send to rest declined: falls back to individual review', async () => {
  reset();
  currentProfiles = [
    makeProfile('Alice', 'Smith', 'alice@test.com'),
    makeProfile('Bob',   'Jones', 'bob@test.com'),
  ];
  // Decline "send to rest", then skip both individually
  blastResponses = ['rest', 'skip', 'skip'];
  restConfirmed  = false;

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails.length, 0, 'nothing sent when rest declined and all skipped');
});

test('logs each sent email with the correct template name', async () => {
  reset();
  currentProfiles = [makeProfile('Alice', 'Smith', 'alice@test.com')];
  blastResponses = ['send'];

  await sendBlast('TestGroup', 'hello');

  assert.equal(loggedMessages.length, 1);
  const [firstName, , , , templateName] = loggedMessages[0];
  assert.equal(firstName,    'Alice');
  assert.equal(templateName, 'hello');
});

test('uses the group-specific from address', async () => {
  reset();
  currentProfiles = [makeProfile('Alice', 'Smith', 'alice@test.com', { group: 'VIP' })];
  blastResponses = ['send'];

  await sendBlast('VIP', 'hello');

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].from, 'VIP Account <vip@example.com>');
});

test('uses the default from address for unmapped groups', async () => {
  reset();
  currentProfiles = [makeProfile('Alice', 'Smith', 'alice@test.com')];
  blastResponses = ['send'];

  await sendBlast('TestGroup', 'hello');

  assert.equal(sentEmails[0].from, 'Test Sender <test@example.com>');
});
