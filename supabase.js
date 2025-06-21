// supabase.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cmworinijkexswnjdhao.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtd29yaW5pamtleHN3bmpkaGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MDU0OTcsImV4cCI6MjA2NjA4MTQ5N30.qd3ns6_nQIhbAGWdXIE16h26AR9Td14OusfCr5x8G1I';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
