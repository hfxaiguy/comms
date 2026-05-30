import Imap from 'node-imap';
import nodemailer from 'nodemailer';

// Build a raw RFC 2822 message buffer from mail options using nodemailer's
// stream transport (sends nothing, just serialises the message).
async function buildRawMessage(mailOptions) {
  const transport = nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
  const info = await transport.sendMail(mailOptions);
  return new Promise((resolve, reject) => {
    const chunks = [];
    info.message.on('data',  c => chunks.push(c));
    info.message.on('end',   () => resolve(Buffer.concat(chunks)));
    info.message.on('error', reject);
  });
}

const SENT_CANDIDATES = ['Sent', 'Sent Mail', 'Sent Messages', 'INBOX.Sent'];

function connectImap(imapConfig) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user:     imapConfig.auth.user,
      password: imapConfig.auth.pass,
      host:     imapConfig.host,
      port:     imapConfig.port ?? 993,
      tls:      imapConfig.tls  ?? true,
    });
    imap.once('ready', () => resolve(imap));
    imap.once('error', reject);
    imap.connect();
  });
}

function getBoxNames(imap) {
  return new Promise((resolve, reject) => {
    imap.getBoxes((err, boxes) => {
      if (err) return reject(err);
      const names = [];
      function collect(tree, prefix = '') {
        for (const [name, box] of Object.entries(tree)) {
          const full = prefix + name;
          names.push(full);
          if (box.children) collect(box.children, full + (box.delimiter ?? '/'));
        }
      }
      collect(boxes);
      resolve(names);
    });
  });
}

function appendToBox(imap, mailbox, raw) {
  return new Promise((resolve, reject) => {
    imap.append(raw, { mailbox, flags: ['\\Seen'] }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function createBox(imap, name) {
  return new Promise((resolve, reject) => {
    imap.addBox(name, (err) => { if (err) reject(err); else resolve(); });
  });
}

// Append a raw message buffer to the remote Sent folder via IMAP.
async function appendViaImap(imapConfig, raw) {
  const imap = await connectImap(imapConfig);
  try {
    const configured = imapConfig.sentFolder;
    let mailbox;

    if (configured) {
      mailbox = configured;
    } else {
      const boxes = await getBoxNames(imap);
      mailbox = SENT_CANDIDATES.find(c => boxes.some(b => b.toLowerCase() === c.toLowerCase()));
      if (!mailbox) {
        mailbox = 'Sent';
        await createBox(imap, mailbox);
      }
    }

    await appendToBox(imap, mailbox, raw);
  } finally {
    imap.end();
  }
}

// Call this after a successful SMTP send. No-ops if imapConfig is falsy.
export async function saveToSent(imapConfig, mailOptions) {
  if (!imapConfig) return;
  const raw = await buildRawMessage(mailOptions);
  await appendViaImap(imapConfig, raw);
}
