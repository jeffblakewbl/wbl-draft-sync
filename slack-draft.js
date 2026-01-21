const crypto = require('crypto');

// Team name to abbreviation mapping
const teamNameToAbbrev = {
  'Adelaide Bite': 'ADE',
  'Amsterdam Dragons': 'AMS',
  'California Surfers': 'CAL',
  'Cleveland Spiders': 'CLE',
  'Curacao Blue Wave': 'SPA',
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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const firebaseUrl = process.env.FIREBASE_URL;

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    console.log('Invalid JSON:', event.body);
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Handle Slack URL verification challenge FIRST
  if (payload.type === 'url_verification') {
    console.log('Responding to Slack challenge');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge })
    };
  }

  // Verify signature for all other requests
  if (!verifySlackSignature(event, signingSecret)) {
    console.log('Signature verification failed');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Handle event callbacks
  if (payload.type === 'event_callback') {
    const evt = payload.event;
    
    if (evt.type !== 'message' || evt.subtype || evt.bot_id) {
      return { statusCode: 200, body: 'Ignored' };
    }

    const text = evt.text;
    console.log('Received message:', text);

    const draftInfo = parseDraftMessage(text);
    if (!draftInfo) {
      console.log('Could not parse draft message');
      return { statusCode: 200, body: 'Not a draft message' };
    }

    console.log('Parsed draft info:', draftInfo);

    const teamAbbrev = teamNameToAbbrev[draftInfo.teamName];
    if (!teamAbbrev) {
      console.log('Unknown team:', draftInfo.teamName);
      return { statusCode: 200, body: 'Unknown team' };
    }

    try {
      const battersRes = await fetch(`${firebaseUrl}/draftData/batters.json`);
      const batters = await battersRes.json() || [];
      
      const pitchersRes = await fetch(`${firebaseUrl}/draftData/pitchers.json`);
      const pitchers = await pitchersRes.json() || [];

      const normalizedSearchName = normalizeName(draftInfo.playerName);
      let foundPlayer = null;
      let playerType = null;

      for (const player of batters) {
        if (player && player.Name && normalizeName(player.Name) === normalizedSearchName) {
          foundPlayer = player;
          playerType = 'batters';
          break;
        }
      }

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
      console.error
