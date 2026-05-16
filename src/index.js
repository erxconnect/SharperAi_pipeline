require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const cron = require('node-cron');
const { fetchAllOdds } = require('./fetchOdds');
const { analyzePick } = require('./analyzeWithAI');
const { savePick } = require('./saveToDB');
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
