/** 游戏商全称 → 行业通用简称（2-4 字母） */
const SHORT_NAMES: Record<string, string> = {
  'Apparat':        'APP',
  'Belatra Games':  'BEL',
  'BGaming':        'BG',
  'Caleta':         'CAL',
  'Clawbuster':     'CLW',
  'CTInteractive':  'CTi',
  'Endorphina':     'END',
  'Evoplay':        'EVO',
  'FormulaSpin':    'FSP',
  'FunkyGames':     'FUN',
  'Hacksawgaming':  'HSW',
  'Igrosoft':       'IGS',
  'JDB':            'JDB',
  'JiliGames':      'JILI',
  'KAGaming':       'KA',
  'Kalamba':        'KLB',
  'No Limit City':  'NLC',
  'PeterAndSons':   'P&S',
  'Platipus':       'PLT',
  'PlayHub':        'PHB',
  'PlayNGo':        'PNG',
  'PragmaticPlay':  'PP',
  'Relax Gaming':   'RLX',
  'Rich88':         'R88',
  'Rollback Test':  'TEST',
  'Slotopia':       'STP',
  'SmartSoft':      'SMS',
  'Spribe':         'SPB',
  'Thunderkick':    'TK',
  'Vivogaming':     'VIVO',
}

export function shortProviderName(provider: string): string {
  return SHORT_NAMES[provider] ?? provider
}
