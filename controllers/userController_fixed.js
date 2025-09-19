// @desc    Get user by userId (UUID)
// @route   GET /api/users?userid=:userId
// @access  Private
const getUserByUserId = async (req, res) => {
  try {
    const { userid } = req.query;

    if (!userid) {
      return res.status(400).json({ 
        success: false,
        message: 'User ID is required' 
      });
    }

    console.log(`Getting user data for userId: ${userid}`);

    // Find user by UUID (userId field)
    const user = await User.findOne({ userId: userid });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Return user data without sensitive information
    res.json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender
      }
    });
  } catch (error) {
    console.error('Error getting user by userId:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};
