const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../models/Notification');

test('Notification schema accepts Open Network message, reply, and support records', () => {
  const types = Notification.schema.path('type').enumValues;
  for (const type of ['on_message', 'ripple_reply', 'ripple_support']) {
    assert.ok(types.includes(type), `${type} should be a valid notification type`);
  }
});
