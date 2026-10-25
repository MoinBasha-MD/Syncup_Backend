const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const StatusTemplate = require('../models/statusTemplateModel');
const User = require('../models/userModel');
const { createStatusTemplate, deleteStatusTemplate } = require('../controllers/statusTemplateController');

test('creates a custom status template without a duration', async () => {
  const originalCreate = StatusTemplate.create;
  const originalFindById = User.findById;
  const userId = new mongoose.Types.ObjectId();

  User.findById = async () => ({ userId: 'test-user' });
  StatusTemplate.create = async data => {
    const template = new StatusTemplate(data);
    assert.equal(template.validateSync(), undefined);
    return template;
  };

  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await createStatusTemplate({
      user: { _id: userId },
      body: { name: 'At the gym', status: 'custom', customStatus: 'At the gym' },
    }, response, error => {
      throw error;
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.duration, 0);
    assert.equal(response.body.mainDuration, 0);
    assert.equal(response.body.customStatus, 'At the gym');
  } finally {
    StatusTemplate.create = originalCreate;
    User.findById = originalFindById;
  }
});

test('deletes a status template with the Mongoose 8 document API', async () => {
  const originalFindById = StatusTemplate.findById;
  const userId = new mongoose.Types.ObjectId();
  let deleted = false;

  StatusTemplate.findById = async () => ({
    user: userId,
    deleteOne: async () => {
      deleted = true;
    },
  });

  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await deleteStatusTemplate({
      user: { _id: userId },
      params: { id: 'template-id' },
    }, response, error => {
      throw error;
    });

    assert.equal(deleted, true);
    assert.equal(response.statusCode, null);
    assert.deepEqual(response.body, { message: 'Status template removed' });
  } finally {
    StatusTemplate.findById = originalFindById;
  }
});
