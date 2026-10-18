const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    try {
      // Validate environment variables
      if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
        throw new Error('EMAIL_USER and EMAIL_APP_PASSWORD must be set in .env file');
      }

      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // Use TLS
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_APP_PASSWORD,
        },
        tls: {
          rejectUnauthorized: true
        },
        requireTLS: true,
        debug: false,
        logger: false
      });
      this.initialized = true;
      console.log('✅ [EMAIL SERVICE] Initialized successfully');
      console.log('📧 [EMAIL SERVICE] Using email:', process.env.EMAIL_USER);
    } catch (error) {
      console.error('❌ [EMAIL SERVICE] Initialization failed:', error);
      throw error;
    }
  }

  async verifyConnection() {
    try {
      if (!this.initialized) {
        this.initialize();
      }
      await this.transporter.verify();
      console.log('✅ [EMAIL SERVICE] SMTP connection verified');
      return true;
    } catch (error) {
      console.error('❌ [EMAIL SERVICE] SMTP connection failed:', error);
      return false;
    }
  }

  async sendOTP(email, otp, type) {
    if (!this.initialized) {
      this.initialize();
    }

    const templates = {
      registration: {
        subject: 'Verify Your Email - Syncup',
        html: this.getRegistrationTemplate(otp),
      },
      password_reset: {
        subject: 'Password Reset Code - Syncup',
        html: this.getPasswordResetTemplate(otp),
      },
      email_change: {
        subject: 'Verify Your New Email - Syncup',
        html: this.getEmailChangeTemplate(otp),
      },
      partner_verification: {
        subject: 'Verify Your Partner Account - Syncup Partners',
        html: this.getPartnerVerificationTemplate(otp),
      },
      partner_password_reset: {
        subject: 'Partner Password Reset Code - Syncup Partners',
        html: this.getPartnerPasswordResetTemplate(otp),
      },
    };

    const template = templates[type] || templates.registration;

    try {
      const info = await this.transporter.sendMail({
        from: `"Syncup" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: template.subject,
        html: template.html,
      });

      console.log('✅ [EMAIL SERVICE] Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ [EMAIL SERVICE] Send error:', error);
      return { success: false, error: error.message };
    }
  }

  getRegistrationTemplate(otp) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 700;
          }
          .content { 
            padding: 40px 30px;
          }
          .otp-box { 
            background: #f8f9fa;
            border: 2px solid #667eea; 
            border-radius: 12px; 
            padding: 30px; 
            text-align: center; 
            margin: 30px 0;
          }
          .otp-label {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: #666;
            font-weight: 500;
          }
          .otp-code { 
            font-size: 36px; 
            font-weight: 700; 
            color: #667eea; 
            letter-spacing: 10px;
            margin: 10px 0;
          }
          .otp-expiry {
            margin: 10px 0 0 0;
            font-size: 13px;
            color: #999;
          }
          .warning { 
            background: #fff3cd; 
            border-left: 4px solid #ffc107; 
            padding: 16px; 
            margin: 25px 0;
            border-radius: 4px;
          }
          .warning strong {
            color: #856404;
          }
          .footer { 
            text-align: center; 
            padding: 30px;
            background: #f8f9fa;
            color: #666; 
            font-size: 13px;
            border-top: 1px solid #e9ecef;
          }
          .footer p {
            margin: 5px 0;
          }
          p {
            margin: 15px 0;
            color: #555;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Syncup!</h1>
          </div>
          <div class="content">
            <p>Thank you for registering with Syncup. To complete your registration and verify your email address, please use the verification code below:</p>
            
            <div class="otp-box">
              <p class="otp-label">Your Verification Code</p>
              <div class="otp-code">${otp}</div>
              <p class="otp-expiry">⏱️ This code will expire in 1 minute</p>
            </div>

            <div class="warning">
              <strong>⚠️ Security Notice:</strong> Never share this code with anyone. Syncup will never ask for your verification code via phone, email, or any other method.
            </div>

            <p>If you didn't request this code, please ignore this email or contact our support team immediately.</p>
            
            <p style="margin-top: 30px;">Best regards,<br><strong>The Syncup Team</strong></p>
          </div>
          <div class="footer">
            <p><strong>© 2025 Syncup. All rights reserved.</strong></p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getPasswordResetTemplate(otp) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .header { 
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 700;
          }
          .content { 
            padding: 40px 30px;
          }
          .otp-box { 
            background: #f8f9fa;
            border: 2px solid #f5576c; 
            border-radius: 12px; 
            padding: 30px; 
            text-align: center; 
            margin: 30px 0;
          }
          .otp-label {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: #666;
            font-weight: 500;
          }
          .otp-code { 
            font-size: 36px; 
            font-weight: 700; 
            color: #f5576c; 
            letter-spacing: 10px;
            margin: 10px 0;
          }
          .otp-expiry {
            margin: 10px 0 0 0;
            font-size: 13px;
            color: #999;
          }
          .warning { 
            background: #f8d7da; 
            border-left: 4px solid #dc3545; 
            padding: 16px; 
            margin: 25px 0;
            border-radius: 4px;
          }
          .warning strong {
            color: #721c24;
          }
          .footer { 
            text-align: center; 
            padding: 30px;
            background: #f8f9fa;
            color: #666; 
            font-size: 13px;
            border-top: 1px solid #e9ecef;
          }
          .footer p {
            margin: 5px 0;
          }
          p {
            margin: 15px 0;
            color: #555;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset Request</h1>
          </div>
          <div class="content">
            <p>We received a request to reset your Syncup account password. Use the code below to proceed with resetting your password:</p>
            
            <div class="otp-box">
              <p class="otp-label">Your Password Reset Code</p>
              <div class="otp-code">${otp}</div>
              <p class="otp-expiry">⏱️ This code will expire in 1 minute</p>
            </div>

            <div class="warning">
              <strong>⚠️ Security Alert:</strong> If you didn't request a password reset, please ignore this email and ensure your account is secure. Consider changing your password if you suspect unauthorized access.
            </div>

            <p>Enter this code in the app to proceed with resetting your password.</p>
            
            <p style="margin-top: 30px;">Best regards,<br><strong>The Syncup Team</strong></p>
          </div>
          <div class="footer">
            <p><strong>© 2025 Syncup. All rights reserved.</strong></p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getPartnerTemplate(otp, { heading, intro, expiryText }) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%); color: white; padding: 40px 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
          .header .brand { margin: 8px 0 0 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.85; }
          .content { padding: 40px 30px; }
          .otp-box { background: #f8f9fa; border: 2px solid #7C3AED; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0; }
          .otp-label { margin: 0 0 10px 0; font-size: 14px; color: #666; font-weight: 500; }
          .otp-code { font-size: 36px; font-weight: 700; color: #7C3AED; letter-spacing: 10px; margin: 10px 0; }
          .otp-expiry { margin: 10px 0 0 0; font-size: 13px; color: #999; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; margin: 25px 0; border-radius: 4px; }
          .warning strong { color: #856404; }
          .footer { text-align: center; padding: 30px; background: #f8f9fa; color: #666; font-size: 13px; border-top: 1px solid #e9ecef; }
          .footer p { margin: 5px 0; }
          p { margin: 15px 0; color: #555; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${heading}</h1>
            <p class="brand">Syncup Partners</p>
          </div>
          <div class="content">
            <p>${intro}</p>
            <div class="otp-box">
              <p class="otp-label">Your Verification Code</p>
              <div class="otp-code">${otp}</div>
              <p class="otp-expiry">⏱️ ${expiryText}</p>
            </div>
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> Never share this code with anyone. Syncup will never ask for your verification code via phone, email, or any other method.
            </div>
            <p>If you didn't request this code, please ignore this email.</p>
            <p style="margin-top: 30px;">Best regards,<br><strong>The Syncup Partners Team</strong></p>
          </div>
          <div class="footer">
            <p><strong>Syncup Partners</strong></p>
            <p>This is an automated message. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async sendPartnerDecision(email, { businessName, decision, reason }) {
    if (!this.initialized) {
      this.initialize();
    }
    const safeName = this.escapeHtml(businessName || 'your business');
    const safeReason = this.escapeHtml(reason || '');
    const portalUrl = process.env.SYNC_SPACE_PORTAL_ORIGIN
      ? `${process.env.SYNC_SPACE_PORTAL_ORIGIN}/partners`
      : 'https://api.crackman.in/partners';
    const blocks = {
      approve: {
        subject: "You're approved — production access is live · Syncup Partners",
        heading: "You're approved",
        body: `<p><strong>${safeName}</strong> is now linked with Syncup. Your production access is live — create live integrations, issue API keys, and start connecting customers.</p>
          <p><a href="${portalUrl}" style="color:#7C3AED;">Open the partner portal</a></p>`,
      },
      reject: {
        subject: 'Your Syncup Partners application needs changes',
        heading: 'Application not approved',
        body: `<p><strong>${safeName}</strong> wasn't approved this time. Reason: <em>${safeReason}</em></p>
          <p>You can update your details and request production access again from the partner portal.</p>`,
      },
      suspend: {
        subject: 'Your Syncup Partners account was suspended',
        heading: 'Account suspended',
        body: `<p><strong>${safeName}</strong> was suspended. Reason: <em>${safeReason}</em></p>
          <p>Contact support if you believe this is a mistake.</p>`,
      },
      restore: {
        subject: 'Your Syncup Partners account was restored',
        heading: 'Account restored',
        body: `<p><strong>${safeName}</strong> is active again. Reason: <em>${safeReason}</em></p>
          <p><a href="${portalUrl}" style="color:#7C3AED;">Open the partner portal</a></p>`,
      },
    };
    const block = blocks[decision] || blocks.restore;
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0;">
        <div style="max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%); color: white; padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 26px;">${block.heading}</h1>
            <p style="margin: 8px 0 0 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.85;">Syncup Partners</p>
          </div>
          <div style="padding: 40px 30px;">
            ${block.body}
            <p style="margin-top: 30px; color: #555;">Best regards,<br><strong>The Syncup Partners Team</strong></p>
          </div>
          <div style="text-align: center; padding: 30px; background: #f8f9fa; color: #666; font-size: 13px; border-top: 1px solid #e9ecef;">
            <p style="margin: 5px 0;"><strong>Syncup Partners</strong></p>
            <p style="margin: 5px 0;">This is an automated message. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    try {
      const info = await this.transporter.sendMail({
        from: `"Syncup" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: block.subject,
        html,
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ [EMAIL SERVICE] Partner decision email failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  getPartnerVerificationTemplate(otp) {
    return this.getPartnerTemplate(otp, {
      heading: 'Verify your partner account',
      intro: 'Thanks for creating a Syncup Partners account. Enter this code to verify your business email and unlock your sandbox:',
      expiryText: 'This code will expire in 10 minutes',
    });
  }

  getPartnerPasswordResetTemplate(otp) {
    return this.getPartnerTemplate(otp, {
      heading: 'Reset your partner password',
      intro: 'We received a request to reset the password on your Syncup Partners account. Use this code to continue:',
      expiryText: 'This code will expire in 10 minutes',
    });
  }

  getEmailChangeTemplate(otp) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          .header { 
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 700;
          }
          .content { 
            padding: 40px 30px;
          }
          .otp-box { 
            background: #f8f9fa;
            border: 2px solid #4facfe; 
            border-radius: 12px; 
            padding: 30px; 
            text-align: center; 
            margin: 30px 0;
          }
          .otp-label {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: #666;
            font-weight: 500;
          }
          .otp-code { 
            font-size: 36px; 
            font-weight: 700; 
            color: #4facfe; 
            letter-spacing: 10px;
            margin: 10px 0;
          }
          .otp-expiry {
            margin: 10px 0 0 0;
            font-size: 13px;
            color: #999;
          }
          .info { 
            background: #d1ecf1; 
            border-left: 4px solid #17a2b8; 
            padding: 16px; 
            margin: 25px 0;
            border-radius: 4px;
          }
          .info strong {
            color: #0c5460;
          }
          .footer { 
            text-align: center; 
            padding: 30px;
            background: #f8f9fa;
            color: #666; 
            font-size: 13px;
            border-top: 1px solid #e9ecef;
          }
          .footer p {
            margin: 5px 0;
          }
          p {
            margin: 15px 0;
            color: #555;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📧 Verify Your New Email</h1>
          </div>
          <div class="content">
            <p>You've requested to change your email address. Please verify this new email to complete the change:</p>
            
            <div class="otp-box">
              <p class="otp-label">Your Email Verification Code</p>
              <div class="otp-code">${otp}</div>
              <p class="otp-expiry">⏱️ This code will expire in 1 minute</p>
            </div>

            <div class="info">
              <strong>ℹ️ Important:</strong> If you didn't request this email change, please contact our support team immediately to secure your account.
            </div>

            <p>Enter this code in the app to verify your new email address.</p>
            
            <p style="margin-top: 30px;">Best regards,<br><strong>The Syncup Team</strong></p>
          </div>
          <div class="footer">
            <p><strong>© 2025 Syncup. All rights reserved.</strong></p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
