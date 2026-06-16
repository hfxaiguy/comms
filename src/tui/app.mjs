import React, { useState, useCallback } from 'react';
import { render, useApp } from 'ink';
import { spawnSync } from 'child_process';
import ProfileList    from './ProfileList.mjs';
import ProfileDetail  from './ProfileDetail.mjs';
import CreateProfile  from './CreateProfile.mjs';
import EditProfile    from './EditProfile.mjs';
import TemplateList   from './TemplateList.mjs';
import AgentList      from './AgentList.mjs';
import SendEmail      from './SendEmail.mjs';
import BlastEmail     from './BlastEmail.mjs';
import KimiChat       from './KimiChat.mjs';
import AutomationList from './AutomationList.mjs';

const h = React.createElement;

function App({ initialScreen, onRequestEdit }) {
  const { exit }   = useApp();
  const [screen,    setScreen]    = useState(initialScreen ?? 'profiles');
  const [profileId, setProfileId] = useState(null);
  const [sendId,    setSendId]    = useState(null);

  const onEdit = useCallback((filePath, returnScreen) => {
    onRequestEdit(filePath, returnScreen);
    exit();
  }, [onRequestEdit, exit]);

  switch (screen) {
    case 'create-profile':
      return h(CreateProfile, {
        onSave: (id) => { setProfileId(id); setScreen('profile-detail'); },
        onBack: ()   => setScreen('profiles'),
      });

    case 'edit-profile':
      return h(EditProfile, {
        profileId,
        onBack: () => setScreen('profile-detail'),
      });

    case 'profile-detail':
      return h(ProfileDetail, {
        profileId,
        onBack:      () => setScreen('profiles'),
        onEdit:      () => setScreen('edit-profile'),
        onSendEmail: (id) => { setSendId(id); setScreen('send-email'); },
        onDelete:    () => setScreen('profiles'),
      });

    case 'send-email':
      return h(SendEmail, {
        profileId: sendId,
        onBack:    () => setScreen('profile-detail'),
      });

    case 'blast-email':
      return h(BlastEmail, {
        onBack: () => setScreen('profiles'),
      });

    case 'templates':
      return h(TemplateList, {
        onBack: () => setScreen('profiles'),
        onEdit,
      });

    case 'agents':
      return h(AgentList, {
        onBack: () => setScreen('profiles'),
        onEdit,
      });

    case 'kimi':
      return h(KimiChat, {
        onBack: () => setScreen('profiles'),
      });

    case 'automations':
      return h(AutomationList, {
        onBack:  () => setScreen('profiles'),
        onKimi:  () => setScreen('kimi'),
      });

    default: // 'profiles'
      return h(ProfileList, {
        onSelect:      (id) => { setProfileId(id); setScreen('profile-detail'); },
        onNew:         ()   => setScreen('create-profile'),
        onBlast:       ()   => setScreen('blast-email'),
        onTemplates:   ()   => setScreen('templates'),
        onAgents:      ()   => setScreen('agents'),
        onKimi:        ()   => setScreen('kimi'),
        onAutomations: ()   => setScreen('automations'),
      });
  }
}

export async function launchTUI(opts = {}) {
  const state = { nextScreen: opts.initialScreen ?? 'profiles', edit: null };

  while (true) {
    state.edit = null;

    const { waitUntilExit } = render(h(App, {
      initialScreen:  state.nextScreen,
      onRequestEdit:  (filePath, returnScreen) => {
        state.edit = { filePath, returnScreen };
      },
    }));

    await waitUntilExit();

    if (state.edit) {
      const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
      spawnSync(editor, [state.edit.filePath], { stdio: 'inherit' });
      state.nextScreen = state.edit.returnScreen;
    } else {
      break;
    }
  }
}
