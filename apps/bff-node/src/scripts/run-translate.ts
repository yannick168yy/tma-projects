import { loadEnv } from '../config/env.js'
import { translateUntranslatedGames } from '../services/game-translation.service.js'
import { loadGamesCache, refreshHomepageSelection } from '../services/sg-game.service.js'

const env = loadEnv()
console.log('[run-translate] starting...')
const result = await translateUntranslatedGames(env)
console.log('[run-translate] done:', result)
if (result.translated > 0) {
  await loadGamesCache(env)
  await refreshHomepageSelection(env)
  console.log('[run-translate] cache refreshed')
}
process.exit(0)
