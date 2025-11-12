// utils/verifyTurnstile.js
const axios = require('axios');

const verifyTurnstile = async (token) => {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('TURNSTILE_SECRET_KEY chưa được cấu hình');
  }

  try {
    const response = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      new URLSearchParams({
        secret: secretKey,
        response: token,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    return {
      success: response.data.success,
      error: response.data['error-codes'] || [],
    };
  } catch (error) {
    console.error('Turnstile verify error:', error.message);
    return { success: false, error: ['internal_error'] };
  }
};

module.exports = verifyTurnstile;