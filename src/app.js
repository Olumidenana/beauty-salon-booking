require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initializeTransaction, verifyTransaction, verifyWebhookSignature, IS_DEMO_MODE } = require('./services/paystack');
const { syncToGoogleSheet, getStoredRecords } = require('./services/googleSheets');
const { dispatchNotifications } = require('./services/notifications');

const app = express();

app.use(cors());

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Serve static UI templates
app.use(express.static(path.join(__dirname, '..', 'public')));

// Explicit Clean HTML Page Routes (Supports both /book and /book.html)
app.get(['/book', '/book.html'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'book.html')));
app.get(['/treatments', '/treatments.html'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'treatments.html')));
app.get(['/lookbook', '/lookbook.html'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'lookbook.html')));
app.get(['/about', '/about.html'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'about.html')));

const ALL_STUDIO_SLOTS = [
  '10:00 AM', '11:45 AM', '01:30 PM', '03:15 PM', '05:00 PM', '06:30 PM'
];

/**
 * Check if a date falls on a closed day (e.g. Sunday)
 */
function isStudioClosed(dateString) {
  if (!dateString) return false;
  const d = new Date(dateString + 'T00:00:00Z');
  return d.getUTCDay() === 0; // 0 = Sunday
}

/**
 * Query Supabase & Local Memory for Booked Slots to prevent Double-Booking
 */
async function getBookedSlots(date, stylist) {
  let bookedSlots = [];

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      let queryUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/beauty_bookings?appointment_date=eq.${date}&select=time_slot,stylist`;
      if (stylist && !stylist.includes('Any')) {
        queryUrl += `&stylist=eq.${encodeURIComponent(stylist)}`;
      }

      const res = await fetch(queryUrl, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });

      if (res.ok) {
        const rows = await res.json();
        bookedSlots = rows.map(r => r.time_slot);
      }
    } catch (err) {
      console.warn('[Availability] Supabase lookup error:', err.message);
    }
  }

  // Combine with local store
  const { bookings } = getStoredRecords();
  const localBooked = bookings
    .filter(b => b.date === date && (!stylist || b.stylist === stylist || stylist.includes('Any') || b.stylist.includes('Any')))
    .map(b => b.timeSlot);

  return [...new Set([...bookedSlots, ...localBooked])];
}

// 1. Health
app.get(['/api/health', '/health'], (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    demoMode: IS_DEMO_MODE,
    hasGoogleSheetWebhook: !!process.env.GOOGLE_SHEET_WEBHOOK_URL,
    hasTelegram: !!process.env.TELEGRAM_BOT_TOKEN
  });
});

// 2. LIVE AVAILABILITY CHECKER (PREVENTS DOUBLE BOOKINGS)
app.get(['/api/availability', '/availability'], async (req, res) => {
  try {
    const { date, stylist } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Please specify a date' });
    }

    // Check if Sunday
    if (isStudioClosed(date)) {
      return res.json({
        date,
        closed: true,
        message: 'The studio is closed on Sundays for deep sterilization (VIP Bridal bookings only via WhatsApp). Please pick Monday – Saturday.',
        slots: []
      });
    }

    const booked = await getBookedSlots(date, stylist);

    const slots = ALL_STUDIO_SLOTS.map(time => ({
      time,
      available: !booked.includes(time),
      status: booked.includes(time) ? 'BOOKED' : 'OPEN'
    }));

    const availableCount = slots.filter(s => s.available).length;

    res.json({
      date,
      closed: false,
      totalSlots: ALL_STUDIO_SLOTS.length,
      availableSlotsCount: availableCount,
      fullyBooked: availableCount === 0,
      slots
    });
  } catch (err) {
    console.error('[API Availability Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Beauty / Lash Booking (WITH DOUBLE-BOOKING LOCK)
app.post(['/api/bookings/create', '/bookings/create'], async (req, res) => {
  try {
    const {
      serviceName,
      stylist,
      date,
      timeSlot,
      customerName,
      customerPhone,
      customerEmail,
      depositAmount,
      notes,
      reference
    } = req.body;

    if (!customerName || !customerPhone || !serviceName || !date || !timeSlot) {
      return res.status(400).json({ error: 'Missing required booking fields.' });
    }

    // A. Enforce Operating Days (Closed on Sundays)
    if (isStudioClosed(date)) {
      return res.status(400).json({
        error: 'The studio is closed on Sundays. Please select a date from Monday to Saturday.'
      });
    }

    // B. Check against double-booking
    const alreadyBooked = await getBookedSlots(date, stylist);
    if (alreadyBooked.includes(timeSlot)) {
      return res.status(409).json({
        error: `Sorry! The ${timeSlot} slot on ${date} was just secured by another client. Please select another open time slot.`
      });
    }

    const bookingPayload = {
      type: 'BEAUTY_BOOKING',
      reference: reference || `LASH_${Date.now()}`,
      serviceName,
      stylist: stylist || 'Any Available Master',
      date,
      timeSlot,
      customerName,
      customerPhone,
      customerEmail: customerEmail || '',
      amount: Number(depositAmount) || 10000,
      paymentStatus: 'PAID',
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    const sheetSync = await syncToGoogleSheet(bookingPayload);
    const notificationResult = await dispatchNotifications('BEAUTY_BOOKING', bookingPayload);

    res.json({
      success: true,
      message: 'Booking confirmed and processed.',
      booking: bookingPayload,
      sheetSync,
      notifications: notificationResult
    });
  } catch (error) {
    console.error('[API] Booking error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Paystack Initialize
app.post(['/api/paystack/initialize', '/paystack/initialize'], async (req, res) => {
  try {
    const { email, amount, metadata, callbackUrl } = req.body;
    const amountInKobo = Math.round(Number(amount) * 100);

    const initResult = await initializeTransaction({
      email,
      amountInKobo,
      metadata,
      callbackUrl
    });

    res.json(initResult);
  } catch (err) {
    console.error('[API] Paystack init error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Paystack Webhook
app.post(['/api/paystack/webhook', '/paystack/webhook'], async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const isValid = verifyWebhookSignature(req.rawBody, signature);

  if (!isValid) {
    return res.status(401).send('Invalid webhook signature');
  }

  const event = req.body;
  if (event.event === 'charge.success') {
    const data = event.data;
    const metadata = data.metadata || {};

    await syncToGoogleSheet({
      type: 'BEAUTY_BOOKING',
      reference: data.reference,
      serviceName: metadata.serviceName,
      stylist: metadata.stylist,
      date: metadata.date,
      timeSlot: metadata.timeSlot,
      customerName: metadata.customerName,
      customerPhone: metadata.customerPhone,
      customerEmail: data.customer.email,
      amount: data.amount / 100,
      paymentStatus: 'PAID',
      notes: metadata.notes
    });
    await dispatchNotifications('BEAUTY_BOOKING', metadata);
  }

  res.sendStatus(200);
});

// 6. Admin Data Records
app.get(['/api/records', '/records'], (req, res) => {
  const records = getStoredRecords();
  res.json(records);
});

// Catch-all JSON 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;
