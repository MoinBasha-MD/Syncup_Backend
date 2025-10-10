const StatusTemplate = require('../models/statusTemplateModel');

/**
 * 🆕 Create System Templates
 * Creates default status templates that are available to all users
 */
const createSystemTemplates = async () => {
  console.log('🎨 Creating system status templates...');

  const systemTemplates = [
    // Work Templates
    {
      name: 'Daily Standup',
      status: 'In a meeting',
      customStatus: 'Daily standup meeting',
      duration: 30,
      category: 'work',
      icon: 'Users',
      color: '#4A90E2',
      description: 'Daily team standup meeting',
      tags: ['meeting', 'standup', 'team'],
      isSystemTemplate: true,
      isPublic: true,
      quickSchedule: {
        todayAt: '09:00',
        nextWeekdays: '09:00'
      },
      autoTriggers: {
        calendarKeywords: ['standup', 'daily', 'scrum'],
        timePatterns: ['09:00']
      }
    },
    {
      name: 'Focus Time',
      status: 'Do not disturb',
      customStatus: 'Deep work - please do not disturb',
      duration: 120,
      category: 'work',
      icon: 'Brain',
      color: '#E74C3C',
      description: 'Uninterrupted focus time for deep work',
      tags: ['focus', 'deep work', 'productivity'],
      isSystemTemplate: true,
      isPublic: true,
      quickSchedule: {
        todayAt: '10:00',
        nextWeekdays: '10:00-12:00'
      },
      autoTriggers: {
        calendarKeywords: ['focus', 'deep work', 'coding', 'development'],
        timePatterns: ['10:00', '14:00']
      }
    },
    {
      name: 'Lunch Break',
      status: 'On a break',
      customStatus: 'Having lunch',
      duration: 60,
      category: 'personal',
      icon: 'Coffee',
      color: '#F39C12',
      description: 'Lunch break',
      tags: ['lunch', 'break', 'personal'],
      isSystemTemplate: true,
      isPublic: true,
      quickSchedule: {
        todayAt: '12:30',
        nextWeekdays: '12:30'
      },
      autoTriggers: {
        calendarKeywords: ['lunch', 'break'],
        timePatterns: ['12:00', '12:30', '13:00']
      }
    },
    {
      name: 'Client Meeting',
      status: 'In a meeting',
      customStatus: 'Meeting with client',
      duration: 60,
      category: 'work',
      icon: 'Handshake',
      color: '#2ECC71',
      description: 'Meeting with clients or external stakeholders',
      tags: ['meeting', 'client', 'external'],
      isSystemTemplate: true,
      isPublic: true,
      autoTriggers: {
        calendarKeywords: ['client', 'customer', 'stakeholder', 'external']
      }
    },

    // Personal Templates
    {
      name: 'Gym Workout',
      status: 'At gym',
      customStatus: 'Working out at the gym',
      duration: 90,
      category: 'health',
      icon: 'Dumbbell',
      color: '#9B59B6',
      description: 'Gym workout session',
      tags: ['gym', 'workout', 'fitness', 'health'],
      isSystemTemplate: true,
      isPublic: true,
      quickSchedule: {
        todayAt: '18:00'
      },
      autoTriggers: {
        calendarKeywords: ['gym', 'workout', 'fitness', 'exercise'],
        locationTriggers: ['gym', 'fitness center']
      }
    },
    {
      name: 'Doctor Appointment',
      status: 'Doctor appointment',
      customStatus: 'At medical appointment',
      duration: 45,
      category: 'health',
      icon: 'Stethoscope',
      color: '#E67E22',
      description: 'Medical appointment',
      tags: ['doctor', 'medical', 'health', 'appointment'],
      isSystemTemplate: true,
      isPublic: true,
      autoTriggers: {
        calendarKeywords: ['doctor', 'medical', 'appointment', 'clinic', 'hospital'],
        locationTriggers: ['hospital', 'clinic', 'medical center']
      }
    },

    // Travel Templates
    {
      name: 'Commuting',
      status: 'Driving',
      customStatus: 'Commuting to work',
      duration: 30,
      category: 'travel',
      icon: 'Car',
      color: '#34495E',
      description: 'Daily commute',
      tags: ['commute', 'driving', 'travel'],
      isSystemTemplate: true,
      isPublic: true,
      quickSchedule: {
        nextWeekdays: '08:30'
      },
      autoTriggers: {
        calendarKeywords: ['commute', 'travel', 'drive'],
        timePatterns: ['08:30', '17:30']
      }
    },
    {
      name: 'Business Trip',
      status: 'Traveling',
      customStatus: 'On business trip',
      duration: 480, // 8 hours
      category: 'travel',
      icon: 'Plane',
      color: '#3498DB',
      description: 'Business travel',
      tags: ['business', 'trip', 'travel', 'flight'],
      isSystemTemplate: true,
      isPublic: true,
      autoTriggers: {
        calendarKeywords: ['flight', 'trip', 'travel', 'business trip'],
        locationTriggers: ['airport', 'terminal']
      }
    },

    // Emergency Templates
    {
      name: 'Family Emergency',
      status: 'At emergency',
      customStatus: 'Family emergency - unavailable',
      duration: 240, // 4 hours
      category: 'emergency',
      icon: 'AlertTriangle',
      color: '#E74C3C',
      description: 'Family emergency situation',
      tags: ['emergency', 'family', 'urgent'],
      isSystemTemplate: true,
      isPublic: true,
      autoTriggers: {
        calendarKeywords: ['emergency', 'urgent', 'family emergency']
      }
    },

    // Learning Templates
    {
      name: 'Training Session',
      status: 'In training',
      customStatus: 'Attending training session',
      duration: 120,
      category: 'work',
      icon: 'GraduationCap',
      color: '#8E44AD',
      description: 'Professional training or learning session',
      tags: ['training', 'learning', 'development'],
      isSystemTemplate: true,
      isPublic: true,
      autoTriggers: {
        calendarKeywords: ['training', 'workshop', 'seminar', 'course', 'learning']
      }
    }
  ];

  try {
    // Check if system templates already exist
    const existingCount = await StatusTemplate.countDocuments({ isSystemTemplate: true });
    
    if (existingCount > 0) {
      console.log(`ℹ️ ${existingCount} system templates already exist, skipping creation`);
      return;
    }

    // Create system templates
    const createdTemplates = await StatusTemplate.insertMany(systemTemplates);
    
    console.log(`✅ Created ${createdTemplates.length} system status templates`);
    
    // Log created templates
    createdTemplates.forEach(template => {
      console.log(`   📋 ${template.name} (${template.category})`);
    });

  } catch (error) {
    console.error('❌ Error creating system templates:', error);
  }
};

module.exports = { createSystemTemplates };
