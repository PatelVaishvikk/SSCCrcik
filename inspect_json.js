
const fs = require('fs');
const filename = 'c:/Users/vaish/Downloads/middleProj/data_678708/atmiya_cricket_tournament_2023_678708_FULL.json';

try {
  const raw = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(raw);
  
  if (data.tabs) {
    if (data.tabs.leaderboards) {
        console.log('--- LEADERBOARDS ---');
        if (data.tabs.leaderboards.batting) {
            console.log('Batting entries:', data.tabs.leaderboards.batting.length);
            console.log('Sample batting:', JSON.stringify(data.tabs.leaderboards.batting[0], null, 2));
        }
        if (data.tabs.leaderboards.bowling) {
            console.log('Bowling entries:', data.tabs.leaderboards.bowling.length);
        }
    }
    
    if (data.tabs.stats_overview && data.tabs.stats_overview.pageProps) {
        console.log('--- PAGE PROPS ---');
        console.log('pageProps keys:', Object.keys(data.tabs.stats_overview.pageProps));
        // Check for deeper stats
    }
    
    if (data.players_database) {
        console.log('--- PLAYERS DB ---');
        console.log('Is array?', Array.isArray(data.players_database));
        console.log('Keys:', Object.keys(data.players_database));
    }
  }
} catch (e) {
  console.error(e);
}
