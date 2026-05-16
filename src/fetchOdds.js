require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const axios = require('axios');

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Per-sport region mapping — US sports don't need UK region, saves credits
const SPORTS = [
  { key: 'baseball_mlb',              label: 'MLB',  regions: 'us' },
  { key: 'basketball_nba',            label: 'NBA',  regions: 'us' },
  { key: 'americanfootball_nfl',      label: 'NFL',  regions: 'us' },
  { key: 'soccer_epl',                label: 'EPL',  regions: 'uk' },
  { key: 'soccer_usa_mls',            label: 'MLS',  regions: 'us' },
  { key: 'mma_mixed_martial_arts',    label: 'MMA',  regions: 'us' },
];

const TARGET_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'bet365', 'pointsbet'];

// Only keep games starting within the next 7 days
const NOW = Date.now();
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isWithinWindow(commenceTime) {
  const t = new Date(commenceTime).getTime();
  return t > NOW && t < NOW + SEVEN_DAYS_MS;
}

async function fetchWithRetry(url, params, retries = 2, delayMs = 1500) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { params, timeout: 15000 });
    } catch (err) {
      const isNetworkErr = !err.response; // no HTTP response = network drop
      const isRetryable = isNetworkErr || err.response?.status >= 500;

      if (isRetryable && attempt < retries) {
        console.warn(`[fetchOdds] Network error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delayMs}ms…`);
        await new Promise((r) => setTimeout(r, delayMs));
        delayMs *= 2; // exponential backoff
        continue;
      }
      throw err;
    }
  }
}

async function fetchOddsForSport({ key: sport, label, regions }) {
  const url = `${BASE_URL}/${sport}/odds`;
  const response = await fetchWithRetry(url, {
    apiKey: ODDS_API_KEY,
    regions,
    markets: 'h2h',
    oddsFormat: 'american',
  });

  const remaining = response.headers['x-requests-remaining'];
  const games = response.data;

  // Filter to games within the next 7 days only
  const upcoming = games.filter((g) => isWithinWindow(g.commence_time));

  const parsed = upcoming.map((game) => {
    const bookmakers = game.bookmakers
      .filter((b) => TARGET_BOOKS.includes(b.key))
      .map((b) => ({
        name: b.title,
        key: b.key,
        outcomes: b.markets[0]?.outcomes?.map((o) => ({
          team: o.name,
          price: o.price,
        })) ?? [],
      }));

    return {
      game_id: game.id,
      sport,
      home_team: game.home_team,
      away_team: game.away_team,
      commence_time: game.commence_time,
      bookmakers,
    };
  });

  const skipped = games.length - upcoming.length;
  const skipNote = skipped > 0 ? ` (${skipped} outside 7-day window skipped)` : '';
  console.log(`Sport: ${label} — ${parsed.length} games found${skipNote} | credits left: ${remaining ?? '?'}`);
  return parsed;
}

async function fetchAllOdds() {
  if (!ODDS_API_KEY) {
    console.error('[fetchOdds] ODDS_API_KEY not set — aborting');
    return [];
  }

  // Pre-flight credits check
  try {
    const r = await axios.get(`${BASE_URL}`, {
      params: { apiKey: ODDS_API_KEY },
      timeout: 10000,
    });
    const remaining = Number(r.headers['x-requests-remaining'] ?? 999);
    console.log(`[fetchOdds] API credits remaining: ${remaining}`);
    if (remaining < 10) {
      console.warn('[fetchOdds] Credits critically low (<10) — skipping all fetches this run');
      return [];
    }
  } catch (err) {
    console.warn('[fetchOdds] Could not check credits:', err.message, '— continuing anyway');
  }

  const allGames = [];

  for (const sport of SPORTS) {
    try {
      const games = await fetchOddsForSport(sport);
      allGames.push(...games);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;

      if (status === 422) {
        // Sport not in season — expected, skip silently
        console.log(`Sport: ${sport.label} — not in season, skipped`);
      } else if (status === 401 || status === 403) {
        console.error(`[fetchOdds] Auth error for ${sport.label} (HTTP ${status}): ${msg}`);
      } else if (!err.response) {
        // Network-level failure after retries exhausted
        console.warn(`[fetchOdds] ${sport.label} skipped — network error after retries (${err.message}). Will retry next run.`);
      } else {
        console.error(`[fetchOdds] Error fetching ${sport.label} (HTTP ${status ?? 'N/A'}): ${msg}`);
      }
    }
  }

  console.log(`\nTotal games in 7-day window: ${allGames.length}`);
  return allGames;
}

if (require.main === module) {
  fetchAllOdds()
    .then((games) => {
      if (games.length > 0) {
        console.log('\nSample game:');
        console.log(JSON.stringify(games[0], null, 2));
      }
    })
    .catch((err) => console.error('[fetchOdds] Fatal:', err.message));
}

module.exports = { fetchAllOdds };
