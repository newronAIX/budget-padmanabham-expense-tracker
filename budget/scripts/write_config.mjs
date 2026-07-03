import { writeFileSync } from "node:fs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to build config.js.");
}

const config = `window.BUDGET_CONFIG = ${JSON.stringify(
  {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey
  },
  null,
  2
)};\n`;

writeFileSync("config.js", config);
