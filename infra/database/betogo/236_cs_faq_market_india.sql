-- 236: 客服知识库按市场区分，并写入印度市场 FAQ 初稿。
-- 原表只有语言、检索也不过滤语言：印度英文 FAQ 直接加进去会被菲律宾用户搜到，
-- 现有英文 FAQ（如 KYC 要短信验证手机）也不适用于印度。market 为 NULL 表示所有市场通用。
ALTER TABLE `cs_faq`
  ADD COLUMN `market` VARCHAR(2) NULL COMMENT '适用市场 PH/ID/IN；NULL=所有市场通用' AFTER `lang`,
  ADD KEY `idx_market` (`market`);

-- 现有条目按原本服务的市场归属：印尼语 → 印尼；英语、他加禄语是菲律宾站写的 → 菲律宾
UPDATE `cs_faq` SET `market` = 'ID' WHERE `lang` = 'id' AND `market` IS NULL;
UPDATE `cs_faq` SET `market` = 'PH' WHERE `lang` IN ('en', 'tl') AND `market` IS NULL;

-- 印度市场 FAQ（英文）。规则依据：Huitone UPI 充值 / 银行卡代付、印度 KYC 证件清单（kyc.service.ts）、
-- 提现需 KYC + 1 倍流水 + 户名与实名一致。不写具体限额与到账时效，以页面和实际审核为准。
INSERT INTO `cs_faq` (`category`, `question`, `answer`, `lang`, `market`, `sort_order`) VALUES
('deposit', 'How do I deposit with UPI?', 'Open Wallet > Deposit, make sure INR (₹) is selected, choose UPI and enter the amount. The minimum and maximum amount for each deposit are shown on the deposit page. Complete the payment in your UPI app for exactly the amount shown on the order, before the order expires.', 'en', 'IN', 10),
('deposit', 'My UPI deposit has not arrived', 'Please send us the deposit order number and the 12-digit UTR (UPI transaction reference number) from your UPI app or bank SMS. Never share your UPI PIN or OTP. We will check the order with the payment provider. Deposits still pending after 30 minutes are reviewed by our team.', 'en', 'IN', 20),
('deposit', 'Money was debited but my deposit failed', 'Keep the UTR and the deposit order number and contact us. We will check whether the payment reached us. If it did not, a failed UPI debit is normally reversed to your bank account by your bank. Please do not pay the same order again.', 'en', 'IN', 30),
('deposit', 'Can I pay an old or expired deposit order?', 'No. Each deposit order can be paid only once and only before it expires. If an order has expired, create a new deposit order and pay that one instead.', 'en', 'IN', 40),
('withdraw', 'How do I withdraw to my bank account?', 'Complete KYC first. Then open Wallet > Withdraw, choose INR, and enter the account holder name, bank account number, IFSC code and amount. The account holder name must match the name on your verified ID.', 'en', 'IN', 10),
('withdraw', 'What is an IFSC code?', 'IFSC is the 11-character code of your bank branch, for example SBIN0001234: 4 letters for the bank, then the digit 0, then 6 letters or digits for the branch. You can find it on your cheque book, passbook or banking app. A wrong IFSC will make the payout fail.', 'en', 'IN', 20),
('withdraw', 'Why can''t I withdraw?', 'The most common reasons are: 1) KYC is not completed, 2) the wagering (turnover) requirement of your deposits is not met yet, 3) a previous withdrawal is still under review, or 4) the bank account holder name does not match your verified ID.', 'en', 'IN', 30),
('withdraw', 'My withdrawal is still processing', 'Please send us the withdrawal order number. We will check the review and payout status. Processing time depends on security review and the bank, so we cannot promise an exact time before checking.', 'en', 'IN', 40),
('withdraw', 'My withdrawal failed', 'If a bank payout fails, for example because of a wrong account number or IFSC, the amount is returned to your INR balance automatically once the failure is confirmed. Check your bank details and submit a new withdrawal. If the amount has not returned, send us the withdrawal order number.', 'en', 'IN', 50),
('account', 'How do I enter my Indian mobile number?', 'Enter your 10-digit mobile number, for example 98xxxxxxxx, or use the international format +91 98xxxxxxxx. You can also log in with Google or Telegram.', 'en', 'IN', 10),
('account', 'I cannot log in to my account', 'Make sure you use the same login method and mobile number or account you registered with. If you forgot your password, use Forgot Password on the login page. Never share your password or OTP with anyone, including our support team.', 'en', 'IN', 20),
('kyc', 'Which documents are accepted for KYC in India?', 'Passport, driving licence, Aadhaar card or e-Aadhaar, Voter ID (EPIC), NREGA job card, or NPR letter. PAN card is not accepted. For Aadhaar, all 12 digits must be clearly visible; masked Aadhaar is not accepted. You will upload a photo of the document and take a face photo.', 'en', 'IN', 10),
('kyc', 'My KYC was rejected, what do I do?', 'Check the rejection reason on the KYC page. Common causes are a blurry photo, glare, a cropped or expired document, masked Aadhaar digits, an unsupported document such as PAN, or a face photo that does not match. Fix the issue and upload a clear photo of the original document.', 'en', 'IN', 20),
('bonus', 'How are bonuses and rebates calculated in INR?', 'Open the Bonuses, Tasks, Rebate or VIP page to see the INR requirements, periods and your progress. Each programme has its own wagering and claim rules, and the values shown on the page are the ones that apply.', 'en', 'IN', 10),
('game', 'A game will not load or crashed', 'Check your connection, close and reopen the game, or try another network. If it still happens, send us the game name, the time it happened and a screenshot so we can check the round.', 'en', 'IN', 10),
('support_policy', 'India payment issue handling guideline', 'Confirm the user and that the currency is INR. For deposits ask for the order number and the 12-digit UTR; for withdrawals ask for the order number and check whether the account holder name matches the verified ID and whether the IFSC looks valid. Never ask for the UPI PIN, OTP, password or full card number. Escalate for manual checking when the tools cannot confirm the payment.', 'en', 'IN', 10),
('support_policy', 'India KYC privacy guideline', 'Never ask users to type their Aadhaar number or send ID photos in the chat. KYC documents must only be uploaded on the KYC page. If a user sends an ID number or photo in the chat, do not repeat it back and remind them to use the KYC page.', 'en', 'IN', 20);
