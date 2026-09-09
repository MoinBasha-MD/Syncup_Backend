const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/userModel');
const StatusPrivacy = require('../models/statusPrivacyModel');

const originalTime = new Date('2020-01-01T10:00:00Z');
const trackChange = User.schema.s.hooks._pres.get('save').find(hook => hook.fn.name === 'trackStatusChange').fn;
const document = () => User.hydrate({
  userId: 'test-user', name: 'Test User', status: 'Office', mainStatus: 'Office',
  subStatus: 'Meeting', statusChangedAt: originalTime,
  mainEndTime: new Date('2026-09-09T17:00:00Z'),
});

test('status changes receive a persisted ordering timestamp', () => {
  const user = document();
  user.mainStatus = 'Home';
  trackChange.call(user);
  assert.ok(user.statusChangedAt > originalTime);
});

test('presence updates and duplicate canonical payloads do not change ordering', () => {
  const user = document();
  user.isOnline = true;
  user.mainStatus = 'Office';
  user.mainEndTime = '2026-09-09T17:00:00Z';
  trackChange.call(user);
  assert.equal(user.statusChangedAt.getTime(), originalTime.getTime());
});

test('clearing an activity updates ordering too', () => {
  const user = document();
  user.subStatus = null;
  trackChange.call(user);
  assert.ok(user.statusChangedAt > originalTime);
});

test('hidden status snapshots clear status, timeline, location and ordering metadata', async () => {
  const contact = {
    _id: 'owner', userId: 'test-user', name: 'Test User', mainStatus: 'Office',
    subStatus: 'Meeting', mainDuration: 60, statusChangedAt: originalTime,
    mainEndTime: new Date(), statusLocation: { placeName: 'Office' },
  };
  const result = await StatusPrivacy.projectStatusForViewer.call({ canUserSeeStatus: async () => false }, contact, 'viewer');
  assert.equal(result.name, contact.name);
  assert.equal(result.mainStatus, null);
  assert.equal(result.subStatus, null);
  assert.equal(result.mainDuration, 0);
  assert.equal(result.statusChangedAt, null);
  assert.equal(result.statusLocation, null);
  assert.equal(result.statusWithheld, true);
  assert.equal(contact.mainStatus, 'Office');
});

test('authorized snapshots preserve independent server timing and revisions', async () => {
  const user = document();
  const result = await StatusPrivacy.projectStatusForViewer.call({ canUserSeeStatus: async () => true }, user, 'viewer');
  assert.equal(result.mainStatus, 'Office');
  assert.equal(result.statusChangedAt.getTime(), originalTime.getTime());
  assert.equal(result.mainEndTime.toISOString(), '2026-09-09T17:00:00.000Z');
});

test('snapshots without a viewer are redacted', async () => {
  const result = await StatusPrivacy.projectStatusForViewer.call({ canUserSeeStatus: async () => { throw new Error('must not run'); } }, document(), null);
  assert.equal(result.statusWithheld, true);
});
