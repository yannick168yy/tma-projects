/** 游戏商全称 → 通用简称映射 */
const SHORT_NAMES: Record<string, string> = {
  'Apparat':        'Apparat',
  'Belatra Games':  'Belatra',
  'BGaming':        'BGaming',
  'Caleta':         'Caleta',
  'Clawbuster':     'Clawbuster',
  'CTInteractive':  'CT Interactive',
  'Endorphina':     'Endorphina',
  'Evoplay':        'Evoplay',
  'FormulaSpin':    'FormulaSpin',
  'FunkyGames':     'Funky Games',
  'Hacksawgaming':  'Hacksaw',
  'Igrosoft':       'Igrosoft',
  'JDB':            'JDB',
  'JiliGames':      'JILI',
  'KAGaming':       'KA Gaming',
  'Kalamba':        'Kalamba',
  'No Limit City':  'NLC',
  'PeterAndSons':   'Peter & Sons',
  'Platipus':       'Platipus',
  'PlayHub':        'PlayHub',
  'PlayNGo':        "Play'n GO",
  'PragmaticPlay':  'Pragmatic',
  'Relax Gaming':   'Relax',
  'Rich88':         'Rich88',
  'Rollback Test':  'Rollback',
  'Slotopia':       'Slotopia',
  'SmartSoft':      'SmartSoft',
  'Spribe':         'Spribe',
  'Thunderkick':    'Thunderkick',
  'Vivogaming':     'Vivo Gaming',
}

export function shortProviderName(provider: string): string {
  return SHORT_NAMES[provider] ?? provider
}
