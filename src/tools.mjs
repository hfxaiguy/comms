// src/tools.mjs
//
// Tool definitions for programmatic use (e.g. grandma-bob agent).
// Each tool has { name, description, parameters, execute } where
// execute(args) returns a JSON-serializable value.
//
// Usage:
//   import { tools } from 'communications/src/tools.mjs';
//   // tools = [{ name, description, parameters, execute }, ...]
//
// The agent merges these into its runtime tools:
//   const commsTools = Object.fromEntries(tools.map(t => [t.name, t]));

import {
  searchProfiles,
  findProfileByName,
  getProfiles,
  getAttributes,
  getRelationships,
  getGroups,
  getProfilesByGroup,
  createProfile,
  addAttribute,
  updateAttribute,
  deleteAttribute,
  deleteProfile,
  addRelationship,
  deleteRelationship,
  logMessage,
} from './db.mjs';
import { formatProfile, formatProfiles } from './format.mjs';

/**
 * Helper: get a fully formatted profile by name (JSON format).
 * Returns null if not found.
 */
function getFormattedProfile(name) {
  const profile = findProfileByName(name);
  if (!profile) return null;
  const attrs = getAttributes(profile.id);
  const rels  = getRelationships(profile.id);
  return formatProfile(profile, attrs, rels, 'json');
}

/**
 * Helper: list profiles with optional group filter (JSON format).
 */
function listFormattedProfiles(group) {
  const profiles = group ? getProfilesByGroup(group) : getProfiles();
  if (group) {
    // getProfilesByGroup returns { id, attrs } not { id, first_name, ... }
    // Fall back to getProfiles and filter
    const all = getProfiles();
    const filtered = all.filter(p => {
      const attrs = getAttributes(p.id);
      return attrs.some(a => a.type === 'group' && JSON.parse(a.data) === group);
    });
    return formatProfiles(filtered, 'json', getAttributes, getRelationships);
  }
  return formatProfiles(profiles, 'json', getAttributes, getRelationships);
}

export const tools = [
  {
    name: 'search_contacts',
    description: 'Search contacts by name, email, company, phone, website, or location. Returns matching profiles with basic info.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (matches name, email, company, phone, website, location)' },
      },
      required: ['query'],
    },
    execute({ query }) {
      return searchProfiles(query);
    },
  },

  {
    name: 'get_contact',
    description: 'Get a full contact profile by name. Returns all attributes, relationships, and message history.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact name (first name, or first + last)' },
      },
      required: ['name'],
    },
    execute({ name }) {
      const result = getFormattedProfile(name);
      if (!result) return { error: `No contact found matching "${name}"` };
      return result;
    },
  },

  {
    name: 'list_contacts',
    description: 'List all contacts, optionally filtered by group. Returns structured profile data.',
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Filter by group name (optional, omit for all contacts)' },
      },
    },
    execute({ group }) {
      return listFormattedProfiles(group);
    },
  },

  {
    name: 'list_groups',
    description: 'List all contact group names.',
    parameters: { type: 'object', properties: {} },
    execute() {
      return getGroups();
    },
  },

  {
    name: 'add_contact',
    description: 'Create a new contact with attributes. Returns the new profile ID.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name' },
        last_name:  { type: 'string', description: 'Last name (optional)' },
        group:      { type: 'string', description: 'Group name (optional)' },
        emails:     { type: 'array', items: { type: 'object', properties: { address: { type: 'string' }, label: { type: 'string' } } }, description: 'Email addresses' },
        phones:     { type: 'array', items: { type: 'object', properties: { number: { type: 'string' }, label: { type: 'string' } } }, description: 'Phone numbers' },
        companies:  { type: 'array', items: { type: 'string' }, description: 'Company names' },
        professions: { type: 'array', items: { type: 'string' }, description: 'Profession/titles' },
        notes:      { type: 'array', items: { type: 'string' }, description: 'Notes' },
      },
      required: ['first_name'],
    },
    execute({ first_name, last_name, group, emails, phones, companies, professions, notes }) {
      const attrs = [];
      if (first_name)  attrs.push({ type: 'first_name', data: JSON.stringify(first_name) });
      if (last_name)   attrs.push({ type: 'last_name',  data: JSON.stringify(last_name) });
      if (group)       attrs.push({ type: 'group',      data: JSON.stringify(group) });
      for (const e of emails ?? [])      attrs.push({ type: 'email',      data: JSON.stringify(e) });
      for (const p of phones ?? [])      attrs.push({ type: 'phone',      data: JSON.stringify(p) });
      for (const c of companies ?? [])   attrs.push({ type: 'company',    data: JSON.stringify(c) });
      for (const p of professions ?? []) attrs.push({ type: 'profession', data: JSON.stringify(p) });
      for (const n of notes ?? [])       attrs.push({ type: 'note',       data: JSON.stringify(n) });

      const id = createProfile(attrs);
      return { profileId: Number(id) };
    },
  },

  {
    name: 'update_contact',
    description: 'Add or update an attribute on an existing contact. Use addAttribute to append, or updateAttribute to replace by attribute ID.',
    parameters: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Contact name (first name, or first + last)' },
        type:  { type: 'string', description: 'Attribute type: email, phone, company, profession, interest, note, website, social, location, etc.' },
        data:  { type: 'string', description: 'JSON-stringified value. Examples: "value" for text, {"address":"x","label":""} for email, {"number":"x","label":""} for phone' },
      },
      required: ['name', 'type', 'data'],
    },
    execute({ name, type, data }) {
      const profile = findProfileByName(name);
      if (!profile) return { error: `No contact found matching "${name}"` };
      addAttribute(profile.id, type, data);
      return { ok: true, profileId: profile.id };
    },
  },

  {
    name: 'delete_contact',
    description: 'Delete a contact and all their attributes/relationships permanently.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact name (first name, or first + last)' },
      },
      required: ['name'],
    },
    execute({ name }) {
      const profile = findProfileByName(name);
      if (!profile) return { error: `No contact found matching "${name}"` };
      deleteProfile(profile.id);
      return { ok: true };
    },
  },

  {
    name: 'add_relationship',
    description: 'Link two contacts together.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First contact name' },
        to:   { type: 'string', description: 'Second contact name' },
        type: { type: 'string', description: 'Relationship type: "related_to" (default) or "with"' },
      },
      required: ['from', 'to'],
    },
    execute({ from, to, type }) {
      const p1 = findProfileByName(from);
      if (!p1) return { error: `No contact found matching "${from}"` };
      const p2 = findProfileByName(to);
      if (!p2) return { error: `No contact found matching "${to}"` };
      addRelationship(p1.id, p2.id, type || 'related_to');
      return { ok: true };
    },
  },

  {
    name: 'log_message',
    description: 'Log a sent message (WhatsApp, email, SMS, etc.) against a contact.',
    parameters: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Contact name (first name, or first + last)' },
        text:    { type: 'string', description: 'Message text or subject' },
        channel: { type: 'string', description: 'Channel: WhatsApp, Email, SMS, etc.' },
        status:  { type: 'string', description: 'Status: sent (default), received, draft' },
      },
      required: ['name', 'text', 'channel'],
    },
    execute({ name, text, channel, status }) {
      const profile = findProfileByName(name);
      if (!profile) return { error: `No contact found matching "${name}"` };
      logMessage(profile.id, {
        text,
        channel,
        status:     status ?? 'sent',
        dateSent:   new Date().toISOString().slice(0, 10),
      });
      return { ok: true };
    },
  },
];
