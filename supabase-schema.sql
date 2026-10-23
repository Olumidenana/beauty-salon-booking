-- ========================================================
-- BEAUTY SALON & LASH BOOKING DATABASE SCHEMA
-- Run this in your Supabase SQL Editor (1-Click Run)
-- ========================================================

-- 1. Create Bookings Table
CREATE TABLE IF NOT EXISTS beauty_bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  service_name TEXT NOT NULL,
  stylist TEXT NOT NULL DEFAULT 'Any Available Master',
  appointment_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  deposit_amount NUMERIC NOT NULL DEFAULT 10000,
  payment_status TEXT NOT NULL DEFAULT 'PAID',
  notes TEXT,
  salon_name TEXT DEFAULT 'MAISON DE LASH'
);

-- 2. Create Index for fast date & availability lookups
CREATE INDEX IF NOT EXISTS idx_beauty_bookings_date ON beauty_bookings (appointment_date, time_slot);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE beauty_bookings ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Allow anon public to insert bookings (during checkout)
CREATE POLICY "Allow public booking inserts" 
ON beauty_bookings FOR INSERT 
WITH CHECK (true);

-- 5. Policy: Allow reading bookings (for slot availability checks)
CREATE POLICY "Allow public availability check" 
ON beauty_bookings FOR SELECT 
USING (true);
