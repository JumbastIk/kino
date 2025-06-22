const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cmworinijkexswnjdhao.supabase.co';
const supabaseKey = 'YOUR_SUPABASE_SERVICE_ROLE_KEY'; // безопасно храните

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
