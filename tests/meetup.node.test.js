const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Stub socketManager before anything lazy-requires it — no socket server/DB.
const socketManagerPath = require.resolve(path.join(__dirname, '..', 'socketManager'));
const broadcasts = [];
require.cache[socketManagerPath] = {
  id: socketManagerPath,
  filename: socketManagerPath,
  loaded: true,
  exports: {
    broadcastToUser: (userId, event, data) => {
      broadcasts.push({ userId, event, data });
    },
  },
};

const Meetup = require('../models/Meetup');
const { serializeMeetup, respondToMeetup } = require('../controllers/meetupController');
const { expireDueMeetups } = require('../services/meetupLifecycleService');

const fakeRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
};

test('serializeMeetup returns string id + inviteLink on a lean object', () => {
  const lean = {
    _id: '665f1a2b3c4d5e6f7a8b9c0d',
    hostId: 'host-1',
    hostName: 'Host',
    destination: { name: 'Cafe', latitude: 1, longitude: 2 },
    participants: [],
    status: 'active',
    inviteToken: 'tok123',
    expiresAt: new Date(),
    createdAt: new Date(),
  };
  const s = serializeMeetup(lean);
  assert.equal(s.id, '665f1a2b3c4d5e6f7a8b9c0d');
  assert.equal(typeof s.id, 'string');
  assert.equal(s.inviteLink, 'syncup://meetup/tok123');
  assert.equal(s.hostId, 'host-1');
});

test('respondToMeetup rejects host leave with 400', async () => {
  const meetup = {
    _id: 'm1',
    hostId: 'host-1',
    participants: [{ userId: 'host-1', status: 'accepted' }],
    findParticipant(userId) { return this.participants.find((p) => p.userId === userId); },
    isHost(userId) { return this.hostId === userId; },
  };
  const origFindOne = Meetup.findOne;
  Meetup.findOne = async () => meetup;
  try {
    const res = fakeRes();
    await respondToMeetup(
      { user: { userId: 'host-1' }, params: { id: 'm1' }, body: { action: 'leave' } },
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { success: false, message: 'The host must end the meetup instead' });
  } finally {
    Meetup.findOne = origFindOne;
  }
});

test('expireDueMeetups ends due meetups and broadcasts meetup:ended', async () => {
  broadcasts.length = 0;
  const due = [
    {
      _id: 'aaa',
      participants: [{ userId: 'u1' }, { userId: 'u2' }],
    },
    {
      _id: 'bbb', // updateOne modifies 0 — must be skipped
      participants: [{ userId: 'u3' }],
    },
  ];

  const origFind = Meetup.find;
  const origUpdateOne = Meetup.updateOne;
  Meetup.find = () => ({
    select: () => ({ lean: async () => due }),
  });
  Meetup.updateOne = async (filter) => ({
    modifiedCount: filter._id === 'aaa' ? 1 : 0,
  });
  try {
    const ended = await expireDueMeetups(new Date());
    assert.equal(ended, 1);
    const endedEvents = broadcasts.filter((b) => b.event === 'meetup:ended');
    assert.equal(endedEvents.length, 2);
    assert.deepEqual(
      endedEvents.map((e) => e.userId).sort(),
      ['u1', 'u2'],
    );
    assert.ok(endedEvents.every((e) => e.data.meetupId === 'aaa'));
  } finally {
    Meetup.find = origFind;
    Meetup.updateOne = origUpdateOne;
  }
});
