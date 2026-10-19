/**
 * Shared user-account enforcement: translates a user document's
 * accountStatus/deletedAt into a block descriptor consumed by
 * protect/optionalProtect, the socket handshake, and login controllers.
 */

const BLOCKS = {
  banned: {
    code: 'ACCOUNT_BANNED',
    message: 'This account has been banned',
  },
  deleted: {
    code: 'ACCOUNT_DELETED',
    message: 'This account has been deleted',
  },
  suspended: {
    code: 'ACCOUNT_SUSPENDED',
    message: 'This account is suspended',
  },
};

/**
 * @param {Object} user - user document (plain object or lean result)
 * @param {Date} [now]
 * @returns {null|{code: string, message: string, until: Date|undefined, reason: string|undefined}}
 */
const getAccountBlock = (user, now = new Date()) => {
  if (!user) return null;

  if (user.deletedAt) {
    return { code: BLOCKS.deleted.code, message: BLOCKS.deleted.message, until: undefined, reason: user.accountStatus?.reason };
  }

  const status = user.accountStatus;
  if (!status || !status.state || status.state === 'active') return null;

  if (status.state === 'banned' || status.state === 'deleted') {
    const block = BLOCKS[status.state];
    return { code: block.code, message: block.message, until: status.until || undefined, reason: status.reason };
  }

  if (status.state === 'suspended') {
    // A suspension lapses automatically once `until` passes; an absent
    // `until` means indefinite.
    const until = status.until ? new Date(status.until) : null;
    if (!until || until > now) {
      return { code: BLOCKS.suspended.code, message: BLOCKS.suspended.message, until: status.until || undefined, reason: status.reason };
    }
  }

  return null;
};

/**
 * True when the token was issued before the user's latest force-logout.
 * Tokens without a `tv` claim count as 0 so pre-deploy tokens keep working
 * until the first tokenVersion bump.
 */
const isTokenStale = (decoded, user) =>
  ((decoded && decoded.tv) || 0) < ((user && user.tokenVersion) || 0);

module.exports = { getAccountBlock, isTokenStale };
