const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// On Vercel, persistent disk is read-only; use /tmp fallback
const LOCAL_STORE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'records.json')
  : path.join(__dirname, '..', '..', 'data', 'records.json');

// In-memory cache fallback for serverless execution
let memoryStore = { bookings: [], orders: [] };

function ensureLocalStore() {
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_STORE_PATH)) {
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(memoryStore, null, 2));
    }
  } catch (err) {
    // Rely on memoryStore
  }
}

function saveLocalBackup(type, entry) {
  try {
    ensureLocalStore();
    if (type === 'BEAUTY_BOOKING') {
      memoryStore.bookings.unshift(entry);
    } else {
      memoryStore.orders.unshift(entry);
    }

    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf-8');
      const store = JSON.parse(raw);
      if (type === 'BEAUTY_BOOKING') {
        store.bookings.unshift(entry);
      } else {
        store.orders.unshift(entry);
      }
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2));
    }
  } catch (err) {
    // Memory store fallback
  }
}

function getStoredRecords() {
  ensureLocalStore();
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        bookings: parsed.bookings && parsed.bookings.length ? parsed.bookings : memoryStore.bookings,
        orders: parsed.orders && parsed.orders.length ? parsed.orders : memoryStore.orders
      };
    }
  } catch (err) {}
  return memoryStore;
}

/**
 * Sync to Supabase Database (if credentials configured)
 */
async function syncToSupabase(payload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return false;

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/beauty_bookings`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        reference: payload.reference,
        service_name: payload.serviceName,
        stylist: payload.stylist,
        appointment_date: payload.date,
        time_slot: payload.timeSlot,
        customer_name: payload.customerName,
        customer_phone: payload.customerPhone,
        customer_email: payload.customerEmail,
        deposit_amount: payload.amount,
        payment_status: payload.paymentStatus || 'PAID',
        notes: payload.notes
      })
    });

    if (res.ok) {
      console.log('[Supabase] Successfully recorded in PostgreSQL table.');
      return true;
    } else {
      const errText = await res.text();
      console.warn('[Supabase] Insert notice:', errText);
    }
  } catch (err) {
    console.error('[Supabase] Network error:', err.message);
  }
  return false;
}

/**
 * Sync with Google Sheets + Supabase
 */
async function syncToGoogleSheet(payload) {
  // 1. Local / Serverless Memory Store
  saveLocalBackup(payload.type, payload);

  // 2. Supabase Cloud DB
  const supabaseSynced = await syncToSupabase(payload);

  // 3. Google Sheets (Apps Script Webhook)
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  let sheetSynced = false;

  if (webhookUrl && webhookUrl.startsWith('http')) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        console.log('[GoogleSheets] Successfully synced via Apps Script Webhook.');
        sheetSynced = true;
      }
    } catch (err) {
      console.error('[GoogleSheets] Webhook error:', err.message);
    }
  }

  return {
    success: true,
    supabaseSynced,
    sheetSynced
  };
}

module.exports = {
  syncToGoogleSheet,
  getStoredRecords
};
