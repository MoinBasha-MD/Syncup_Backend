const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/userModel');
const StatusPrivacy = require('../models/statusPrivacyModel');
const Group = require('../models/groupModel');

describe('Status Privacy Controller', () => {
  let authToken;
  let userId;
  let testGroupId;

  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/syncup_test');
    
    // Create test user
    const testUser = await User.create({
      name: 'Test User',
      email: 'test@example.com',
      phoneNumber: '+1234567890',
      password: 'password123'
    });
    
    userId = testUser._id;
    authToken = testUser.generateToken();
    
    // Create test group
    const testGroup = await Group.create({
      name: 'Test Group',
      description: 'Test group for privacy testing',
      members: [userId],
      createdBy: userId
    });
    
    testGroupId = testGroup._id;
  });

  afterAll(async () => {
    // Clean up test data
    await User.deleteMany({});
    await StatusPrivacy.deleteMany({});
    await Group.deleteMany({});
    await mongoose.connection.close();
  });

  describe('GET /api/status-privacy/default', () => {
    it('should get default privacy settings', async () => {
      const response = await request(app)
        .get('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('visibility');
      expect(response.body.data.visibility).toBe('friends');
    });

    it('should return 401 without auth token', async () => {
      await request(app)
        .get('/api/status-privacy/default')
        .expect(401);
    });
  });

  describe('PUT /api/status-privacy/default', () => {
    it('should update default privacy settings', async () => {
      const privacySettings = {
        visibility: 'groups',
        allowedGroups: [testGroupId],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: {
          enabled: true,
          shareWith: 'groups',
          allowedGroups: [testGroupId],
          allowedContacts: []
        }
      };

      const response = await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(privacySettings)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.visibility).toBe('groups');
      expect(response.body.data.allowedGroups).toContain(testGroupId.toString());
    });

    it('should reject invalid visibility setting', async () => {
      const invalidSettings = {
        visibility: 'invalid_visibility',
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: []
      };

      await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidSettings)
        .expect(400);
    });

    it('should reject invalid location sharing setting', async () => {
      const invalidSettings = {
        visibility: 'friends',
        locationSharing: {
          enabled: true,
          shareWith: 'invalid_share_option'
        }
      };

      await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidSettings)
        .expect(400);
    });
  });

  describe('GET /api/status-privacy/groups', () => {
    it('should get user groups for privacy settings', async () => {
      const response = await request(app)
        .get('/api/status-privacy/groups')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('name');
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing required fields gracefully', async () => {
      const incompleteSettings = {
        visibility: 'groups'
        // Missing other required fields
      };

      const response = await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(incompleteSettings);

      // Should still work with defaults
      expect(response.status).toBe(200);
      expect(response.body.data.allowedGroups).toBeDefined();
    });

    it('should handle non-existent group IDs', async () => {
      const nonExistentGroupId = new mongoose.Types.ObjectId();
      const settingsWithInvalidGroup = {
        visibility: 'groups',
        allowedGroups: [nonExistentGroupId],
        allowedContacts: [],
        blockedContacts: []
      };

      const response = await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(settingsWithInvalidGroup)
        .expect(200);

      // Should accept the setting even if group doesn't exist
      expect(response.body.success).toBe(true);
    });

    it('should handle extremely large arrays', async () => {
      const largeArray = new Array(1000).fill(new mongoose.Types.ObjectId());
      const settingsWithLargeArray = {
        visibility: 'contacts',
        allowedGroups: [],
        allowedContacts: largeArray,
        blockedContacts: []
      };

      const response = await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send(settingsWithLargeArray);

      // Should handle large arrays (might want to add limits in production)
      expect(response.status).toBe(200);
    });

    it('should handle concurrent privacy updates', async () => {
      const settings1 = { visibility: 'public' };
      const settings2 = { visibility: 'private' };

      // Make concurrent requests
      const [response1, response2] = await Promise.all([
        request(app)
          .put('/api/status-privacy/default')
          .set('Authorization', `Bearer ${authToken}`)
          .send(settings1),
        request(app)
          .put('/api/status-privacy/default')
          .set('Authorization', `Bearer ${authToken}`)
          .send(settings2)
      ]);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });
  });

  describe('Privacy Visibility Logic', () => {
    let otherUserId;
    let otherUserToken;

    beforeAll(async () => {
      const otherUser = await User.create({
        name: 'Other User',
        email: 'other@example.com',
        phoneNumber: '+9876543210',
        password: 'password123'
      });
      
      otherUserId = otherUser._id;
      otherUserToken = otherUser.generateToken();
    });

    it('should correctly check public visibility', async () => {
      // Set privacy to public
      await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ visibility: 'public' });

      // Check if other user can see status
      const response = await request(app)
        .get(`/api/status-privacy/can-see/${userId}`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .expect(200);

      expect(response.body.data.canSee).toBe(true);
    });

    it('should correctly check private visibility', async () => {
      // Set privacy to private
      await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ visibility: 'private' });

      // Check if other user can see status
      const response = await request(app)
        .get(`/api/status-privacy/can-see/${userId}`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .expect(200);

      expect(response.body.data.canSee).toBe(false);
    });

    it('should allow user to see their own status regardless of privacy', async () => {
      // Set privacy to private
      await request(app)
        .put('/api/status-privacy/default')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ visibility: 'private' });

      // Check if user can see their own status
      const response = await request(app)
        .get(`/api/status-privacy/can-see/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.canSee).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    it('should handle multiple privacy checks efficiently', async () => {
      const startTime = Date.now();
      
      // Make 10 concurrent privacy checks
      const promises = Array(10).fill().map(() =>
        request(app)
          .get(`/api/status-privacy/can-see/${userId}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Should complete within reasonable time (adjust threshold as needed)
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });
});
