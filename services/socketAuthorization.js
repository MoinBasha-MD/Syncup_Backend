const isValidCallId = value =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 200;

const findAuthorizedCall = async (Call, userId, callId, options = {}) => {
  if (typeof userId !== 'string' || !userId.trim() || !isValidCallId(callId)) {
    return null;
  }

  const normalizedCallId = callId.trim();
  const query = options.receiverOnly
    ? { callId: normalizedCallId, receiverId: userId }
    : {
      callId: normalizedCallId,
      $or: [{ callerId: userId }, { receiverId: userId }],
    };

  if (options.statuses !== undefined) {
    if (!Array.isArray(options.statuses)) return null;
    query.status = { $in: options.statuses };
  }

  const call = await Call.findOne(query);
  if (!call) return null;

  const isCaller = call.callerId === userId;
  const isReceiver = call.receiverId === userId;
  if (options.receiverOnly ? !isReceiver : !isCaller && !isReceiver) {
    return null;
  }
  if (options.statuses && !options.statuses.includes(call.status)) {
    return null;
  }

  return call;
};

const getOtherCallParticipant = (call, userId) => {
  if (!call || typeof userId !== 'string') return null;
  if (call.callerId === userId && typeof call.receiverId === 'string' && call.receiverId !== userId) {
    return call.receiverId;
  }
  if (call.receiverId === userId && typeof call.callerId === 'string' && call.callerId !== userId) {
    return call.callerId;
  }
  return null;
};

const findAuthorizedReceipt = async (Message, userId, messageId) => {
  if (
    typeof userId !== 'string' ||
    !userId.trim() ||
    typeof messageId !== 'string' ||
    !/^[a-f\d]{24}$/i.test(messageId)
  ) {
    return null;
  }

  const message = await Message.findOne({ _id: messageId, receiverId: userId });
  return message?.receiverId === userId ? message : null;
};

module.exports = {
  findAuthorizedCall,
  getOtherCallParticipant,
  findAuthorizedReceipt,
};
