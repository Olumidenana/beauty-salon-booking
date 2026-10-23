/**
 * Notification Service: Telegram Bot & Direct Automated WhatsApp DMs
 */

function formatMessage(type, data) {
  const currency = '₦';
  const formattedAmount = (data.amount || 0).toLocaleString();

  return `
✨ *NEW APPOINTMENT CONFIRMED!* ✨
--------------------------------
💇 *Treatment:* ${data.serviceName}
📅 *Date:* ${data.date}
⏰ *Time Slot:* ${data.timeSlot}
👤 *Artist:* ${data.stylist || 'Any Master'}
--------------------------------
*Client Details:*
• *Name:* ${data.customerName}
• *Phone:* ${data.customerPhone}
• *Email:* ${data.customerEmail || 'N/A'}
• *Notes:* ${data.notes || 'None'}
--------------------------------
💰 *Deposit Paid:* ${currency}${formattedAmount} (${data.paymentStatus || 'PAID'})
🔖 *Ref:* ${data.reference || 'N/A'}
`.trim();
}

/**
 * Send alert via Telegram Bot (100% Free, Instant Phone Buzzer)
 */
async function sendTelegramAlert(type, data) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, reason: 'unconfigured' };
  }

  try {
    const text = formatMessage(type, data).replace(/\*/g, '<b>').replace(/<b>([^\n<]+)<b>/g, '<b>$1</b>');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.replace(/\*/g, ''),
        parse_mode: 'HTML'
      })
    });

    const result = await response.json();
    return { sent: result.ok };
  } catch (err) {
    console.error('[Notification] Telegram dispatch error:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send Direct Automated WhatsApp DM to Owner's Phone
 * Supports CallMeBot (Free WhatsApp API) or UltraMsg / Green-API
 */
async function sendDirectWhatsAppDM(type, data) {
  const message = formatMessage(type, data);
  const ownerPhone = process.env.WHATSAPP_OWNER_PHONE; // e.g. +2348012345678
  const callMeBotApiKey = process.env.CALLMEBOT_API_KEY; // Free CallMeBot API Key
  const customGatewayUrl = process.env.WHATSAPP_API_URL;
  const customGatewayToken = process.env.WHATSAPP_API_TOKEN;

  // 1. CallMeBot Free WhatsApp Gateway (Zero cost)
  if (ownerPhone && callMeBotApiKey) {
    try {
      const cleanPhone = ownerPhone.replace(/[^0-9]/g, '');
      const encodedMsg = encodeURIComponent(message);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedMsg}&apikey=${callMeBotApiKey}`;
      
      const res = await fetch(url);
      if (res.ok) {
        console.log('[Notification] Direct WhatsApp message delivered to owner DM via CallMeBot.');
        return { sent: true, provider: 'callmebot' };
      }
    } catch (err) {
      console.warn('[Notification] CallMeBot error:', err.message);
    }
  }

  // 2. Custom WhatsApp Gateway (UltraMsg / GreenAPI / Twilio)
  if (customGatewayUrl && customGatewayToken && ownerPhone) {
    try {
      await fetch(customGatewayUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customGatewayToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: ownerPhone,
          message
        })
      });
      console.log('[Notification] Direct WhatsApp DM delivered via custom gateway.');
      return { sent: true, provider: 'gateway' };
    } catch (err) {
      console.warn('[Notification] Custom gateway error:', err.message);
    }
  }

  return { sent: false, reason: 'unconfigured' };
}

/**
 * Dispatch all alerts
 */
async function dispatchNotifications(type, data) {
  const [telegram, directWhatsapp] = await Promise.all([
    sendTelegramAlert(type, data),
    sendDirectWhatsAppDM(type, data)
  ]);

  return {
    telegram,
    directWhatsapp
  };
}

module.exports = {
  dispatchNotifications,
  formatMessage
};
