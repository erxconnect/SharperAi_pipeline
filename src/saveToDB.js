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

async function saveProps(propData) {
  // Duplicate check: same player + prop_type + game_id
  const { data: existing } = await getSupabase()
    .from('player_props')
    .select('id')
    .eq('game_id', propData.game_id)
    .eq('player_name', propData.player_name)
    .eq('prop_type', propData.prop_type)
    .maybeSingle();

  if (existing) {
    console.log(`[saveToDB] Skipping duplicate prop: ${propData.player_name} ${propData.prop_type}`);
    return existing;
  }

  const { data, error } = await getSupabase()
    .from('player_props')
    .insert([{
      game_id:        propData.game_id,
      sport:          propData.sport,
      home_team:      propData.home_team,
      away_team:      propData.away_team,
      player_name:    propData.player_name,
      prop_type:      propData.prop_type,
      line:           propData.line ?? null,
      over_odds:      propData.over_odds ?? null,
      under_odds:     propData.under_odds ?? null,
      best_book:      propData.best_book ?? null,
      ai_pick:        propData.ai_pick,
      ai_confidence:  propData.ai_confidence,
      ai_reason:      propData.ai_reason ?? null,
      edge:           propData.edge ?? null,
      recommendation: propData.recommendation,
      game_time:      propData.game_time,
    }])
    .select()
    .single();

  if (error) {
    throw new Error(`[saveToDB] Props insert failed: ${error.message}`);
  }

  console.log(`[saveToDB] Prop saved: ${data.player_name} ${data.prop_type} ${data.ai_pick} ${data.line} [${data.recommendation}]`);
  return data;
}

module.exports = { savePick, saveProps };
