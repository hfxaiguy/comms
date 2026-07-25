import { test } from 'node:test';
import assert from 'node:assert/strict';
import db, {
  getProfiles, getAttributes, createProfile, addAttribute, deleteAttribute,
  getRelationships, addRelationship, deleteRelationship, migrateTextRelationships,
} from '../src/db.mjs';

function resetDb() {
  db.exec('DELETE FROM relationships');
  db.exec('DELETE FROM attributes');
  db.exec('DELETE FROM profiles');
}

function makeProfileWithNames(first, last) {
  return createProfile([
    { type: 'first_name', data: JSON.stringify(first) },
    { type: 'last_name',  data: JSON.stringify(last) },
  ]);
}

test('creating and querying a relationship', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');

  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].linked_profile_id, bob);
  assert.match(rels[0].linked_name, /Bob/);
  assert.equal(rels[0].type, 'related_to');
});

test('relationship appears on both sides', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');

  const aliceRels = getRelationships(alice);
  const bobRels   = getRelationships(bob);

  assert.equal(aliceRels.length, 1);
  assert.equal(bobRels.length, 1);
  assert.equal(aliceRels[0].linked_profile_id, bob);
  assert.equal(bobRels[0].linked_profile_id, alice);
});

test('self-relationship is rejected', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');

  assert.throws(
    () => addRelationship(alice, alice, 'related_to'),
    /Cannot create a relationship between a profile and itself/,
  );
});

test('duplicate relationships are ignored', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');
  addRelationship(alice, bob, 'related_to');

  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);
});

test('same profiles can have different relationship types', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');
  addRelationship(alice, bob, 'with');

  const rels = getRelationships(alice);
  assert.equal(rels.length, 2);
  const types = rels.map(r => r.type).sort();
  assert.deepEqual(types, ['related_to', 'with']);
});

test('deleting a relationship', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');
  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);

  deleteRelationship(rels[0].id);
  assert.equal(getRelationships(alice).length, 0);
  assert.equal(getRelationships(bob).length, 0);
});

test('cascade delete: removing a profile removes its relationships', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addRelationship(alice, bob, 'related_to');
  assert.equal(getRelationships(alice).length, 1);

  db.prepare('DELETE FROM profiles WHERE id = ?').run(alice);
  assert.equal(getRelationships(bob).length, 0);
});

test('multiple relationships across profiles', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');
  const carol = makeProfileWithNames('Carol', 'Lee');

  addRelationship(alice, bob, 'related_to');
  addRelationship(alice, carol, 'with');
  addRelationship(bob, carol, 'related_to');

  assert.equal(getRelationships(alice).length, 2);
  assert.equal(getRelationships(bob).length, 2);
  assert.equal(getRelationships(carol).length, 2);
});

test('migrateTextRelationships: matched names are migrated', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addAttribute(alice, 'related_to', JSON.stringify('Bob Jones'));

  const result = migrateTextRelationships();
  assert.equal(result.migrated, 1);
  assert.equal(result.unmatched, 0);

  const attrs = getAttributes(alice);
  const textRels = attrs.filter(a => a.type === 'related_to');
  assert.equal(textRels.length, 0);

  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].linked_profile_id, bob);
});

test('migrateTextRelationships: unmatched names remain as text', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');

  addAttribute(alice, 'related_to', JSON.stringify('Unknown Person'));

  const result = migrateTextRelationships();
  assert.equal(result.migrated, 0);
  assert.equal(result.unmatched, 1);

  const attrs = getAttributes(alice);
  const textRels = attrs.filter(a => a.type === 'related_to');
  assert.equal(textRels.length, 1);

  const rels = getRelationships(alice);
  assert.equal(rels.length, 0);
});

test('migrateTextRelationships: case-insensitive matching', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addAttribute(alice, 'related_to', JSON.stringify('bob jones'));

  const result = migrateTextRelationships();
  assert.equal(result.migrated, 1);

  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].linked_profile_id, bob);
});

test('migrateTextRelationships: with type is also migrated', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');
  const bob   = makeProfileWithNames('Bob', 'Jones');

  addAttribute(alice, 'with', JSON.stringify('Bob Jones'));

  const result = migrateTextRelationships();
  assert.equal(result.migrated, 1);

  const rels = getRelationships(alice);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].type, 'with');
  assert.equal(rels[0].linked_profile_id, bob);
});

test('migrateTextRelationships: does not self-link', () => {
  resetDb();
  const alice = makeProfileWithNames('Alice', 'Smith');

  addAttribute(alice, 'related_to', JSON.stringify('Alice Smith'));

  const result = migrateTextRelationships();
  assert.equal(result.migrated, 0);
  assert.equal(result.unmatched, 1);

  const attrs = getAttributes(alice);
  const textRels = attrs.filter(a => a.type === 'related_to');
  assert.equal(textRels.length, 1);
});
