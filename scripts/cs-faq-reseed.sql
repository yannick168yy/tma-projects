-- cs_faq 重灌脚本 —— ⚠️ 手动执行,不进自动迁移
-- 背景:012 迁移的中文种子数据入库时字符集错误,全部变成 ?????,不可恢复。
-- 本脚本清空后重灌英语(en)+塔加洛语(tl)双语 FAQ,内容按 2026-07 当前业务重写。
-- 执行方式:
--   scp 到服务器后:
--   podman exec -i tma-mysql mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" betogo < cs-faq-reseed.sql
SET NAMES utf8mb4;

DELETE FROM cs_faq;

INSERT INTO cs_faq (category, question, answer, lang, sort_order) VALUES
-- ============ English ============
('deposit', 'How do I deposit?',
 'Go to the Wallet page and tap "Deposit". Choose your amount and pick any payment method shown on the deposit page, then follow the instructions to complete payment. Deposits are usually credited within 5-15 minutes.', 'en', 1),
('deposit', 'My deposit has not arrived yet',
 'Deposits normally arrive within 5-15 minutes after payment. During peak hours it may take up to 30 minutes. If you have paid but the amount is still missing after 30 minutes, please tell me and I will check your order status right away.', 'en', 2),
('deposit', 'What payment methods are available?',
 'All currently available payment methods, amounts and limits are shown on the deposit page in your Wallet. Please open the deposit page to see the latest options.', 'en', 3),
('withdraw', 'How do I withdraw?',
 'Go to the Wallet page and tap "Withdraw", then enter your payout account and amount. Before withdrawing you must: 1) complete KYC verification, and 2) meet the wagering (turnover) requirement. Your request is then reviewed and paid out.', 'en', 1),
('withdraw', 'Why can''t I withdraw?',
 'The most common reasons are: 1) KYC verification not completed yet, 2) wagering (turnover) requirement not met yet, 3) your withdrawal is still under review. Ask me and I can check exactly which one applies to your account.', 'en', 2),
('withdraw', 'How long does a withdrawal take?',
 'After your withdrawal passes review, funds are usually sent out within a few hours. Review time varies. If your withdrawal has been pending for a long time, tell me and I will check its status.', 'en', 3),
('account', 'How do I log in? I forgot my password',
 'You can log in with Telegram, Google, phone number + password, or username + password. You can bind extra login methods in Menu > Account & Login. If you cannot access your account, contact support and we will help verify your identity.', 'en', 1),
('account', 'My account is frozen or banned',
 'Accounts are frozen for security or rule violations. Please contact our human support team with your account details - this type of issue is always handled by a human agent.', 'en', 2),
('kyc', 'What do I need for KYC verification?',
 'KYC has two steps: 1) verify your phone number with an SMS code, 2) upload a photo of your valid government ID and take a face photo. Review is automatic and usually finishes within minutes. You must be 21 or older.', 'en', 1),
('kyc', 'My KYC was rejected, what do I do?',
 'Check the rejection reason shown on the KYC page. Common causes: blurry photos, ID not fully visible, face photo does not match, or under 21 years old. Fix the issue and submit again. Ask me and I can check your current KYC status and reason.', 'en', 2),
('game', 'A game will not load or crashed',
 'Try refreshing the page or re-entering the game, and check your network connection. If a game round was interrupted and you think the settlement is wrong, take a screenshot and contact support with the game name and time.', 'en', 1),
('bonus', 'What promotions are available?',
 'Current promotions include the first deposit bonus, Lucky Spin, and the cashback (rebate) program with levels LV1-LV6 - higher total wagering unlocks higher cashback rates. Check the promotions and cashback pages for details, or ask me about any of them.', 'en', 1),
-- ============ Tagalog ============
('deposit', 'Paano mag-deposit?',
 'Pumunta sa Wallet page at i-tap ang "Deposit". Piliin ang halaga at ang payment method na nakalista sa deposit page, tapos sundan ang instructions para makumpleto ang bayad. Karaniwang pumapasok ang deposito sa loob ng 5-15 minuto.', 'tl', 1),
