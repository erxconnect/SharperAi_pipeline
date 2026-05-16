require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error(
        `Missing Supabase env vars. ` +
        `SUPABASE_URL: ${url ? 'SET' : 'MISSING'}, ` +
        `SUPABASE_KEY: ${key ? 'SET' : 'MISSING'}`
      );
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

async function savePick(pickData) {
  // Skip picks with no edge
  if (pickData.recommendation === 'SKIP') {
    console.log(
      `[saveToDB] Skipping (no edge): ${pickData.away_team} @ ${pickData.home_team}`
    );
    return null;
  }

  // Duplicate check: same home_team + away_team + game_time
  const { data: existing, error: checkError } = await getSupabase()
    .from('picks')
    .select('id')
    .eq('home_team', pickData.home_team)
    .eq('away_team', pickData.away_team)
    .eq('game_time', pickData.game_time)
    .maybeSingle();

  if (checkError) {
    throw new Error(`[saveToDB] Duplicate check failed: ${checkError.message}`);
  }

  if (existing) {
    console.log(
      `[saveToDB] Skipping duplicate: ${pickData.away_team} @ ${pickData.home_team}`
    );
    return existing;
  }

  const { data, error } = await getSupabase()
    .from('picks')
    .insert([{
      sport: pickData.sport,
      home_team: pickData.home_team,
      away_team: pickData.away_team,
      game_time: pickData.game_time,
      pick: pickData.pick,
      confidence: pickData.confidence,
      home_probability: pickData.home_probability ?? null,
      away_probability: pickData.away_probability ?? null,
      our_probability: pickData.our_probability ?? null,
      bookmaker_implied_prob: pickData.bookmaker_implied_prob ?? null,
      edge: pickData.edge ?? null,
      is_value_bet: pickData.is_value_bet ?? false,
      best_odds: pickData.best_odds ?? null,
      best_bookmaker: pickData.best_bookmaker ?? null,
      reason_line1: pickData.reason_line1,
      reason_line2: pickData.reason_line2,
      bet_type: pickData.bet_type,
      recommendation: pickData.recommendation ?? 'LEAN',
    }])
    .select()
    .single();

  if (error) {
    throw new Error(`[saveToDB] Insert failed: ${error.message}`);
  }

  const edgePct = data.edge != null ? ` | edge ${(data.edge * 100).toFixed(1)}%` : '';
  const valueBadge = data.is_value_bet ? ' 🎯 VALUE' : '';
  console.log(
    `[saveToDB] Saved: ${data.pick} (${data.away_team} @ ${data.home_team}) [${data.recommendation}${edgePct}]${valueBadge}`
  );
  return data;
}

module.exports = { savePick };
