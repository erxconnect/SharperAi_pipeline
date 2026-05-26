require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert sports betting analyst specializing in value bet detection.
Your job is to find edges where the true probability of a team winning exceeds what the bookmakers are implying through their odds.

You will be given a game with odds from multiple bookmakers. For each game:
1. Estimate the TRUE win probability for each team based on form, matchup, and market signals
2. Compare your estimate to the bookmaker implied probability
3. Calculate edge = your_probability - bookmaker_implied_prob
4. A value bet exists when edge > 0.03 (3%+)

Respond ONLY in valid JSON, no extra text:
{
  "pick": "TEAM_NAME",
  "confidence": 70,
  "home_probability": 45,
  "away_probability": 55,
  "our_probability": 0.55,
  "bookmaker_implied_prob": 0.49,
  "edge": 0.06,
  "is_value_bet": true,
  "best_odds": -115,
  "best_bookmaker": "DraftKings",
  "reason_line1": "specific stat, form, or matchup edge",
  "reason_line2": "odds/market inefficiency or value explanation",
  "bet_type": "moneyline",
  "recommendation": "STRONG"
}

For FIFA World Cup matches, consider:
- Home advantage for host nations (USA, Mexico, Canada)
- Historical World Cup performance and tournament experience
- Group stage dynamics (must-win vs dead rubber matches)
- Travel between venues and climate differences between cities
- Squad depth for tournament football (rotation, fatigue)
- Manager tournament experience and tactical setup

Rules:
- home_probability + away_probability must equal 100 (integers)
- home_probability = your estimated chance the HOME team wins
- away_probability = your estimated chance the AWAY team wins
- our_probability is a decimal (0-1) for the PICKED team
- bookmaker_implied_prob is a decimal (0-1) for the PICKED team
- edge = our_probability - bookmaker_implied_prob (decimal)
- recommendation: STRONG (edge >= 0.05), LEAN (edge 0.01-0.05), SKIP (no edge)
- confidence is 0-100 representing certainty in the pick`;

function americanToImplied(american) {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function formatGamePrompt(gameData) {
  const lines = [
    `Sport: ${gameData.sport}`,
    `Game: ${gameData.away_team} (AWAY) @ ${gameData.home_team} (HOME)`,
    `Start Time: ${gameData.commence_time}`,
    '',
    'Odds by bookmaker:',
  ];

  const bestOddsMap = {};

  for (const book of gameData.bookmakers) {
    lines.push(`  ${book.name}:`);
    for (const outcome of book.outcomes) {
      const sign = outcome.price > 0 ? '+' : '';
      const implied = (americanToImplied(outcome.price) * 100).toFixed(1);
      lines.push(`    ${outcome.team}: ${sign}${outcome.price} (implied ${implied}%)`);

      if (!bestOddsMap[outcome.team] || outcome.price > bestOddsMap[outcome.team].price) {
        bestOddsMap[outcome.team] = { price: outcome.price, book: book.name };
      }
    }
  }

  lines.push('', 'Best available odds:');
  for (const [team, info] of Object.entries(bestOddsMap)) {
    const sign = info.price > 0 ? '+' : '';
    const implied = (americanToImplied(info.price) * 100).toFixed(1);
    lines.push(`  ${team}: ${sign}${info.price} @ ${info.book} (implied ${implied}%)`);
  }

  return lines.join('\n');
}

async function analyzePick(gameData) {
  const userPrompt = formatGamePrompt(gameData);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 650,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0].text.trim();
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const pick = JSON.parse(jsonText);

  return {
    sport: gameData.sport,
    home_team: gameData.home_team,
    away_team: gameData.away_team,
    game_time: gameData.commence_time,
    pick: pick.pick,
    confidence: pick.confidence,
    home_probability: pick.home_probability ?? null,
    away_probability: pick.away_probability ?? null,
    our_probability: pick.our_probability,
    bookmaker_implied_prob: pick.bookmaker_implied_prob,
    edge: pick.edge,
    is_value_bet: pick.is_value_bet ?? false,
    best_odds: pick.best_odds,
    best_bookmaker: pick.best_bookmaker,
    reason_line1: pick.reason_line1,
    reason_line2: pick.reason_line2,
    bet_type: pick.bet_type,
    recommendation: pick.recommendation ?? 'LEAN',
  };
}

module.exports = { analyzePick };
