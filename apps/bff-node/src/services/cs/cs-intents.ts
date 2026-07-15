// 快捷选项意图:用户点选项 → 存库/展示 userText,并给模型附加定向指令(hint 不入库)
export interface CsIntent {
  userText: string
  hint: string
}

export const CS_INTENTS: Record<string, CsIntent> = {
  deposit_not_credited: {
    userText: 'My deposit has not been credited yet.',
    hint: 'User tapped the quick option "Deposit not credited". Call get_recent_orders first, then answer based on the latest deposit order\'s "state": if success, tell them it is already credited (with amount and time); if pending, tell them it is still processing. Escalate ONLY when "needsHumanReview" is true. Never tell the user a success order has not arrived.',
  },
  withdrawal_status: {
    userText: 'I want to check my withdrawal status.',
    hint: 'User tapped the quick option "Withdrawal status". Call get_recent_orders first and report the latest withdrawal order based on its "state": success = completed, pending = still processing, failed = show reject_reason. Escalate ONLY when "needsHumanReview" is true. If there is no withdrawal order, say so and offer help on how to withdraw.',
  },
  cannot_withdraw: {
    userText: 'Why can I not withdraw?',
    hint: 'User tapped the quick option "Why can\'t I withdraw". Check in this order: 1) get_user_info for KYC status, 2) get_turnover_status for remaining wagering requirement, 3) get_recent_orders for pending/rejected withdrawals. Give the specific blocking reason with exact numbers, not a generic list.',
  },
  kyc_help: {
    userText: 'I need help with KYC verification.',
    hint: 'User tapped the quick option "KYC verification". Call get_user_info first. If kycStatus is not_submitted, explain the two steps (phone OTP, then ID + face photo). If rejected, tell them to check the rejection reason on the KYC page and how to fix common issues. If approved, confirm it.',
  },
  promotions: {
    userText: 'What promotions are available?',
    hint: 'User tapped the quick option "Bonuses & promotions". Call get_active_promotions and describe the current promotions with their real numbers. Direct them to the Promotions and Cashback pages for details.',
  },
  game_issue: {
    userText: 'I have a problem with a game.',
    hint: 'User tapped the quick option "Games". Ask which game and what happened (won\'t load / crashed / settlement question / can\'t find it). Use search_games to check the game\'s availability and maintenance status, and search_faq keyword "game" for troubleshooting steps.',
  },
  account_issue: {
    userText: 'I have an account or login problem.',
    hint: 'User tapped the quick option "Account & login". Ask what the issue is. Use search_faq keyword "account". For frozen/banned accounts or suspected account theft, escalate to a human agent.',
  },
  human_agent: {
    userText: 'I want to talk to a human agent.',
    hint: 'User tapped the quick option "Talk to a human agent". Call escalate_to_human immediately with reason "user_request". Do not try to resolve it yourself first.',
  },
  deposit_amount_wrong: {
    userText: 'My deposit amount looks wrong.',
    hint: 'User selected Deposit issues > Deposit amount is wrong. Check recent deposits first. Explain credited amount, currency, channel and status. If the data cannot explain the mismatch, ask for payment screenshot, paid amount and order time.',
  },
  deposit_status: {
    userText: 'I want to check my latest deposit status.',
    hint: 'User selected Deposit issues > Check latest deposit status. Check recent deposits and answer from the latest order state.',
  },
  deposit_method_limit: {
    userText: 'I want to know deposit methods or minimum amount.',
    hint: 'User selected Deposit issues > Deposit methods or minimum amount. Explain supported deposit methods and tell the user to open Wallet > Deposit for live channel availability and exact limits.',
  },
  withdrawal_rejected: {
    userText: 'My withdrawal failed or was rejected.',
    hint: 'User selected Withdrawal issues > Withdrawal failed or rejected. Check recent withdrawals and explain the latest rejection reason if available.',
  },
  withdrawal_amount_wrong: {
    userText: 'My withdrawal amount looks wrong.',
    hint: 'User selected Withdrawal issues > Withdrawal amount is wrong. Check recent withdrawals and explain amount, status and any reject reason. Ask for order id if needed.',
  },
  withdrawal_arrival_time: {
    userText: 'I want to know withdrawal arrival time.',
    hint: 'User selected Withdrawal issues > Withdrawal arrival time. Check latest withdrawal state and explain normal processing time.',
  },
  cannot_withdraw_kyc: {
    userText: 'I cannot withdraw because of KYC.',
    hint: 'User selected Cannot withdraw > KYC not approved. Check KYC status first and explain the exact next step.',
  },
  cannot_withdraw_turnover: {
    userText: 'I cannot withdraw because of wagering requirements.',
    hint: 'User selected Cannot withdraw > Wagering requirement issue. Check turnover status and explain remaining amount.',
  },
  cannot_withdraw_pending: {
    userText: 'I cannot withdraw because I may have a pending withdrawal.',
    hint: 'User selected Cannot withdraw > Pending withdrawal issue. Check recent withdrawals and explain whether a pending order blocks another withdrawal.',
  },
  kyc_phone_issue: {
    userText: 'I have a phone verification issue for KYC.',
    hint: 'User selected KYC verification > Phone verification issue. Check KYC status, then give concise phone OTP troubleshooting steps.',
  },
  kyc_document_issue: {
    userText: 'I have an ID upload issue for KYC.',
    hint: 'User selected KYC verification > ID upload issue. Check KYC status and explain document upload requirements: clear valid ID, all corners visible, no glare, matching name.',
  },
  kyc_face_issue: {
    userText: 'I have a face verification issue for KYC.',
    hint: 'User selected KYC verification > Face verification issue. Check KYC status and explain face verification requirements: good lighting, face centered, follow liveness actions.',
  },
  kyc_rejected_reason: {
    userText: 'I want to know why my KYC was rejected.',
    hint: 'User selected KYC verification > KYC rejected reason. Check KYC reject reason and explain how to fix it.',
  },
  promo_first_deposit: {
    userText: 'I want to know about the first deposit bonus.',
    hint: 'User selected Bonuses & promotions > First deposit bonus. Use current promotion configuration and explain eligibility, bonus tiers and wagering.',
  },
  promo_trial: {
    userText: 'I want to know about the free trial bonus.',
    hint: 'User selected Bonuses & promotions > Free trial bonus. Use current promotion configuration and explain eligibility and wagering.',
  },
  promo_reward_missing: {
    userText: 'My promotion reward is missing.',
    hint: 'User selected Bonuses & promotions > Promotion reward missing. Ask which promotion and check available account/order context. Explain likely eligibility, claim status and wagering constraints.',
  },
  promo_rules: {
    userText: 'I want to understand promotion rules.',
    hint: 'User selected Bonuses & promotions > Promotion rules. Use current promotion configuration and summarize key rules clearly.',
  },
  game_cannot_open: {
    userText: 'A game will not open.',
    hint: 'User selected Game issues > Game will not open. Ask for game name and provider, then suggest refresh/reopen and check maintenance if a game name is provided.',
  },
  game_crashed: {
    userText: 'A game crashed or froze.',
    hint: 'User selected Game issues > Game crashed or froze. Ask for game name, time and what happened. Tell user to keep screenshots if funds or settlement are affected.',
  },
  game_settlement_issue: {
    userText: 'I have a bet settlement issue.',
    hint: 'User selected Game issues > Bet settlement issue. Ask for game name, bet time, round id/order id and expected result. Escalate if money dispute details are provided.',
  },
  game_missing: {
    userText: 'I cannot find a game.',
    hint: 'User selected Game issues > Cannot find a game. Ask for game name/provider and use search_games if provided.',
  },
  game_maintenance: {
    userText: 'I want to know if a game is under maintenance.',
    hint: 'User selected Game issues > Game maintenance. Ask for game name/provider and use search_games if provided.',
  },
  account_login_issue: {
    userText: 'I cannot log in.',
    hint: 'User selected Account & login > Cannot log in. Give concise login troubleshooting steps and ask which login method failed.',
  },
  account_frozen: {
    userText: 'My account is frozen.',
    hint: 'User selected Account & login > Account frozen. Escalate to a human agent with reason account_security.',
  },
  account_bind_issue: {
    userText: 'I have a binding issue with Telegram, Google or phone.',
    hint: 'User selected Account & login > Binding Telegram / Google / phone. Ask which method and what error appears.',
  },
  account_security: {
    userText: 'I suspect my account was stolen.',
    hint: 'User selected Account & login > Suspected account theft. Escalate to a human agent with reason account_security immediately.',
  },
  human_complaint: {
    userText: 'I have a complaint or refund request.',
    hint: 'User selected Talk to a human agent > Complaint or refund. Escalate to a human agent with reason complaint immediately.',
  },
  human_money_dispute: {
    userText: 'I have a money dispute.',
    hint: 'User selected Talk to a human agent > Money dispute. Escalate to a human agent with reason money_dispute immediately.',
  },
  human_account_security: {
    userText: 'I have an urgent account security issue.',
    hint: 'User selected Talk to a human agent > Urgent account security. Escalate to a human agent with reason account_security immediately.',
  },
  cashback_turnover_missing: {
    userText: 'My cash rebate turnover is missing bets.',
    hint: 'User selected Cashback / Cash rebate > Rebate turnover issue > Bets not counted. Explain cash rebate is based on eligible betting turnover. Ask for game name, bet time and bet/order id if account data is insufficient.',
  },
  cashback_game_category: {
    userText: 'A game category was not counted for cash rebate.',
    hint: 'User selected Cashback / Cash rebate > Rebate turnover issue > Game category not counted. Explain eligible categories and ask for game/provider if needed.',
  },
  cashback_time_range: {
    userText: 'The cash rebate time range looks wrong.',
    hint: 'User selected Cashback / Cash rebate > Rebate turnover issue > Time range looks wrong. Explain settlement/statistics window and ask for bet time/timezone details.',
  },
  cashback_currency: {
    userText: 'My cash rebate multi-currency amount looks wrong.',
    hint: 'User selected Cashback / Cash rebate > Rebate turnover issue > Multi-currency amount issue. Explain currency-specific calculation and ask which currency is affected.',
  },
  cashback_amount_wrong: {
    userText: 'My cash rebate amount is wrong.',
    hint: 'User selected Cashback / Cash rebate > Cash rebate amount is wrong. Compare eligible turnover, rebate rate and settlement window conceptually. Ask for expected amount and affected date.',
  },
  cashback_not_received: {
    userText: 'My cash rebate was not received.',
    hint: 'User selected Cashback / Cash rebate > Cash rebate not received. Explain possible settlement timing and eligibility. Ask for date and expected rebate.',
  },
  cashback_rate_wrong: {
    userText: 'My cash rebate rate is wrong.',
    hint: 'User selected Cashback / Cash rebate > Cash rebate rate is wrong. Explain rate depends on configured rebate/VIP/game category rules and ask for category/date.',
  },
  cashback_rules: {
    userText: 'I want to understand cash rebate rules.',
    hint: 'User selected Cashback / Cash rebate > Cash rebate rules. Explain wash code/cash rebate rules clearly and distinguish it from loss rebate.',
  },
  loss_rebate_net_loss_wrong: {
    userText: 'My loss rebate net loss amount is wrong.',
    hint: 'User selected Loss rebate > Loss rebate amount issue > Net loss amount is wrong. Explain loss rebate uses eligible net loss in the settlement period, not total bets. Ask for affected date.',
  },
  loss_rebate_deposit_threshold: {
    userText: 'I may not meet the loss rebate deposit threshold.',
    hint: 'User selected Loss rebate > Loss rebate amount issue > Deposit threshold issue. Explain deposit threshold and window from loss rebate rules.',
  },
  loss_rebate_category: {
    userText: 'A game category was not eligible for loss rebate.',
    hint: 'User selected Loss rebate > Loss rebate amount issue > Game category not eligible. Explain eligible categories from loss rebate rules and ask for game/provider.',
  },
  loss_rebate_period: {
    userText: 'The loss rebate settlement period looks wrong.',
    hint: 'User selected Loss rebate > Loss rebate amount issue > Settlement period issue. Explain settlement window and ask for date/time details.',
  },
  loss_rebate_not_received: {
    userText: 'My loss rebate was not received.',
    hint: 'User selected Loss rebate > Loss rebate not received. Explain eligibility, settlement time and ask for affected date.',
  },
  loss_rebate_eligibility: {
    userText: 'I want to know if I am eligible for loss rebate.',
    hint: 'User selected Loss rebate > Am I eligible. Explain eligibility based on configured loss rebate rules.',
  },
  loss_rebate_time: {
    userText: 'I want to know loss rebate settlement time.',
    hint: 'User selected Loss rebate > Settlement time. Explain configured settlement time and that completed settlement depends on eligibility.',
  },
  loss_rebate_rules: {
    userText: 'I want to understand loss rebate rules.',
    hint: 'User selected Loss rebate > Loss rebate rules. Explain loss rebate rules and distinguish it from cash rebate.',
  },
  vip_level_status: {
    userText: 'I want to check my VIP level.',
    hint: 'User selected VIP system > Check my VIP level. Explain current VIP level/progress if tools or context provide it; otherwise ask user to open VIP page for live level and offer to help with specific mismatch.',
  },
  vip_not_upgraded: {
    userText: 'Why did my VIP level not upgrade?',
    hint: 'User selected VIP system > Why did I not upgrade. Explain VIP upgrade depends on eligible turnover/growth and ask for currency/date if data is missing.',
  },
  vip_growth_wrong: {
    userText: 'My VIP growth or turnover looks wrong.',
    hint: 'User selected VIP system > VIP growth / turnover issue. Ask for date, currency and expected amount. Explain eligible turnover/growth rules.',
  },
  vip_reward_missing: {
    userText: 'My VIP reward is missing.',
    hint: 'User selected VIP system > VIP reward missing. Ask which VIP reward and expected date, then explain eligibility and claim timing.',
  },
  vip_benefits: {
    userText: 'I want to understand VIP benefits.',
    hint: 'User selected VIP system > VIP benefits. Explain VIP benefits at a high level and direct user to VIP page for live level-specific details.',
  },
  vip_retention: {
    userText: 'I want to understand VIP retention or downgrade.',
    hint: 'User selected VIP system > VIP retention / downgrade. Explain retention/downgrade depends on period turnover/growth and ask for affected period.',
  },
  task_status: {
    userText: 'I want to check my task status.',
    hint: 'User selected Task system > Check task status. Explain task status if tools/context provide it; otherwise ask user to open Tasks page and name the task.',
  },
  task_not_approved: {
    userText: 'My task was completed but not approved.',
    hint: 'User selected Task system > Task completed but not approved. Ask which task, platform and completion time. Explain verification may require membership/code/manual review.',
  },
  task_reward_missing: {
    userText: 'My task reward is missing.',
    hint: 'User selected Task system > Task reward missing. Ask which task and completion time; explain reward may require approval before crediting.',
  },
  task_social_verify_failed: {
    userText: 'Channel or community verification failed.',
    hint: 'User selected Task system > Channel / community verification failed. Ask which platform: Telegram, Facebook or Viber. Explain account membership/visibility/code requirements.',
  },
  task_code_failed: {
    userText: 'Task code verification failed.',
    hint: 'User selected Task system > Code verification failed. Ask which task and code source, then explain common code mismatch/expiry issues.',
  },
  task_rules: {
    userText: 'I want to understand task rules.',
    hint: 'User selected Task system > Task rules. Explain task rules at a high level: complete required action, verify membership/code, claim reward after approval.',
  },
}

export const CS_WELCOME_SETTING_KEY = 'cs_welcome_text'

export const DEFAULT_WELCOME =
  "Hi! I'm Kaya, BetoGo's AI assistant. I can check your deposits, withdrawals, KYC status and more in real time. Pick a topic below or just type your question. 👋"
