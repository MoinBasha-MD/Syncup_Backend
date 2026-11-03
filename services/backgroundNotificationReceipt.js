function confirmedSocketToken(socket, messageId, timeoutMs = 1200) {
  if (!socket?.connected || !messageId) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = token => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      socket.emit('notification:delivery-check', { messageId: String(messageId) }, response => {
        const token = response?.messageId === String(messageId) && typeof response?.token === 'string'
          && response.token.length > 0 && response.token.length <= 4096
          ? response.token : null;
        finish(token);
      });
    } catch {
      finish(null);
    }
  });
}

const excludeConfirmedToken = (tokens, token) =>
  token ? tokens.filter(candidate => candidate !== token) : tokens;

const isInvalidRegistrationToken = code =>
  code === 'messaging/registration-token-not-registered' ||
  code === 'messaging/invalid-registration-token';

module.exports = { confirmedSocketToken, excludeConfirmedToken, isInvalidRegistrationToken };
