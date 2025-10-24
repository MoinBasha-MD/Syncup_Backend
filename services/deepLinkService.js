/**
 * Deep Link Service
 * Generates shareable URLs for posts, profiles, and other content
 * Similar to Instagram, Twitter deep linking
 */

const BASE_URL = process.env.WEB_URL || 'https://syncup.app';
const APP_SCHEME = 'syncup://';

class DeepLinkService {
  /**
   * Generate post share URL
   * @param {string} postId - Post ID
   * @returns {object} URLs for different platforms
   */
  generatePostLink(postId) {
    return {
      web: `${BASE_URL}/post/${postId}`,
      app: `${APP_SCHEME}post/${postId}`,
      share: `${BASE_URL}/p/${postId}`, // Short URL
      qr: `${BASE_URL}/qr/post/${postId}`, // QR code URL
    };
  }

  /**
   * Generate profile share URL
   * @param {string} userId - User ID
   * @returns {object} URLs for different platforms
   */
  generateProfileLink(userId) {
    return {
      web: `${BASE_URL}/profile/${userId}`,
      app: `${APP_SCHEME}profile/${userId}`,
      share: `${BASE_URL}/u/${userId}`,
      qr: `${BASE_URL}/qr/profile/${userId}`,
    };
  }

  /**
   * Generate story share URL
   * @param {string} storyId - Story ID
   * @returns {object} URLs for different platforms
   */
  generateStoryLink(storyId) {
    return {
      web: `${BASE_URL}/story/${storyId}`,
      app: `${APP_SCHEME}story/${storyId}`,
      share: `${BASE_URL}/s/${storyId}`,
    };
  }

  /**
   * Generate chat/message share URL
   * @param {string} messageId - Message ID
   * @returns {object} URLs for different platforms
   */
  generateMessageLink(messageId) {
    return {
      web: `${BASE_URL}/message/${messageId}`,
      app: `${APP_SCHEME}message/${messageId}`,
    };
  }

  /**
   * Parse deep link and extract type and ID
   * @param {string} url - Deep link URL
   * @returns {object} Parsed link data
   */
  parseDeepLink(url) {
    try {
      // Handle app scheme
      if (url.startsWith(APP_SCHEME)) {
        const path = url.replace(APP_SCHEME, '');
        const [type, id] = path.split('/');
        return { type, id, source: 'app' };
      }

      // Handle web URL
      if (url.startsWith(BASE_URL)) {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        
        // Handle short URLs
        if (pathParts[0] === 'p') return { type: 'post', id: pathParts[1], source: 'web' };
        if (pathParts[0] === 'u') return { type: 'profile', id: pathParts[1], source: 'web' };
        if (pathParts[0] === 's') return { type: 'story', id: pathParts[1], source: 'web' };
        
        // Handle full URLs
        return { type: pathParts[0], id: pathParts[1], source: 'web' };
      }

      return null;
    } catch (error) {
      console.error('Error parsing deep link:', error);
      return null;
    }
  }

  /**
   * Generate shareable content with metadata
   * @param {string} type - Content type (post, profile, etc.)
   * @param {object} data - Content data
   * @returns {object} Shareable content with URLs and metadata
   */
  generateShareableContent(type, data) {
    let links;
    let metadata = {};

    switch (type) {
      case 'post':
        links = this.generatePostLink(data.postId);
        metadata = {
          title: `${data.userName}'s Post`,
          description: data.caption || 'Check out this post on Syncup',
          image: data.mediaUrl,
          type: 'article',
        };
        break;

      case 'profile':
        links = this.generateProfileLink(data.userId);
        metadata = {
          title: `${data.name} on Syncup`,
          description: data.bio || `Follow ${data.name} on Syncup`,
          image: data.profileImage,
          type: 'profile',
        };
        break;

      case 'story':
        links = this.generateStoryLink(data.storyId);
        metadata = {
          title: `${data.userName}'s Story`,
          description: 'View this story on Syncup',
          image: data.thumbnail,
          type: 'story',
        };
        break;

      default:
        return null;
    }

    return {
      links,
      metadata,
      shareText: this.generateShareText(type, data),
    };
  }

  /**
   * Generate share text for different platforms
   * @param {string} type - Content type
   * @param {object} data - Content data
   * @returns {string} Share text
   */
  generateShareText(type, data) {
    switch (type) {
      case 'post':
        return `Check out this post by ${data.userName} on Syncup!\n${data.links.share}`;
      case 'profile':
        return `Follow ${data.name} on Syncup!\n${data.links.share}`;
      case 'story':
        return `View ${data.userName}'s story on Syncup!\n${data.links.share}`;
      default:
        return `Check this out on Syncup!\n${data.links.share}`;
    }
  }
}

module.exports = new DeepLinkService();
