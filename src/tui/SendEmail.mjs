import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import nodemailer from 'nodemailer';
import { getAttributes, logMessage } from '../db.mjs';
import {
  listTemplates, parseTemplate, extractAiVars,
  buildProfileVars, generateAiVars, resolveAll,
  getEmailAccount, isMarkdownTemplate, markdownToHtml,
} from '../templates.mjs';
import { saveToSent } from '../imap.mjs';

const h = React.createElement;

export default function SendEmail({ profileId, onBack }) {
  const { rows }   = useWindowSize();
  const attrs      = useMemo(() => getAttributes(profileId), [profileId]);
  const templates  = useMemo(() => listTemplates(), []);
  const profileVars = useMemo(() => buildProfileVars(attrs), [attrs]);

  const [step, setStep]               = useState('pick'); // pick | generating | preview | sending | done | error
  const [cursor, setCursor]           = useState(0);
  const [templateName, setTemplateName] = useState(null);
  const [template, setTemplate]       = useState(null);
  const [aiProgress, setAiProgress]   = useState({}); // { name: { status, value?, error? } }
  const [rendered, setRendered]       = useState({ subject: '', body: '' });
  const [previewOffset, setPreviewOffset] = useState(0);
  const [errorMsg, setErrorMsg]       = useState('');

  const toEmail    = attrs.find(a => a.type === 'email') ? JSON.parse(attrs.find(a => a.type === 'email').data).address : null;
  const firstName  = attrs.find(a => a.type === 'first_name');
  const lastName   = attrs.find(a => a.type === 'last_name');
  const toName     = [firstName && JSON.parse(firstName.data), lastName && JSON.parse(lastName.data)].filter(Boolean).join(' ');

  // ── Start generation when we enter the 'generating' step ────────────────────
  useEffect(() => {
    if (step !== 'generating' || !template) return;

    const run = async () => {
      const aiVarNames = extractAiVars(template);
      let aiResolved   = {};

      if (aiVarNames.length > 0) {
        aiResolved = await generateAiVars(template, attrs, (progress) => {
          setAiProgress(prev => ({ ...prev, [progress.name]: progress }));
        });
      }

      const allVars = { ...profileVars };
      for (const [k, v] of Object.entries(aiResolved)) allVars[`ai:${k}`] = v;

      setRendered({
        subject: resolveAll(template.subject, allVars),
        body:    resolveAll(template.body,    allVars),
      });
      setPreviewOffset(0);
      setStep('preview');
    };

    run().catch(err => { setErrorMsg(err.message); setStep('error'); });
  }, [step, template]);

  // ── Send ─────────────────────────────────────────────────────────────────────
  async function doSend() {
    setStep('sending');
    try {
      const account = getEmailAccount(template.from);
      if (!account) throw new Error(`No email account found for key "${template.from}"`);
      if (!toEmail)  throw new Error('Profile has no email address');

      const isMarkdown = isMarkdownTemplate(templateName);
      const mailOptions = {
        from:    account.from,
        to:      toEmail,
        subject: rendered.subject,
        ...(isMarkdown
          ? { html: markdownToHtml(rendered.body), text: rendered.body }
          : { text: rendered.body }),
      };
      const transporter = nodemailer.createTransport(account.smtp);
      await transporter.sendMail(mailOptions);
      if (account.imap) await saveToSent(account.imap, mailOptions);

      logMessage(profileId, {
        text:         rendered.subject,
        channel:      'email',
        dateSent:     new Date().toISOString().slice(0, 10),
        status:       'sent',
        templateName,
      });
      setStep('done');
    } catch (err) {
      setErrorMsg(err.message);
      setStep('error');
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (step === 'pick') {
      if (key.escape || input === 'q')     { onBack(); return; }
      if (key.upArrow)                     { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)                   { setCursor(c => Math.min(templates.length - 1, c + 1)); return; }
      if (key.return && templates.length > 0) {
        const name = templates[cursor];
        const tmpl = parseTemplate(name);
        setTemplateName(name);
        setTemplate(tmpl);
        setAiProgress({});
        setStep('generating');
        return;
      }
      return;
    }

    if (step === 'generating') {
      if (key.escape || input === 'q') { onBack(); return; }
      return;
    }

    if (step === 'preview') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.return || input === 'y') { doSend(); return; }
      if (key.upArrow)   { setPreviewOffset(o => Math.max(0, o - 1)); return; }
      if (key.downArrow) { setPreviewOffset(o => o + 1); return; }
      return;
    }

    if (step === 'done' || step === 'error') {
      onBack();
      return;
    }
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  if (step === 'pick') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, 'Send email  '),
        h(Text, { dimColor: true }, `to: ${toName}${toEmail ? ` <${toEmail}>` : ' (no email)'}`),
      ),
      h(Box, { height: 1 }),
      templates.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'No templates — create one with t → n'))
        : h(Box, { flexDirection: 'column' },
            ...templates.map((name, i) => {
              const active = i === cursor;
              let meta = '';
              try { meta = `  (${parseTemplate(name).from})`; } catch {}
              return h(Box, { key: name, paddingX: 1 },
                h(Text, { inverse: active }, `${active ? '▸' : ' '} ${name}${meta}`),
              );
            }),
          ),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ pick template  ↵ select  esc back'),
      ),
    );
  }

  if (step === 'generating') {
    const names = extractAiVars(template);
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Generating...')),
      h(Box, { height: 1 }),
      names.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'Resolving variables...'))
        : h(Box, { flexDirection: 'column' },
            ...names.map(({ name, max }) => {
              const p      = aiProgress[name];
              const status = p?.status ?? 'pending';
              const icon   = status === 'done' ? '✓' : status === 'error' ? '✗' : '…';
              const color  = status === 'done' ? 'green' : status === 'error' ? 'red' : 'yellow';
              return h(Box, { key: name, paddingX: 2 },
                h(Text, { color }, `${icon} `),
                h(Text, {}, name),
                max ? h(Text, { dimColor: true }, `  max ${max}`) : null,
                status === 'error' ? h(Text, { color: 'red', dimColor: true }, `  ${p.error}`) : null,
              );
            }),
          ),
    );
  }

  if (step === 'preview') {
    const account    = getEmailAccount(template.from);
    const fromDisplay = account?.from ?? template.from;
    const bodyLines   = rendered.body.split('\n');
    const headerLines = 4; // title + from + to + subject + blank
    const viewHeight  = Math.max(1, rows - headerLines - 3); // footer
    const maxOffset   = Math.max(0, bodyLines.length - viewHeight);
    const visibleBody = bodyLines.slice(previewOffset, previewOffset + viewHeight).join('\n');

    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Preview')),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'from')),
        h(Text, { color: 'cyan' }, fromDisplay),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'to')),
        h(Text, {}, `${toName} <${toEmail}>`),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'subject')),
        h(Text, { bold: true }, rendered.subject),
      ),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 }, h(Text, {}, visibleBody)),
      maxOffset > 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, `↑↓ scroll (${previewOffset + 1}/${maxOffset + 1})`))
        : null,
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↵/y send  esc/q cancel'),
      ),
    );
  }

  if (step === 'sending') {
    return h(Box, { paddingX: 1 }, h(Text, { color: 'yellow' }, 'Sending...'));
  }

  if (step === 'done') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { color: 'green' }, `✓ Sent to ${toEmail}`)),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, 'any key to go back')),
    );
  }

  if (step === 'error') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { color: 'red' }, `✗ ${errorMsg}`)),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, 'any key to go back')),
    );
  }

  return null;
}
