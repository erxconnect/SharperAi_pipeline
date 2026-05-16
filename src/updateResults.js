require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4/sports';
const SPORTS = ['baseball_mlb', 'basketball_nba'];

async function fetchScoresForSport(sport) {
  const url = `${BASE_URL}/${sport}/scores`;
  const response = await axios.get(url, {
    params: {
      apiKey: ODDS_API_KEY,
      daysFrom: 3,
    },
  });
  return response.data;
}

async function updateResults() {
  const now = new Date().toISOString();

  // Fetch all pending picks with game_time in the past
  const { data: pendingPicks, error: fetchError } = await supabase
    .from('picks')
    .select('*')
    .eq('result', 'pending')
    .lt('game_time', now);

  if (fetchError) {
    throw new Error(`[updateResults] Failed to fetch pending picks: ${fetchError.message}`);
  }

  if (!pendingPicks || pendingPicks.length === 0) {
    console.log('[updateResults] No pending picks to update.');
    return;
  }

  // Gather completed scores from API
  const scoresBySport = {};
  for (const sport of SPORTS) {
    try {
      const scores = await fetchScoresForSport(sport);
      scoresBySport[sport] = scores.filter((g) => g.completed);
    } catch (err) {
      console.error(`[updateResults] Could not fetch scores for ${sport}: ${err.message}`);
      scoresBySport[sport] = [];
    }
  }

  let wins = 0;
  let losses = 0;
  let skipped = 0;

  for (const pick of pendingPicks) {
    const completed = (scoresBySport[pick.sport] || []).find(
      (g) =>
        (g.home_team === pick.home_team && g.away_team === pick.away_team) ||
        (g.home_team === pick.away_team && g.away_team === pick.home_team)
    );

    if (!completed || !completed.scores) {
      skipped++;
      continue;
    }

    // Determine winner from scores array [{name, score}, ...]
    const scoreMap = {};
    for (const s of completed.scores) {
      scoreMap[s.name] = parseInt(s.score, 10);
    }

    const teams = Object.keys(scoreMap);
    if (teams.length < 2) {
      skipped++;
      continue;
    }

    const winner =
      scoreMap[teams[0]] > scoreMap[teams[1]] ? teams[0] : teams[1];
    const result = winner === pick.pick ? 'win' : 'loss';

    const { error: updateError } = await supabase
      .from('picks')
      .update({ result })
      .eq('id', pick.id);

    if (updateError) {
      console.error(
        `[updateResults] Failed to update pick ${pick.id}: ${updateError.message}`
      );
      continue;
    }

    if (result === 'win') wins++;
    else losses++;
  }

  const updated = wins + losses;
  console.log(
    `[updateResults] Updated ${updated} result(s): ${wins} win(s), ${losses} loss(es). Skipped ${skipped} (scores not yet available).`
  );
}

// Allow running standalone
if (require.main === module) {
  updateResults().catch((err) => console.error('[updateResults] Fatal:', err.message));
}

module.exports = { updateResults };
