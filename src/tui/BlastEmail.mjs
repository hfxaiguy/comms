import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import nodemailer from 'nodemailer';
import { getGroups, getProfilesByGroup, logMessage } from '../db.mjs';
import {
  listTemplates, parseTemplate, extractAiVars,
  buildProfileVars, generateAiVars, resolveAll, getEmailAccount,
  isMarkdownTemplate, markdownToHtml,
} from '../templates.mjs';
import { saveToSent } from '../imap.mjs';

const h = React.createElement;

function profileName(attrs) {
  const fn = attrs.find(a => a.type === 'first_name');
  const ln = attrs.find(a => a.type === 'last_name');
  return [fn && JSON.parse(fn.data), ln && JSON.parse(ln.data)].filter(Boolean).join(' ') || '(unnamed)';
}

function profileEmail(attrs) {
  const a = attrs.find(a => a.type === 'email');
  return a ? JSON.parse(a.data).address : null;
}

function alreadyReceived(attrs, templateName) {
  return attrs.some(a => {
    if (a.type !== 'message') return false;
    try { return JSON.parse(a.data).templateName === templateName; } catch { return false; }
  });
}

export default function BlastEmail({ onBack }) {
  const { rows, columns } = useWindowSize();

  const [step, setStep]     = useState('pick-group');
  const [cursor, setCursor] = useState(0);
  const [error, setError]   = useState('');

  // selections
  const [group,        setGroup]        = useState('');
  const [templateName, setTemplateName] = useState('');
  const [template,     setTemplate]     = useState(null);

  // computed before generating
  const [eligible, setEligible]   = useState([]);
  const [skipped,  setSkipped]    = useState({ noEmail: 0, alreadySent: 0 });

  // generating progress
  const [genIdx,      setGenIdx]      = useState(0);
  const [genName,     setGenName]     = useState('');
  const [genAiVars,   setGenAiVars]   = useState({});

  // previews: [{ profileId, name, toEmail, subject, body, account, excluded }]
  const [previews,    setPreviews]    = useState([]);
  const [previewIdx,  setPreviewIdx]  = useState(0);
  const [bodyOffset,  setBodyOffset]  = useState(0);

  // sending: [{ profileId, name, email, status, error? }]
  const [sendResults, setSendResults] = useState([]);
  const [sendOffset,  setSendOffset]  = useState(0);

  const groups    = useMemo(() => getGroups(),    []);
  const templates = useMemo(() => listTemplates(), []);

  // ── generating ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'generating') return;

    const run = async () => {
      const results = [];

      for (let i = 0; i < eligible.length; i++) {
        const { id, attrs } = eligible[i];
        const name = profileName(attrs);
        setGenIdx(i);
        setGenName(name);
        setGenAiVars({});

        const aiResolved = await generateAiVars(template, attrs, (p) =>
          setGenAiVars(prev => ({ ...prev, [p.name]: p }))
        );

        const profileVars = buildProfileVars(attrs);
        const allVars     = { ...profileVars };
        for (const [k, v] of Object.entries(aiResolved)) allVars[`ai:${k}`] = v;

        results.push({
          profileId: id,
          name,
          toEmail:  profileEmail(attrs),
          subject:  resolveAll(template.subject, allVars),
          body:     resolveAll(template.body,    allVars),
          account:  getEmailAccount(template.from),
          excluded: false,
        });
      }

      setPreviews(results);
      setPreviewIdx(0);
      setBodyOffset(0);
      setStep('preview');
    };

    run().catch(err => { setError(err.message); setStep('error'); });
  }, [step]);

  // ── sending ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'sending') return;

    const toSend = previews.filter(p => !p.excluded);

    const run = async () => {
      for (let i = 0; i < toSend.length; i++) {
        const p       = toSend[i];
        const listH   = Math.max(1, rows - 4);
        setSendOffset(o => (i >= o + listH) ? i - listH + 1 : o);
        setSendResults(prev => prev.map(r =>
          r.profileId === p.profileId ? { ...r, status: 'sending' } : r
        ));
        try {
          const isMarkdown  = isMarkdownTemplate(templateName);
          const mailOptions = {
            from:    p.account.from,
            to:      p.toEmail,
            subject: p.subject,
            ...(isMarkdown
              ? { html: markdownToHtml(p.body), text: p.body }
              : { text: p.body }),
          };
          await nodemailer.createTransport(p.account.smtp).sendMail(mailOptions);
          if (p.account.imap) await saveToSent(p.account.imap, mailOptions);
          logMessage(p.profileId, {
            text: p.subject, channel: 'email',
            dateSent: new Date().toISOString().slice(0, 10),
            status: 'sent', templateName,
          });
          setSendResults(prev => prev.map(r =>
            r.profileId === p.profileId ? { ...r, status: 'done' } : r
          ));
        } catch (err) {
          setSendResults(prev => prev.map(r =>
            r.profileId === p.profileId ? { ...r, status: 'failed', error: err.message } : r
          ));
        }
      }
      setStep('done');
    };

    setSendResults(toSend.map(p => ({ profileId: p.profileId, name: p.name, email: p.toEmail, status: 'pending' })));
    run().catch(err => { setError(err.message); setStep('error'); });
  }, [step]);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (step === 'pick-group') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow)   { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(groups.length - 1, c + 1)); return; }
      if (key.return && groups.length > 0) {
        const g   = groups[cursor];
        const all = getProfilesByGroup(g);
        const elig = all.filter(p => profileEmail(p.attrs) && !alreadyReceived(p.attrs, templateName));
        // templateName not chosen yet — eligibility fully computed at summary step
        setGroup(g);
        setCursor(0);
        setStep('pick-template');
      }
      return;
    }

    if (step === 'pick-template') {
      if (key.escape) { setCursor(0); setStep('pick-group'); return; }
      if (key.upArrow)   { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(templates.length - 1, c + 1)); return; }
      if (key.return && templates.length > 0) {
        const name = templates[cursor];
        const tmpl = parseTemplate(name);
        const all  = getProfilesByGroup(group);
        const noEmail    = all.filter(p => !profileEmail(p.attrs)).length;
        const alreadySent = all.filter(p => profileEmail(p.attrs) && alreadyReceived(p.attrs, name)).length;
        const elig       = all.filter(p => profileEmail(p.attrs) && !alreadyReceived(p.attrs, name));
        setTemplateName(name);
        setTemplate(tmpl);
        setEligible(elig);
        setSkipped({ noEmail, alreadySent });
        setCursor(0);
        setStep('summary');
      }
      return;
    }

    if (step === 'summary') {
      if (key.escape) { setCursor(0); setStep('pick-template'); return; }
      if (key.return) {
        if (eligible.length === 0) return;
        setGenIdx(0); setGenName(''); setGenAiVars({});
        setStep('generating');
      }
      return;
    }

    if (step === 'generating') {
      return; // no-op — can't cancel mid-generation cleanly
    }

    if (step === 'sending') {
      const maxOffset = Math.max(0, sendResults.length - Math.max(1, rows - 4));
      if (key.upArrow)   { setSendOffset(o => Math.max(0, o - 1)); return; }
      if (key.downArrow) { setSendOffset(o => Math.min(maxOffset, o + 1)); return; }
      return;
    }

    if (step === 'preview') {
      if (key.escape || input === 'q') { onBack(); return; }
      const p = previews[previewIdx];
      if ((key.leftArrow  || input === 'p') && previewIdx > 0)            { setPreviewIdx(i => i - 1); setBodyOffset(0); return; }
      if ((key.rightArrow || input === 'n') && previewIdx < previews.length - 1) { setPreviewIdx(i => i + 1); setBodyOffset(0); return; }
      if (key.upArrow)   { setBodyOffset(o => Math.max(0, o - 1)); return; }
      if (key.downArrow) { setBodyOffset(o => o + 1); return; }
      if (input === 'x' && p) {
        setPreviews(prev => prev.map((v, i) => i === previewIdx ? { ...v, excluded: !v.excluded } : v));
        return;
      }
      if (key.return) {
        const toSend = previews.filter(p => !p.excluded);
        if (toSend.length > 0) setStep('confirm');
        return;
      }
      return;
    }

    if (step === 'confirm') {
      if (key.escape) { setStep('preview'); return; }
      if (input === 'y' || key.return) { setStep('sending'); return; }
      return;
    }

    if (step === 'done' || step === 'error') {
      onBack();
      return;
    }
  });

  // ── render ──────────────────────────────────────────────────────────────────

  if (step === 'pick-group') {
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Email blast — pick group')),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1 },
        groups.length === 0
          ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'No groups found'))
          : groups.map((g, i) => h(Box, { key: g, paddingX: 1 },
              h(Text, { inverse: i === cursor }, `${i === cursor ? '▸' : ' '} ${g}`),
            )),
      ),
      h(Box, { paddingX: 1 },
        h(Text, { dimColor: true }, '↑↓ pick  ↵ select  esc back'),
      ),
    );
  }

  if (step === 'pick-template') {
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, 'Email blast — pick template  '),
        h(Text, { dimColor: true }, group),
      ),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1 },
        templates.length === 0
          ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'No templates — create one with t → n'))
          : templates.map((name, i) => {
              let from = '';
              try { from = `  (${parseTemplate(name).from})`; } catch {}
              return h(Box, { key: name, paddingX: 1 },
                h(Text, { inverse: i === cursor }, `${i === cursor ? '▸' : ' '} ${name}${from}`),
              );
            }),
      ),
      h(Box, { paddingX: 1 },
        h(Text, { dimColor: true }, '↑↓ pick  ↵ select  esc back'),
      ),
    );
  }

  if (step === 'summary') {
    const aiVars     = template ? extractAiVars(template) : [];
    const totalCalls = eligible.length * aiVars.length;
    const account    = template ? getEmailAccount(template.from) : null;
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Email blast — summary')),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 2 },
        h(Box, {},
          h(Box, { width: 18 }, h(Text, { dimColor: true }, 'group')),
          h(Text, {}, group),
        ),
        h(Box, {},
          h(Box, { width: 18 }, h(Text, { dimColor: true }, 'template')),
          h(Text, {}, templateName),
        ),
        h(Box, {},
          h(Box, { width: 18 }, h(Text, { dimColor: true }, 'from')),
          h(Text, { color: 'cyan' }, account?.from ?? template?.from ?? ''),
        ),
        h(Box, { height: 1 }),
        h(Box, {},
          h(Box, { width: 18 }, h(Text, { dimColor: true }, 'will send to')),
          h(Text, { color: eligible.length > 0 ? 'green' : 'red' }, `${eligible.length} profiles`),
        ),
        skipped.alreadySent > 0
          ? h(Box, {},
              h(Box, { width: 18 }, h(Text, { dimColor: true }, 'already received')),
              h(Text, { dimColor: true }, `${skipped.alreadySent} skipped`),
            )
          : null,
        skipped.noEmail > 0
          ? h(Box, {},
              h(Box, { width: 18 }, h(Text, { dimColor: true }, 'no email')),
              h(Text, { dimColor: true }, `${skipped.noEmail} skipped`),
            )
          : null,
        aiVars.length > 0
          ? h(Box, { marginTop: 1 },
              h(Box, { width: 18 }, h(Text, { dimColor: true }, 'AI calls')),
              h(Text, {}, `${totalCalls}  (${eligible.length} profiles × ${aiVars.length} vars)`),
            )
          : null,
        eligible.length === 0
          ? h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, 'Nothing to send.'))
          : null,
      ),
      h(Box, { paddingX: 1 },
        eligible.length > 0
          ? h(Text, { dimColor: true }, '↵ generate previews  esc back')
          : h(Text, { dimColor: true }, 'esc back'),
      ),
    );
  }

  if (step === 'generating') {
    const aiVarList = template ? extractAiVars(template) : [];
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Generating previews...')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Text, { dimColor: true }, `${genIdx + 1} / ${eligible.length}  `),
        h(Text, { bold: true }, genName),
      ),
      h(Box, { flexDirection: 'column', paddingX: 4 },
        ...aiVarList.map(({ name }) => {
          const p      = genAiVars[name];
          const status = p?.status ?? 'pending';
          const icon   = status === 'done' ? '✓' : status === 'error' ? '✗' : '…';
          const color  = status === 'done' ? 'green' : status === 'error' ? 'red' : 'yellow';
          return h(Box, { key: name },
            h(Text, { color }, `${icon} `),
            h(Text, {}, name),
          );
        }),
      ),
    );
  }

  if (step === 'preview') {
    const p          = previews[previewIdx];
    const excluded   = previews.filter(v => v.excluded).length;
    const bodyLines  = (p?.body ?? '').split('\n');
    const headerRows = 6;
    const viewHeight = Math.max(1, rows - headerRows - 2);
    const visible    = bodyLines.slice(bodyOffset, bodyOffset + viewHeight).join('\n');

    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, `Preview ${previewIdx + 1}/${previews.length}  `),
        p?.excluded
          ? h(Text, { color: 'red' }, '[excluded]')
          : h(Text, { color: 'green' }, '✓'),
        excluded > 0 ? h(Text, { dimColor: true }, `  (${excluded} excluded)`) : null,
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'from')),
        h(Text, { color: 'cyan' }, p?.account?.from ?? ''),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'to')),
        h(Text, {}, `${p?.name} <${p?.toEmail}>`),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'subject')),
        h(Text, { bold: true }, p?.subject ?? ''),
      ),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2, flexGrow: 1 }, h(Text, {}, visible)),
      h(Box, { paddingX: 1 },
        h(Text, { color: 'cyan' }, '←/p'),
        h(Text, { dimColor: true }, ' prev  '),
        h(Text, { color: 'cyan' }, '→/n'),
        h(Text, { dimColor: true }, ' next  '),
        h(Text, { color: 'cyan' }, 'x'),
        h(Text, { dimColor: true }, ' exclude  ↑↓ scroll  ↵ confirm all  esc cancel'),
      ),
    );
  }

  if (step === 'confirm') {
    const toSend   = previews.filter(p => !p.excluded);
    const excluded = previews.filter(p => p.excluded).length;
    const account  = toSend[0]?.account;
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Confirm blast')),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 2 },
        h(Box, {},
          h(Box, { width: 14 }, h(Text, { dimColor: true }, 'template')),
          h(Text, {}, templateName),
        ),
        h(Box, {},
          h(Box, { width: 14 }, h(Text, { dimColor: true }, 'from')),
          h(Text, { color: 'cyan' }, account?.from ?? ''),
        ),
        h(Box, { height: 1 }),
        h(Box, {},
          h(Box, { width: 14 }, h(Text, { dimColor: true }, 'sending to')),
          h(Text, { color: 'green', bold: true }, `${toSend.length} profiles`),
        ),
        excluded > 0
          ? h(Box, {},
              h(Box, { width: 14 }, h(Text, { dimColor: true }, 'excluded')),
              h(Text, { dimColor: true }, `${excluded}`),
            )
          : null,
      ),
      h(Box, { paddingX: 1 },
        h(Text, { color: 'cyan' }, 'y/↵'),
        h(Text, { dimColor: true }, ' send  esc back to previews'),
      ),
    );
  }

  if (step === 'sending') {
    const listH   = Math.max(1, rows - 4);
    const visible = sendResults.slice(sendOffset, sendOffset + listH);
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Sending...')),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 2 },
        ...visible.map(r => {
          const icon  = r.status === 'done' ? '✓' : r.status === 'failed' ? '✗' : r.status === 'sending' ? '→' : '·';
          const color = r.status === 'done' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'sending' ? 'yellow' : undefined;
          return h(Box, { key: r.profileId },
            h(Text, { color }, `${icon} `),
            h(Text, {}, `${r.name} <${r.email}>`),
            r.status === 'failed' ? h(Text, { color: 'red', dimColor: true }, `  ${r.error}`) : null,
          );
        }),
      ),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, '↑↓ scroll')),
    );
  }

  if (step === 'done') {
    const done   = sendResults.filter(r => r.status === 'done').length;
    const failed = sendResults.filter(r => r.status === 'failed');
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Done')),
      h(Box, { height: 1 }),
      h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 2 },
        h(Box, {},
          h(Text, { color: 'green' }, `✓ ${done} sent`),
        ),
        failed.length > 0
          ? h(Box, {},
              h(Text, { color: 'red' }, `✗ ${failed.length} failed`),
            )
          : null,
        ...failed.map(r => h(Box, { key: r.profileId, paddingX: 2 },
          h(Text, { dimColor: true }, `${r.name}: `),
          h(Text, { color: 'red' }, r.error ?? 'unknown error'),
        )),
      ),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, 'any key to go back')),
    );
  }

  if (step === 'error') {
    return h(Box, { flexDirection: 'column', height: rows },
      h(Box, { paddingX: 1 }, h(Text, { color: 'red', bold: true }, 'Error')),
      h(Box, { paddingX: 2 }, h(Text, { color: 'red' }, error)),
      h(Box, { paddingX: 1, marginTop: 1 }, h(Text, { dimColor: true }, 'any key to go back')),
    );
  }

  return null;
}
