require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const cron = require('node-cron');
const { fetchAllOdds, fetchPlayerProps } = require('./fetchOdds');
const { analyzePick } = require('./analyzeWithAI');
const { analyzeProp } = require('./analyzeProps');
const { savePick, saveProps } = require('./saveToDB');
const { updateResults } = require('./updateResults');

async function runPipeline() {
  const timestamp = new Date().toISOString();
  console.log(`\n========================================`);
  console.log(`[Pipeline] Run started at ${timestamp}`);
  console.log(`========================================`);

  try {
    const games = await fetchAllOdds();

    if (games.length === 0) {
      console.log('[Pipeline] No games available at this time.');
      return;
    }

    console.log(`[Pipeline] Analyzing ${games.length} game(s) with AI...`);

    for (const game of games) {
      try {
        const pickData = await analyzePick(game);
        await savePick(pickData);
      } catch (err) {
        console.error(
          `[Pipeline] Error processing ${game.away_team} @ ${game.home_team}: ${err.message}`
        );
      }
    }

    // ── Player props pipeline ──────────────────────────────────
    console.log('\n[Pipeline] Running player props pipeline...');
    const PROPS_SPORTS = ['baseball_mlb', 'basketball_nba'];
    let propsSaved = 0;

    for (const sport of PROPS_SPORTS) {
      try {
        const propsGames = await fetchPlayerProps(sport);

        for (const game of propsGames) {
          for (const book of game.props) {
            for (const market of book.markets ?? []) {
              // Build over/under lookup once per market
              const overOdds  = market.outcomes?.find((o) => o.name === 'Over')?.price ?? null;
              const underOdds = market.outcomes?.find((o) => o.name === 'Under')?.price ?? null;

              for (const outcome of market.outcomes ?? []) {
                // Only process player outcomes (skip generic Over/Under entries without a player)
                if (!outcome.description) continue;

                try {
                  const analysis = await analyzeProp({
                    player_name: outcome.description,
                    prop_type:   market.key,
                    line:        outcome.point ?? null,
                    over_odds:   overOdds,
                    under_odds:  underOdds,
                    sport,
                    matchup: `${game.away_team} @ ${game.home_team}`,
                  });

                  if (analysis && analysis.recommendation !== 'SKIP') {
                    await saveProps({
                      game_id:        game.game_id,
                      sport,
                      home_team:      game.home_team,
                      away_team:      game.away_team,
                      player_name:    outcome.description,
                      prop_type:      market.key,
                      line:           outcome.point ?? null,
                      over_odds:      overOdds,
                      under_odds:     underOdds,
                      best_book:      book.key,
                      ai_pick:        analysis.pick,
                      ai_confidence:  analysis.confidence,
                      ai_reason:      analysis.reason,
                      edge:           analysis.edge ?? null,
                      recommendation: analysis.recommendation,
                      game_time:      game.commence_time,
                    });
                    propsSaved++;
                  }
                } catch (propErr) {
                  console.warn(`[Pipeline] Props error (${outcome.description}): ${propErr.message}`);
                }
              }
            }
          }
        }
      } catch (sportErr) {
        console.error(`[Pipeline] Props pipeline error for ${sport}: ${sportErr.message}`);
      }
    }

    console.log(`[Pipeline] Props pipeline complete — ${propsSaved} props saved.`);
    // ──────────────────────────────────────────────────────────

    // Also check and update any past results
    await updateResults();

    console.log(`[Pipeline] Run complete.`);
  } catch (err) {
    console.error('[Pipeline] Fatal error:', err.message);
  }
}

// Run immediately on start
runPipeline();

// Schedule every 6 hours: at minute 0 of hours 0, 6, 12, 18
cron.schedule('0 */6 * * *', () => {
  runPipeline();
});

console.log('[Pipeline] Scheduler active — will re-run every 6 hours.');
