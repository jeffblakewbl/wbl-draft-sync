const crypto = require('crypto');

// Team name to abbreviation mapping
const teamNameToAbbrev = {
  'Adelaide Bite': 'ADE',
  'Amsterdam Dragons': 'AMS',
  'California Surfers': 'CAL',
  'Cleveland Spiders': 'CLE',
  'Curacao Blue Wave': 'SPA', // SPA is the old abbreviation still used
  'Denver Blucifers': 'DEN',
  'Dubai Bedouins': 'DUB',
  'Galapagos Shellbacks': 'GAL',
  'Havana Sugar Kings': 'HAV',
  'Honolulu Honu': 'HON',
  'Lappland Boazu': 'LAP',
  'London Red Coats': 'LDN',
  'Longbow Hunters': 'LON',
  'North Korea Outlaws': 'NKO',
  'Rome Centurions': 'RME',
  'Sao Paulo Black Mambas': 'SPA',
  'Sint Maarten Sun Chasers': 'SMT',
  'St. Lucia Mermen': 'STU',
  'Tokyo Tigers': 'TOK',
  'Toronto Huskies': 'TOR',
  'Vancouver Homewreckers': 'VAN'
};

// Verify Slack request signature
function verifySlackSignature(event, signingSecret) {
  const signature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  
  if (!signature || !timestamp) {
    return false;
  }
  
  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }
  
  const sigBasestring = `v0:${timestamp}:${event.body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

// Parse the draft message
// Format: "Round 3, Pick 12 (#56 overall): Denver Blucifers select P Bill Muncey"
function parseDraftMessage(text) {
  const regex = /Round (\d+), Pick (\d+) \(#\d+ overall\): (.+) select ([A-Z]+(?:\/[A-Z]+)?) (.+)/i;
  const match = text.match(regex);
  
  if (!match) {
    return null;
  }
  
  return {
    round: parseInt(match[1]),
    pick: parseInt(match[2]),
    teamName: match[3].trim(),
    position: match[4].trim(),
    playerName: match[5].trim()
  };
}

// Normalize player name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const firebaseUrl = process.env.FIREBASE_URL;

  // Verify signature
  if (!verifySlackSignature(event, signingSecret)) {
    console.log('Signature verification failed');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Handle Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge })
    };
  }

  // Handle event callbacks
  if (payload.type === 'event_callback') {
    const evt = payload.event;
    
    // Only process messages (not bot messages, edits, etc.)
    if (evt.type !== 'message' || evt.subtype || evt.bot_id) {
      return { statusCode: 200, body: 'Ignored' };
    }

    const text = evt.text;
    console.log('Received message:', text);

    // Parse the draft message
    const draftInfo = parseDraftMessage(text);
    if (!draftInfo) {
      console.log('Could not parse draft message');
      return { statusCode: 200, body: 'Not a draft message' };
    }

    console.log('Parsed draft info:', draftInfo);

    // Get team abbreviation
    const teamAbbrev = teamNameToAbbrev[draftInfo.teamName];
    if (!teamAbbrev) {
      console.log('Unknown team:', draftInfo.teamName);
      return { statusCode: 200, body: 'Unknown team' };
    }

    try {
      // Fetch batters from Firebase
      const battersRes = await fetch(`${firebaseUrl}/draftData/batters.json`);
      const batters = await battersRes.json() || [];
      
      // Fetch pitchers from Firebase
      const pitchersRes = await fetch(`${firebaseUrl}/draftData/pitchers.json`);
      const pitchers = await pitchersRes.json() || [];

      // Search for player by name
      const normalizedSearchName = normalizeName(draftInfo.playerName);
      let foundPlayer = null;
      let playerType = null;

      // Search batters
      for (const player of batters) {
        if (player && player.Name && normalizeName(player.Name) === normalizedSearchName) {
          foundPlayer = player;
          playerType = 'batters';
          break;
        }
      }

      // Search pitchers if not found in batters
      if (!foundPlayer) {
        for (const player of pitchers) {
          if (player && player.Name && normalizeName(player.Name) === normalizedSearchName) {
            foundPlayer = player;
            playerType = 'pitchers';
            break;
          }
        }
      }

      if (!foundPlayer || !foundPlayer.ID) {
        console.log('Player not found:', draftInfo.playerName);
        return { statusCode: 200, body: 'Player not found' };
      }

      console.log('Found player:', foundPlayer.Name, 'ID:', foundPlayer.ID);

      // Mark player as drafted in Firebase
      const draftedData = {
        type: playerType,
        round: draftInfo.round,
        pick: draftInfo.pick,
        team: teamAbbrev,
        draftedAt: new Date().toISOString(),
        source: 'slack'
      };

      const updateRes = await fetch(
        `${firebaseUrl}/draftData/draftedPlayerIds/${foundPlayer.ID}.json`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftedData)
        }
      );

      if (updateRes.ok) {
        // Also update the lastUpdated timestamp
        await fetch(
          `${firebaseUrl}/draftData/lastUpdated.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(new Date().toISOString())
          }
        );
        
        console.log('Successfully marked as drafted:', foundPlayer.Name);
        return { statusCode: 200, body: 'Player drafted successfully' };
      } else {
        console.log('Firebase update failed');
        return { statusCode: 500, body: 'Firebase update failed' };
      }

    } catch (error) {
      console.error('Error:', error);
      return { statusCode: 500, body: 'Server error' };
    }
  }

  return { statusCode: 200, body: 'OK' };
};
