process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const loadWithMocks = (request, mocks) => {
  const modulePath = require.resolve(request);
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (id, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  locals: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const FORBIDDEN_FIELDS = ['message', 'fileMetadata', 'imageUrl', 'encrypted', 'encryptedContent',
  'encryptedChunks', 'encryptedContentKey', 'encryptedData', 'messagePreview', 'searchText', 'postMedia'];

test('messages/meta aggregation projects only metadata before grouping', async () => {
  let capturedPipeline;
  const mocks = {
    '../../models/userModel': {
      findOne: async () => ({ userId: 'u-1' }),
      findById: async () => null,
      find: () => ({ select: () => ({ lean: () => [{ userId: 'u-2', name: 'Bob' }] }) }),
    },
    '../../models/Message': {
      aggregate: async (pipeline) => {
        capturedPipeline = pipeline;
        return [{ _id: 'u-2', sent: 3, received: 5, firstAt: new Date(), lastAt: new Date() }];
      },
    },
    '../../models/groupMemberModel': { find: () => ({ select: () => ({ lean: () => [] }) }) },
    '../../models/groupChatModel': { find: () => ({ select: () => ({ lean: () => [] }) }) },
    '../../models/Friend': {}, '../../models/FeedPost': {}, '../../models/Ripple': {},
    '../../models/RippleReport': {}, '../../models/Comment': {}, '../../models/storyModel': {},
    '../../models/Notification': {}, '../../models/DeviceSession': { find: () => ({ select: () => ({ lean: () => [] }) }) },
    '../../models/AdminAuditLog': {},
    '../../services/userSessionControl': {},
    '../../services/notificationDispatcher': { CATEGORY_COLORS: {} },
  };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', mocks);
  const res = responseMock();
  await ctl.messageMeta({ params: { userId: 'u-1' }, query: {}, body: {}, admin: { _id: 'a1' }, adminDevice: {} }, res);
  assert.equal(res.statusCode, 200);

  // First $project must exist and only carry ids/timestamp/direction fields
  const firstProject = capturedPipeline.find(s => s.$project);
  assert.ok(firstProject, 'pipeline must contain a $project');
  const allowedKeys = Object.keys(firstProject.$project);
  for (const key of allowedKeys) {
    assert.ok(['_id', 'senderId', 'receiverId', 'timestamp'].includes(key), `unexpected projected field: ${key}`);
  }
  // No forbidden field anywhere in the pipeline
  const pipelineText = JSON.stringify(capturedPipeline);
  for (const field of FORBIDDEN_FIELDS) {
    assert.equal(pipelineText.includes(`"${field}"`), false, `pipeline references ${field}`);
  }

  // Output shape has no content fields
  const out = res.body.data;
  const first = out.counterparts[0];
  assert.deepEqual(Object.keys(first).sort(), ['counterpartName', 'counterpartUserId', 'firstAt', 'lastAt', 'received', 'sent']);
});
