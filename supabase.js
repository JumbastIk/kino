const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cmworinijkexswnjdhao.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtd29yaW5pamtleHN3bmpkaGFvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDUwNTQ5NywiZXhwIjoyMDY2MDgxNDk3fQ.pyZ5ldHVeBNT6szVPPBC5Tg3HPBWxbV1uuBpBCFE0mo';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
