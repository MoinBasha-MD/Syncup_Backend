const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../models/Notification');

test('Notification schema accepts Open Network message, reply, and support records', () => {
  // `type` is a match-validated string now (v2 envelope types persist without
  // schema edits) — exercise the validator directly.
  const validator = Notification.schema.path('type').validators
    .map((v) => v.regexp || v.validator)
    .find((v) => v instanceof RegExp);
  assert.ok(validator instanceof RegExp, 'type should carry a regex match validator');
  for (const type of ['on_message', 'ripple_reply', 'ripple_support']) {
    assert.ok(validator.test(type), `${type} should be a valid notification type`);
  }
  // Anything not snake_case still fails validation.
  for (const type of ['BadType', '1bad', 'x'.repeat(80)]) {
    assert.ok(!validator.test(type), `${type} should be rejected`);
  }
});
