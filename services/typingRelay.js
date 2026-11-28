/**
 * Typing presence for direct and group chats. Presence is never stored: the relay forwards
 * typing:start and typing:stop to the other people in the conversation. A receiver stops showing
 * someone who has not refreshed for a few seconds, so a lost stop only delays the change.
 *
 * Dependencies are injected (User, GroupChat, Block, broadcastToUser, now) so the rules can be
 * tested without a database.
 */
const RATE_LIMIT_MS = 1000; // at most one start per conversation per second from one socket
const MAX_ID_LENGTH = 64;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const createTypingRelay = ({ User, GroupChat, Block, broadcastToUser, now = () => Date.now() }) => {
  const lastStartBySocket = new WeakMap(); // socket -> Map(receiverId -> time of the last relayed start)
  const shownBySocket = new WeakMap(); // socket -> Map(receiverId -> { recipients, payload })

  // Who should hear about this conversation, or null when nothing may be relayed. Mirrors the
  // message path: a direct chat needs an existing, not mutually blocked person; a group needs the
  // sender to be a member, and reaches the other members.
  const recipientsFor = async (senderId, receiverId, isGroup) => {
    if (isGroup) {
      if (!OBJECT_ID.test(receiverId)) return null;
      const group = await GroupChat.findById(receiverId).select('members').lean();
      if (!group || !(group.members || []).includes(senderId)) return null;
      return group.members.filter((memberId) => memberId !== senderId);
    }
    if (receiverId === senderId) return null;
    const receiver = await User.findOne({ userId: receiverId }).select('userId').lean();
    if (!receiver) return null;
    if (await Block.isMutuallyBlocked(senderId, receiverId)) return null;
    return [receiverId];
  };

  const send = (recipients, event, payload) => {
    recipients.forEach((recipientId) => broadcastToUser(recipientId, event, payload));
  };

  // Called for every typing:start or typing:stop from a socket. Returns how many people were reached.
  const update = async (socket, { senderId, senderName }, data, isTyping) => {
    const receiverId = data && typeof data === 'object' ? data.receiverId : undefined;
    if (typeof receiverId !== 'string' || receiverId.length === 0 || receiverId.length > MAX_ID_LENGTH) return 0;
    const isGroup = data.isGroup === true;

    if (isTyping) {
      const starts = lastStartBySocket.get(socket) || new Map();
      lastStartBySocket.set(socket, starts);
      const last = starts.has(receiverId) ? starts.get(receiverId) : -Infinity;
      if (now() - last < RATE_LIMIT_MS) return 0;
      starts.set(receiverId, now());
    }

    const recipients = await recipientsFor(senderId, receiverId, isGroup);
    const shown = shownBySocket.get(socket) || new Map();
    shownBySocket.set(socket, shown);
    if (!recipients || recipients.length === 0) {
      shown.delete(receiverId);
      return 0;
    }

    const payload = {
      conversationId: isGroup ? receiverId : senderId,
      senderId,
      senderName: senderName || '',
      isGroup,
    };
    if (isTyping) {
      shown.set(receiverId, { recipients, payload });
      send(recipients, 'typing:start', payload);
    } else {
      shown.delete(receiverId);
      send(recipients, 'typing:stop', payload);
    }
    return recipients.length;
  };

  // A socket that goes away mid-typing must not leave the people it reached showing "typing…".
  const clearFor = (socket) => {
    const shown = shownBySocket.get(socket);
    if (!shown) return 0;
    let reached = 0;
    shown.forEach(({ recipients, payload }) => {
      send(recipients, 'typing:stop', payload);
      reached += recipients.length;
    });
    shown.clear();
    return reached;
  };

  return { update, clearFor };
};

module.exports = { createTypingRelay };
