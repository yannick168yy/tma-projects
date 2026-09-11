/**
 * 客服会话假语料。
 *
 * cs_message.content 是自由文本，玩家会在里面直接发手机号、银行卡号、
 * 身份证照片的描述 —— 逐字段脱敏对自由文本无效，正则永远追不全。
 * 所以整条替换：按会话 id 确定性地挑一段模板，同一个会话里的消息顺序对得上，
 * 客服工单页面照样能演示，泄露风险是零。
 *
 * 语料按 PH/ID 两个市场的真实咨询场景写，英文为主 —— 与线上客服语言一致。
 */

/** 每段是一轮完整会话：user 与 agent 交替 */
export const SCRIPTS = [
  [
    ['user', 'Hi, my deposit has not arrived yet. It has been 20 minutes.'],
    ['agent', 'Hello! May I have your order number so I can check it for you?'],
    ['user', 'Sure, one moment.'],
    ['agent', 'Thank you. I can see the payment is still pending on the provider side. It usually clears within 30 minutes.'],
    ['agent', 'I have escalated it so it gets priority. You will receive a notification once credited.'],
    ['user', 'Okay thank you.'],
  ],
  [
    ['user', 'Why is my withdrawal still under review?'],
    ['agent', 'Let me check. Your account needs to complete the turnover requirement before withdrawal.'],
    ['user', 'How much more do I need?'],
    ['agent', 'You currently have about 40% remaining on the bonus turnover. Once completed the withdrawal will process automatically.'],
    ['user', 'Got it, thanks for explaining.'],
  ],
  [
    ['user', 'I cannot log in, it says invalid password.'],
    ['agent', 'I can help with that. Have you tried resetting via the Forgot Password option?'],
    ['user', 'Yes but I did not receive the SMS.'],
    ['agent', 'I see the code was sent but not delivered. Let me trigger it again from our side.'],
    ['agent', 'Please check now, it should arrive within a minute.'],
    ['user', 'Received it. Working now.'],
  ],
  [
    ['user', 'Halo, saya mau tanya soal bonus deposit pertama.'],
    ['agent', 'Halo! Bonus deposit pertama sebesar 100% akan otomatis masuk setelah deposit berhasil.'],
    ['user', 'Tapi saya belum terima bonusnya.'],
    ['agent', 'Saya cek dulu ya. Deposit Anda tercatat di bawah minimum untuk bonus tersebut.'],
    ['agent', 'Untuk deposit berikutnya yang memenuhi minimum, bonus akan langsung masuk.'],
  ],
  [
    ['user', 'My KYC was rejected. What was wrong?'],
    ['agent', 'Let me review the submission for you.'],
    ['agent', 'The document photo was too blurry for our system to read the ID number. Please resubmit with better lighting.'],
    ['user', 'Okay I will try again.'],
    ['agent', 'Thank you. Review usually completes within 30 minutes after resubmission.'],
  ],
  [
    ['user', 'How does the rebate work?'],
    ['agent', 'Rebate is calculated daily based on your total valid turnover and credited automatically the next day.'],
    ['user', 'Is there a minimum?'],
    ['agent', 'Yes, there is a small minimum turnover per day. You can see your current progress on the Rebate page.'],
  ],
  [
    ['user', 'I want to change my bound phone number.'],
    ['agent', 'For security, phone changes require identity verification.'],
    ['agent', 'I have started the process. You will receive a verification prompt shortly.'],
    ['user', 'Thanks.'],
  ],
  [
    ['user', 'The game keeps disconnecting in the middle of a round.'],
    ['agent', 'Sorry about that. Does it happen on WiFi, mobile data, or both?'],
    ['user', 'Mostly on mobile data.'],
    ['agent', 'Understood. I have logged this with the provider. Any interrupted round is settled automatically, so your balance is not affected.'],
  ],
  [
    ['user', 'Can I get the referral bonus if my friend registers today?'],
    ['agent', 'Yes. The bonus is credited after your referral completes their first qualifying deposit.'],
    ['user', 'How long does it take?'],
    ['agent', 'Usually within a few minutes of their deposit clearing.'],
  ],
  [
    ['user', 'Saya sudah withdraw tapi belum masuk ke rekening.'],
    ['agent', 'Baik, saya periksa statusnya sekarang.'],
    ['agent', 'Withdraw Anda sudah diproses dan sedang dalam pengiriman oleh bank. Estimasi 1-2 jam kerja.'],
    ['user', 'Oke terima kasih.'],
  ],
  [
    ['user', 'Is there a VIP program?'],
    ['agent', 'Yes! VIP levels are based on accumulated turnover, with weekly salary and birthday bonuses at higher tiers.'],
    ['user', 'What level am I now?'],
    ['agent', 'You can see your current level and progress on the VIP page in your account.'],
  ],
  [
    ['user', 'I think someone else logged into my account.'],
    ['agent', 'That is serious, let me help immediately. I am reviewing the recent login records now.'],
    ['agent', 'I see logins only from your usual device and region. No unfamiliar access.'],
    ['agent', 'I recommend changing your password anyway as a precaution.'],
    ['user', 'Will do, thank you.'],
  ],
  [
    ['user', 'The spin wheel says I have no chances left but I deposited today.'],
    ['agent', 'Spin chances are granted per qualifying deposit tier. Let me check yours.'],
    ['agent', 'Your deposit qualified for one chance and it was already used earlier today.'],
    ['user', 'Ah right, I forgot. Thanks.'],
  ],
  [
    ['user', 'Do you support GCash?'],
    ['agent', 'Yes, GCash is available for both deposit and withdrawal.'],
    ['user', 'What are the limits?'],
    ['agent', 'You can see the current min and max on the deposit page, they vary by channel.'],
  ],
  [
    ['user', 'My bet was settled as a loss but I think I won.'],
    ['agent', 'Let me pull up that round for you.'],
    ['agent', 'I checked the round detail with the provider. The settlement matches the game result on their side.'],
    ['agent', 'I can share the round reference if you would like to review it.'],
    ['user', 'No its fine, thanks for checking.'],
  ],
]

/**
 * 按会话 id 挑模板、按消息在会话内的序号取那一句。
 * 消息比模板长时循环取 —— 长会话会重复几句，但角色与语气始终对得上。
 */
export function messageFor(conversationSeed, indexInConversation, role) {
  const script = SCRIPTS[conversationSeed % SCRIPTS.length]
  const sameRole = script.filter(([r]) => r === (role === 'user' ? 'user' : 'agent'))
  if (sameRole.length === 0) return script[indexInConversation % script.length][1]
  return sameRole[indexInConversation % sameRole.length][1]
}
