const asyncHandler = require('express-async-handler');
const connections = require('../services/syncSpaceConnections');

const requireActive = asyncHandler(async (req, res, next) => {
  req.syncProfile = await connections.requireActiveProfile(req.user.userId);
  next();
});

const preview = asyncHandler(async (req, res) => {
  const previewData = await connections.previewConnect(req.user.userId, req.body && req.body.token);
  res.json({ success: true, preview: previewData });
});

const approve = asyncHandler(async (req, res) => {
  const connection = await connections.approveConnect(
    req.user.userId,
    req.body && req.body.token,
    req.body && req.body.scopes
  );
  res.json({ success: true, connection });
});

const decline = asyncHandler(async (req, res) => {
  await connections.declineConnect(req.user.userId, req.body && req.body.token);
  res.json({ success: true });
});

const listConnections = asyncHandler(async (req, res) => {
  res.json({ success: true, connections: await connections.listConnections(req.user.userId) });
});

const revokeConnection = asyncHandler(async (req, res) => {
  const connection = await connections.revokeConnection(req.user.userId, req.params.connectionId);
  res.json({ success: true, connection });
});

const updateConnectionScopes = asyncHandler(async (req, res) => {
  const connection = await connections.updateConnectionScopes(
    req.user.userId,
    req.params.connectionId,
    req.body && req.body.scopes
  );
  res.json({ success: true, connection });
});

const listMessages = asyncHandler(async (req, res) => {
  const result = await connections.listMessages(req.user.userId, {
    type: req.query.type,
    cursor: req.query.cursor,
    limit: req.query.limit,
  });
  res.json({ success: true, ...result });
});

const markRead = asyncHandler(async (req, res) => {
  const message = await connections.markMessageRead(req.user.userId, req.params.messageId);
  res.json({ success: true, message });
});

const unreadCount = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await connections.unreadCount(req.user.userId)) });
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await connections.markAllRead(req.user.userId, { type: req.body && req.body.type });
  res.json({ success: true, ...result });
});

const listEverspace = asyncHandler(async (req, res) => {
  const result = await connections.listEverspace(req.user.userId);
  res.json({ success: true, ...result });
});

const listEverspaceReceipts = asyncHandler(async (req, res) => {
  const result = await connections.listEverspaceReceipts(
    req.user.userId,
    req.params.connectionId,
    { cursor: req.query.cursor, limit: req.query.limit }
  );
  res.json({ success: true, ...result });
});

const reveal = asyncHandler(async (req, res) => {
  const result = await connections.revealMessageCode(req.user.userId, req.params.messageId);
  res.json({ success: true, ...result });
});

const createPairingQr = asyncHandler(async (req, res) => {
  const result = await connections.createPairingQr(req.user.userId);
  res.json({ success: true, ...result });
});

const pairingQrStatus = asyncHandler(async (req, res) => {
  const result = await connections.getPairingQrStatus(req.user.userId, req.params.pairingId);
  res.json({ success: true, ...result });
});

const listPairingRequests = asyncHandler(async (req, res) => {
  res.json({ success: true, requests: await connections.listPairingRequests(req.user.userId) });
});

const declinePairingRequest = asyncHandler(async (req, res) => {
  await connections.declinePairingRequest(req.user.userId, req.params.pairingId);
  res.json({ success: true });
});

module.exports = {
  requireActive,
  preview,
  approve,
  decline,
  createPairingQr,
  pairingQrStatus,
  listPairingRequests,
  declinePairingRequest,
  listConnections,
  revokeConnection,
  updateConnectionScopes,
  listMessages,
  listEverspace,
  listEverspaceReceipts,
  markRead,
  unreadCount,
  markAllRead,
  reveal,
};
