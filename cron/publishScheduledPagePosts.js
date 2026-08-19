const cron = require('node-cron');
const PagePost = require('../models/PagePost');
const Page = require('../models/Page');
const { distributePagePost } = require('../controllers/pagePostController');
const { broadcastToUser } = require('../socketManager');

/**
 * Cron job to publish scheduled page posts when their scheduledFor time arrives.
 * Runs every minute.
 */
function initializeScheduledPagePostPublisher() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const scheduledPosts = await PagePost.find({
        status: 'scheduled',
        isPublished: false,
        scheduledFor: { $lte: now }
      }).populate('page', 'name username profileImage followerCount');

      if (scheduledPosts.length === 0) return;

      console.log(`📅 [CRON] Publishing ${scheduledPosts.length} scheduled page post(s)`);

      for (const post of scheduledPosts) {
        try {
          const page = post.page || (await Page.findById(post.page));
          if (!page) {
            console.warn(`⚠️ [CRON] Page not found for scheduled post ${post._id}`);
            continue;
          }

          post.status = 'published';
          post.isPublished = true;
          post.publishedAt = now;
          await post.save();

          await distributePagePost(post, page, post.visibility, post.targetAudience);

          // Notify followers about the newly published scheduled post
          try {
            const PageFollower = require('../models/PageFollower');
            const followers = await PageFollower.find({ pageId: page._id }).select('userId');
            const payload = {
              pagePostId: post._id,
              pageId: page._id,
              pageName: page.name,
              pageUsername: page.username,
              pageProfileImage: page.profileImage,
              visibility: post.visibility,
              createdAt: post.createdAt
            };

            followers.forEach(follower => {
              broadcastToUser(follower.userId.toString(), 'page:new_post', payload);
            });

            console.log(`📡 [CRON] Notified ${followers.length} followers about scheduled post ${post._id}`);
          } catch (broadcastError) {
            console.error(`❌ [CRON] Error broadcasting scheduled post ${post._id}:`, broadcastError);
          }

          console.log(`✅ [CRON] Published scheduled page post ${post._id}`);
        } catch (postError) {
          console.error(`❌ [CRON] Error publishing scheduled post ${post._id}:`, postError);
        }
      }
    } catch (error) {
      console.error('❌ [CRON] Error running scheduled page post publisher:', error);
    }
  });

  console.log('✅ [CRON] Scheduled page post publisher initialized (runs every minute)');
}

module.exports = { initializeScheduledPagePostPublisher };