('deposit', 'Hindi pa pumapasok ang deposito ko',
 'Karaniwang pumapasok ang deposito sa loob ng 5-15 minuto pagkatapos magbayad. Sa peak hours, maaaring umabot ng 30 minuto. Kung nakabayad ka na pero wala pa rin pagkatapos ng 30 minuto, sabihin mo lang at che-checkin ko agad ang status ng order mo.', 'tl', 2),
('deposit', 'Anong mga payment method ang pwede?',
 'Lahat ng available na payment method, halaga at limits ay makikita sa deposit page sa iyong Wallet. Buksan ang deposit page para makita ang pinakabagong options.', 'tl', 3),
('withdraw', 'Paano mag-withdraw?',
 'Pumunta sa Wallet page at i-tap ang "Withdraw", tapos ilagay ang payout account at halaga. Bago mag-withdraw kailangan: 1) kumpletuhin ang KYC verification, at 2) maabot ang wagering (turnover) requirement. Ire-review ang request mo bago i-payout.', 'tl', 1),
('withdraw', 'Bakit hindi ako makapag-withdraw?',
 'Mga karaniwang dahilan: 1) hindi pa tapos ang KYC verification, 2) hindi pa naabot ang wagering (turnover) requirement, 3) nire-review pa ang withdrawal mo. Tanungin mo lang ako at iche-check ko kung alin ang dahilan sa account mo.', 'tl', 2),
('withdraw', 'Gaano katagal ang withdrawal?',
 'Kapag pumasa na sa review ang withdrawal mo, karaniwang naipapadala ang pera sa loob ng ilang oras. Nag-iiba-iba ang review time. Kung matagal nang naka-pending ang withdrawal mo, sabihin mo lang at iche-check ko ang status.', 'tl', 3),
('account', 'Paano mag-login? Nakalimutan ko ang password ko',
 'Pwede kang mag-login gamit ang Telegram, Google, phone number + password, o username + password. Pwede kang mag-bind ng ibang login method sa Menu > Account & Login. Kung hindi mo ma-access ang account mo, kontakin ang support para ma-verify ang identity mo.', 'tl', 1),
('account', 'Na-freeze o na-ban ang account ko',
 'Ang mga account ay fini-freeze dahil sa security o paglabag sa rules. Makipag-ugnayan sa aming human support team kasama ang detalye ng account mo - ang ganitong isyu ay laging hinahawakan ng human agent.', 'tl', 2),
('kyc', 'Ano ang kailangan para sa KYC verification?',
 'Dalawang hakbang ang KYC: 1) i-verify ang phone number mo gamit ang SMS code, 2) mag-upload ng photo ng valid government ID at kumuha ng face photo. Automatic ang review at karaniwang tapos sa loob ng ilang minuto. Kailangan 21 taong gulang pataas.', 'tl', 1),
('kyc', 'Na-reject ang KYC ko, ano ang gagawin ko?',
 'Tingnan ang rejection reason sa KYC page. Mga karaniwang dahilan: malabo ang photo, hindi buo ang ID sa kuha, hindi tugma ang face photo, o wala pang 21 taong gulang. Ayusin ito at mag-submit ulit. Tanungin mo lang ako at iche-check ko ang KYC status at dahilan mo.', 'tl', 2),
('game', 'Hindi nag-lo-load o nag-crash ang laro',
 'Subukang i-refresh ang page o pumasok ulit sa laro, at i-check ang network connection mo. Kung naputol ang game round at sa tingin mo mali ang settlement, kumuha ng screenshot at kontakin ang support kasama ang pangalan ng laro at oras.', 'tl', 1),
('bonus', 'Anong mga promo ang available?',
 'Kasama sa mga kasalukuyang promo ang first deposit bonus, Lucky Spin, at ang cashback (rebate) program na may levels LV1-LV6 - mas mataas ang total wagering, mas mataas ang cashback rate. Tingnan ang promotions at cashback pages, o tanungin mo lang ako.', 'tl', 1);
