import Imap from 'node-imap';
import nodemailer from 'nodemailer';

/** Serialises `mailOptions` to a raw RFC 2822 buffer without sending anything. */
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

/** Opens an IMAP connection and resolves with the connected `Imap` instance. */
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

/** Returns a flat list of all mailbox names (including nested, with delimiter). */
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

/** Appends a raw message buffer to `mailbox`, marking it as read. */
function appendToBox(imap, mailbox, raw) {
  return new Promise((resolve, reject) => {
    imap.append(raw, { mailbox, flags: ['\\Seen'] }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

/** Creates a new mailbox folder with the given name. */
function createBox(imap, name) {
  return new Promise((resolve, reject) => {
    imap.addBox(name, (err) => { if (err) reject(err); else resolve(); });
  });
}

/** Appends `raw` to the remote Sent folder, creating it if none of the standard names exist. */
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

/** Saves `mailOptions` to the IMAP Sent folder. No-ops if `imapConfig` is falsy. */
export async function saveToSent(imapConfig, mailOptions) {
  if (!imapConfig) return;
  const raw = await buildRawMessage(mailOptions);
  await appendViaImap(imapConfig, raw);
}
