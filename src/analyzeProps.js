require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROP_LABELS = {
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  pitcher_strikeouts: 'Strikeouts',
  batter_rbis: 'RBIs',
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers',
  player_pass_tds: 'Pass TDs',
  player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards',
};

async function analyzeProp({ player_name, prop_type, line, over_odds, under_odds, sport, matchup }) {
  const propLabel = PROP_LABELS[prop_type] ?? prop_type;

  const prompt = `Analyze this player prop bet:

Player: ${player_name}
Prop: ${propLabel} (${prop_type})
Line: ${line}
Over odds: ${over_odds ?? 'N/A'}
Under odds: ${under_odds ?? 'N/A'}
Sport: ${sport}
Game: ${matchup}

Respond ONLY in valid JSON — no markdown, no explanation:
{
  "pick": "OVER",
  "confidence": 68,
  "reason": "One specific stat-based reason under 15 words",
  "edge": 4.5,
  "recommendation": "LEAN"
}

pick must be "OVER" or "UNDER".
confidence must be 50-95.
recommendation must be "STRONG" (confidence >= 72), "LEAN" (60-71), or "SKIP" (< 60).
edge is the % edge over bookmaker implied probability (can be negative).`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are an expert sports betting analyst specializing in player props.
Only recommend when you have genuine statistical confidence.
Respond ONLY in valid JSON — no markdown fences, no extra text.`,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(clean);

    // Validate required fields
    if (!parsed.pick || !['OVER', 'UNDER'].includes(parsed.pick)) return null;
    if (typeof parsed.confidence !== 'number') return null;
    if (!['STRONG', 'LEAN', 'SKIP'].includes(parsed.recommendation)) return null;

    return parsed;
  } catch (e) {
    console.warn(`[analyzeProps] Parse error for ${player_name} ${prop_type}: ${e.message}`);
    return null;
  }
}

module.exports = { analyzeProp };
