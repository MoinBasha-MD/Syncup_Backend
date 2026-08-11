const blinkService = require('../services/blinkService');

class BlinkController {
  // GET /api/blinks/contacts
  async getContactsBlinks(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const blinks = await blinkService.getContactsBlinks(currentUserId);

      res.status(200).json({ success: true, data: blinks });
    } catch (error) {
      console.error('Error getting contacts blinks:', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to get contacts blinks' });
    }
  }

  // POST /api/blinks - Create a new blink
  async createBlink(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const blinkData = req.body;
      if (!blinkData || !blinkData.mediaUrl) {
        return res.status(400).json({ success: false, message: 'Blink media URL is required' });
      }

      const result = await blinkService.createBlink(currentUserId, blinkData);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Error creating blink:', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to create blink' });
    }
  }

  // DELETE /api/blinks/:id
  async deleteBlink(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const { id } = req.params;
      const result = await blinkService.deleteBlink(id, currentUserId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('Error deleting blink:', error);
      if (error.message.includes('not found') || error.message.includes('not authorized')) {
        return res.status(404).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message || 'Failed to delete blink' });
    }
  }

  // POST /api/blinks/seen
  async markBlinkSeen(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const { blinkId } = req.body;
      if (!blinkId) {
        return res.status(400).json({ success: false, message: 'Blink ID is required' });
      }

      const result = await blinkService.markBlinkSeen(blinkId, currentUserId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('Error marking blink as seen:', error);
      if (error.message.includes('not authorized')) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message || 'Failed to mark blink as seen' });
    }
  }

  // POST /api/blinks/:id/like
  async toggleBlinkLike(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const { id } = req.params;
      const result = await blinkService.toggleBlinkLike(id, currentUserId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('Error toggling blink like:', error);
      if (error.message.includes('not authorized')) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message || 'Failed to toggle blink like' });
    }
  }

  // POST /api/blinks/:id/capture
  // Reports a screenshot or screen recording captured while viewing a Blink.
  async reportBlinkCapture(req, res) {
    try {
      const currentUserId = req.user.userId || req.user.id || req.user._id?.toString();
      if (!currentUserId) {
        return res.status(400).json({ success: false, message: 'User authentication failed' });
      }

      const { id } = req.params;
      const { captureType } = req.body;
      if (!captureType || !['screenshot', 'screen_recording'].includes(captureType)) {
        return res.status(400).json({ success: false, message: 'Valid captureType is required' });
      }

      const result = await blinkService.reportBlinkCapture(id, currentUserId, captureType);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('Error reporting Blink capture:', error);
      if (error.message.includes('not authorized')) {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (error.message.includes('not found')) {
        return res.status(404).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message || 'Failed to report capture' });
    }
  }
}

module.exports = new BlinkController();
