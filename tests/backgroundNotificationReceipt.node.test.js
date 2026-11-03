const { test } = require('node:test');
const assert = require('node:assert/strict');
const { confirmedSocketToken, excludeConfirmedToken, isInvalidRegistrationToken } = require('../services/backgroundNotificationReceipt');

test('accepts only a matching message receipt from a connected socket', async () => {
  const socket = {
    connected: true,
    emit: (event, payload, ack) => {
      assert.equal(event, 'notification:delivery-check');
      ack({ messageId: payload.messageId, token: 'device-token' });
    },
  };
  assert.equal(await confirmedSocketToken(socket, 'message-1', 20), 'device-token');
  socket.emit = (_event, _payload, ack) => ack({ messageId: 'other', token: 'device-token' });
  assert.equal(await confirmedSocketToken(socket, 'message-1', 20), null);
});

test('keeps push fallback when socket delivery is unavailable or unconfirmed', async () => {
  assert.equal(await confirmedSocketToken(null, 'message-1', 5), null);
  const socket = { connected: true, emit: () => {} };
  assert.equal(await confirmedSocketToken(socket, 'message-1', 5), null);
});

test('suppresses push only for the confirmed device', () => {
  assert.deepEqual(excludeConfirmedToken(['device-a', 'device-b'], 'device-a'), ['device-b']);
  assert.deepEqual(excludeConfirmedToken(['device-a', 'device-b'], null), ['device-a', 'device-b']);
  assert.deepEqual(excludeConfirmedToken(['device-a'], 'unknown'), ['device-a']);
});

test('transient push failures do not invalidate a device token', () => {
  assert.equal(isInvalidRegistrationToken('messaging/registration-token-not-registered'), true);
  assert.equal(isInvalidRegistrationToken('messaging/invalid-registration-token'), true);
  assert.equal(isInvalidRegistrationToken('messaging/server-unavailable'), false);
  assert.equal(isInvalidRegistrationToken(undefined), false);
});

test('the push service excludes only the confirmed device and retains transiently failed tokens', async t => {
  const User = require('../models/userModel');
  const service = require('../services/fcmNotificationService');
  const previousEnabled = service.fcmEnabled;
  service.fcmEnabled = true;
  t.after(() => { service.fcmEnabled = previousEnabled; });
  t.mock.method(User, 'findOne', () => ({
    select: async () => ({ fcmTokens: [
      { token: 'already-delivered', platform: 'android' },
      { token: 'invalid', platform: 'android' },
      { token: 'transient', platform: 'android' },
    ] }),
  }));
  const update = t.mock.method(User, 'updateOne', async () => ({}));
  let sentTokens;
  t.mock.method(service, '_sendWithRetry', async message => {
    sentTokens = message.tokens;
    return {
      successCount: 0,
      failureCount: 2,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/server-unavailable' } },
      ],
    };
  });

  await service.sendWakeupNotification('recipient', { senderId: 'sender', messageId: 'message-1' }, {
    excludeToken: 'already-delivered',
  });

  assert.deepEqual(sentTokens, ['invalid', 'transient']);
  assert.equal(update.mock.callCount(), 1);
  assert.deepEqual(update.mock.calls[0].arguments[1].$pull.fcmTokens.token.$in, ['invalid']);
});
