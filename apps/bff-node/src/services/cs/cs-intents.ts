// 快捷选项意图:用户点选项 → 存库/展示 userText,并给模型附加定向指令(hint 不入库)
export interface CsIntent {
  userText: string
  hint: string
}

export const CS_INTENTS: Record<string, CsIntent> = {
  deposit_not_credited: {
    userText: 'My deposit has not been credited yet.',
    hint: 'User tapped the quick option "Deposit not credited". Call get_recent_orders first, then answer based on the latest deposit order: report its status and time. If an order is paid/pending for over 30 minutes, apologize and escalate to a human agent with the order id.',
  },
  withdrawal_status: {
    userText: 'I want to check my withdrawal status.',
    hint: 'User tapped the quick option "Withdrawal status". Call get_recent_orders first and report the latest withdrawal order: status, time, and reject_reason if rejected. If there is no withdrawal order, say so and offer help on how to withdraw.',
  },
  cannot_withdraw: {
    userText: 'Why can I not withdraw?',
    hint: 'User tapped the quick option "Why can\'t I withdraw". Check in this order: 1) get_user_info for KYC status, 2) get_recent_orders for pending/rejected withdrawals, 3) search_faq with keyword "withdraw". Give the specific blocking reason, not a generic list.',
  },
  kyc_help: {
    userText: 'I need help with KYC verification.',
    hint: 'User tapped the quick option "KYC verification". Call get_user_info first. If kycStatus is not_submitted, explain the two steps (phone OTP, then ID + face photo). If rejected, tell them to check the rejection reason on the KYC page and how to fix common issues. If approved, confirm it.',
  },
  promotions: {
    userText: 'What promotions are available?',
    hint: 'User tapped the quick option "Bonuses & promotions". Call search_faq with keyword "bonus" and describe current promotions. Direct them to the promotions and cashback pages for details.',
  },
  game_issue: {
    userText: 'I have a problem with a game.',
    hint: 'User tapped the quick option "Games". Ask which game and what happened (won\'t load / crashed / settlement question). Use search_faq keyword "game" for troubleshooting steps.',
  },
  account_issue: {
    userText: 'I have an account or login problem.',
    hint: 'User tapped the quick option "Account & login". Ask what the issue is. Use search_faq keyword "account". For frozen/banned accounts or suspected account theft, escalate to a human agent.',
  },
  human_agent: {
    userText: 'I want to talk to a human agent.',
    hint: 'User tapped the quick option "Talk to a human agent". Call escalate_to_human immediately with reason "user_request". Do not try to resolve it yourself first.',
  },
}

export const CS_WELCOME_SETTING_KEY = 'cs_welcome_text'

export const DEFAULT_WELCOME =
  "Hi! I'm Kaya, BetoGo's AI assistant. I can check your deposits, withdrawals, KYC status and more in real time. Pick a topic below or just type your question. 👋"
