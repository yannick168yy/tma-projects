import React, { useState, useEffect } from "react";
import {
  Search,
  ChevronDown,
  Zap,
  Trophy,
  Headphones,
  ChevronLeft,
  ChevronRight,
  Flame,
  Wallet,
  Gift,
  Spade,
  Menu,
  Bell,
  TrendingUp,
  CircleDollarSign,
  BarChart3,
  PlusCircle,
  Gamepad2,
  Dices,
  Clock,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight as ChevronRightIcon,
  Copy,
  Crown,
} from "lucide-react";

// ─── Data ─────────────────────────────────────────────────────────────────────

const BANNERS = [
  {
    id: 1,
    gradient: "from-[#1a0533] via-[#4a0e82] to-[#c0392b]",
    tag: "WELCOME BONUS",
    title: "100% UP TO\n₱50,000",
    sub: "New player exclusive • First deposit",
    badge: "🎉",
    badgeColor: "bg-yellow-400 text-black",
  },
  {
    id: 2,
    gradient: "from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]",
    tag: "DAILY CASHBACK",
    title: "UP TO 15%\nCASHBACK",
    sub: "Every day, no questions asked",
    badge: "💰",
    badgeColor: "bg-emerald-400 text-black",
  },
  {
    id: 3,
    gradient: "from-[#2d1a00] via-[#8b4513] to-[#c0392b]",
    tag: "E-SABONG SPECIAL",
    title: "LIBRE TAYA\nEVERY FRIDAY",
    sub: "Exclusive for verified PH players",
    badge: "🐓",
    badgeColor: "bg-red-500 text-white",
  },
  {
    id: 4,
    gradient: "from-[#0a1a2e] via-[#1a3a5c] to-[#7b2d8b]",
    tag: "VIP PROGRAM",
    title: "MAGING VIP\nNGAYON",
    sub: "Exclusive rewards & priority support",
    badge: "👑",
    badgeColor: "bg-yellow-500 text-black",
  },
];

const CATEGORIES = [
  { icon: "🎁", label: "Bonuses", color: "from-purple-600 to-indigo-700", badge: null, nav: "bonuses", promo: null },
  { icon: "🎖️", label: "Free Play", color: "from-violet-600 to-purple-800", badge: "₱88", nav: "bonuses", promo: "trial" },
  { icon: "🤝", label: "Refer & Win", color: "from-emerald-600 to-teal-700", badge: null, nav: "bonuses", promo: "referral" },
  { icon: "💰", label: "First Dep", color: "from-orange-600 to-red-700", badge: "120%", nav: "bonuses", promo: "firstdep" },
];

const GAME_TABS = [
  { id: "all", label: "All Games", icon: <Spade size={13} /> },
  { id: "slots", label: "Slots", icon: <Zap size={13} /> },
  { id: "egames", label: "E-Games", icon: <Gamepad2 size={13} /> },
  { id: "sports", label: "Sports", icon: <BarChart3 size={13} /> },
  { id: "sabong", label: "Sabong", icon: "🐓" },
];

const HISTORY_GAMES = [
  { id: 1, name: "WILD BOUNTY\nSHOWDOWN", provider: "PGSOFT", gradient: "from-amber-800 via-amber-600 to-yellow-400", icon: "🤠" },
  { id: 2, name: "MONEYFEST", provider: "POPIPLAY", gradient: "from-orange-800 via-orange-600 to-yellow-400", icon: "🐷" },
  { id: 3, name: "AVIATORS PH", provider: "BGAMING", gradient: "from-blue-900 via-sky-700 to-cyan-500", icon: "✈️" },
];

const POPULAR_GAMES = [
  { id: 1, name: "GOLDEN FORTUNE", provider: "PGSOFT", gradient: "from-yellow-700 via-amber-600 to-yellow-400", icon: "🎰", hot: true },
  { id: 2, name: "LUCKY FIESTA", provider: "PRAGMATIC", gradient: "from-red-800 via-red-600 to-orange-400", icon: "🎊", hot: true },
  { id: 3, name: "MANILA NIGHTS", provider: "POPIPLAY", gradient: "from-blue-900 via-indigo-700 to-purple-500", icon: "🌃", hot: false },
  { id: 4, name: "PESO JACKPOT", provider: "BGAMING", gradient: "from-green-800 via-emerald-600 to-lime-400", icon: "💎", hot: false },
  { id: 5, name: "DRAGON RICHES", provider: "HABANERO", gradient: "from-red-900 via-red-700 to-yellow-500", icon: "🐉", hot: true },
  { id: 6, name: "ISLAND REELS", provider: "NOLIMIT", gradient: "from-cyan-800 via-teal-600 to-emerald-400", icon: "🏝️", hot: false },
  { id: 7, name: "BACCARAT KING", provider: "EVOLUTION", gradient: "from-slate-800 via-slate-600 to-gray-400", icon: "🃏", hot: false },
  { id: 8, name: "MONEYFEST", provider: "POPIPLAY", gradient: "from-orange-800 via-orange-600 to-yellow-400", icon: "🐷", hot: true },
  { id: 9, name: "TARSIER BLAST", provider: "BGAMING", gradient: "from-violet-900 via-purple-700 to-indigo-500", icon: "👁️", hot: false },
];

const EGAMES = [
  { id: 1, name: "Tarsier Blast", provider: "PGSOFT", players: 892, gradient: "from-violet-900 to-indigo-700", icon: "👾", hot: true },
  { id: 2, name: "Neon Fighter", provider: "NETENT", players: 1204, gradient: "from-cyan-900 to-blue-700", icon: "🕹️", hot: false },
  { id: 3, name: "Fortune Rush", provider: "HABANERO", players: 654, gradient: "from-orange-900 to-amber-700", icon: "⚡", hot: true },
  { id: 4, name: "Dragon Quest", provider: "BGAMING", players: 445, gradient: "from-red-900 to-rose-700", icon: "🐉", hot: false },
  { id: 5, name: "Space Slots", provider: "NOLIMIT", players: 330, gradient: "from-slate-900 to-indigo-900", icon: "🚀", hot: false },
  { id: 6, name: "Riches Road", provider: "PRAGMATIC", players: 788, gradient: "from-green-900 to-emerald-700", icon: "🤑", hot: true },
];

const LIVE_GAMES = [
  { id: 1, name: "Baccarat PH", dealer: "Dealer Maria", players: 234, gradient: "from-emerald-900 to-emerald-700", icon: "🎴" },
  { id: 2, name: "Roulette Live", dealer: "Dealer Ana", players: 189, gradient: "from-red-900 to-red-700", icon: "🎡" },
  { id: 3, name: "Dragon Tiger", dealer: "Dealer Jose", players: 312, gradient: "from-purple-900 to-purple-700", icon: "🐯" },
  { id: 4, name: "Blackjack VIP", dealer: "Dealer Kim", players: 97, gradient: "from-slate-900 to-slate-700", icon: "🃏" },
];

const WINNERS = [
  { name: "J***o", game: "Golden Fortune", amount: "₱48,200" },
  { name: "M***a", game: "Lucky Fiesta", amount: "₱22,500" },
  { name: "R***l", game: "Dragon Riches", amount: "₱91,000" },
  { name: "C***e", game: "Peso Jackpot", amount: "₱15,750" },
  { name: "A***n", game: "Aviators PH", amount: "₱33,300" },
];

const PROVIDERS = [
  { name: "PGSOFT", color: "from-orange-500 to-red-600", abbr: "PG" },
  { name: "PRAGMATIC", color: "from-red-600 to-rose-700", abbr: "PP" },
  { name: "BGAMING", color: "from-blue-600 to-indigo-700", abbr: "BG" },
  { name: "EVOLUTION", color: "from-slate-600 to-slate-800", abbr: "EVO" },
  { name: "HABANERO", color: "from-yellow-500 to-orange-600", abbr: "HAB" },
  { name: "NOLIMIT", color: "from-purple-600 to-violet-700", abbr: "NLC" },
  { name: "NETENT", color: "from-emerald-600 to-teal-700", abbr: "NET" },
  { name: "POPIPLAY", color: "from-pink-600 to-rose-600", abbr: "POP" },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function GameCard({ game, compact = false }: { game: typeof POPULAR_GAMES[0]; compact?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`relative rounded-xl overflow-hidden flex flex-col justify-end transition-transform duration-100 ${
        compact ? "aspect-[3/4]" : "aspect-[3/4]"
      } ${pressed ? "scale-95" : ""}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-4xl">{game.icon}</span>
      </div>
      {game.hot && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5">
          <Flame size={9} className="text-white" />
          <span className="text-white text-[9px] font-bold">HOT</span>
        </div>
      )}
      <div className="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
        <p
          className="text-white font-black text-xs leading-tight whitespace-pre-line"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {game.name}
        </p>
        <p className="text-white/50 text-[9px] uppercase tracking-wider">{game.provider}</p>
      </div>
    </button>
  );
}

function HistoryCard({ game }: { game: typeof HISTORY_GAMES[0] }) {
  return (
    <div className="flex-shrink-0 w-28 rounded-xl overflow-hidden relative cursor-pointer" style={{ aspectRatio: "3/4" }}>
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-4xl">{game.icon}</span>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <p
          className="text-white font-black text-[11px] leading-tight whitespace-pre-line"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {game.name}
        </p>
        <p className="text-white/50 text-[9px] uppercase">{game.provider}</p>
      </div>
    </div>
  );
}

function EGameCard({ game }: { game: typeof EGAMES[0] }) {
  return (
    <div className="flex-shrink-0 w-32 rounded-xl overflow-hidden relative h-24 cursor-pointer">
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`} />
      {game.hot && (
        <div className="absolute top-2 left-2 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5">
          <Flame size={9} className="text-white" />
          <span className="text-white text-[9px] font-bold">HOT</span>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl">{game.icon}</span>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-white font-bold text-xs" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          {game.name}
        </p>
        <p className="text-white/50 text-[9px]">{game.players.toLocaleString()} playing</p>
      </div>
    </div>
  );
}

function LiveCard({ game }: { game: typeof LIVE_GAMES[0] }) {
  return (
    <div className="flex-shrink-0 w-36 rounded-xl overflow-hidden relative h-24 cursor-pointer">
      <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`} />
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 rounded-full px-2 py-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        <span className="text-white text-[10px] font-bold">LIVE</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl">{game.icon}</span>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-white font-bold text-xs">{game.name}</p>
        <p className="text-white/60 text-[10px]">{game.players} playing</p>
      </div>
    </div>
  );
}

// ─── Profile Page ─────────────────────────────────────────────────────────────

const TARSIER_SVG = (
  <svg viewBox="0 0 40 40" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="26" rx="11" ry="9" fill="#92400e"/>
    <ellipse cx="20" cy="19" rx="13" ry="13" fill="#a16207"/>
    <ellipse cx="20" cy="20" rx="9" ry="9" fill="#b45309"/>
    <circle cx="14" cy="17" r="6" fill="white"/>
    <circle cx="26" cy="17" r="6" fill="white"/>
    <circle cx="14" cy="17" r="4.2" fill="#1e293b"/>
    <circle cx="26" cy="17" r="4.2" fill="#1e293b"/>
    <circle cx="15.5" cy="15.5" r="1.4" fill="white"/>
    <circle cx="27.5" cy="15.5" r="1.4" fill="white"/>
    <ellipse cx="20" cy="22" rx="1.8" ry="1.2" fill="#7c2d12"/>
    <ellipse cx="8" cy="12" rx="4" ry="5" fill="#92400e"/>
    <ellipse cx="32" cy="12" rx="4" ry="5" fill="#92400e"/>
    <ellipse cx="8" cy="12" rx="2.2" ry="3.2" fill="#b45309"/>
    <ellipse cx="32" cy="12" rx="2.2" ry="3.2" fill="#b45309"/>
  </svg>
);

const CURRENCIES = [
  { symbol: "₱", name: "PHP", color: "from-blue-600 to-blue-800" },
  { symbol: "₮", name: "USDT", color: "from-teal-500 to-emerald-600" },
  { symbol: "💎", name: "TON", color: "from-sky-400 to-blue-600" },
  { symbol: "₿", name: "BTC", color: "from-orange-400 to-amber-600" },
  { symbol: "Ξ", name: "ETH", color: "from-purple-500 to-indigo-700" },
  { symbol: "◈", name: "BNB", color: "from-yellow-400 to-yellow-600" },
];

// ProfilePage renders only the scrollable body content — header & bottom nav live in App
function ProfilePage() {
  const [personalSaved, setPersonalSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [dobOpen, setDobOpen] = useState(false);
  const [gender, setGender] = useState("");
  const [telegramLinked] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const USER_ID = "TW-8842916";

  const copyId = () => {
    navigator.clipboard?.writeText(USER_ID).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dobFilled = dobMonth && dobDay && dobYear;
  const dobDisplay = dobFilled ? `${MONTHS[parseInt(dobMonth) - 1]} ${parseInt(dobDay)}, ${dobYear}` : "";
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1924 }, (_, i) => currentYear - 18 - i);
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

  const LINKS = [
    { icon: "📢", label: "Official Channel", sub: "News & announcements", color: "from-blue-600 to-blue-800" },
    { icon: "💬", label: "Community Group", sub: "Chat with players", color: "from-indigo-600 to-violet-700" },
    { icon: "🎰", label: "VIP Club", sub: "Exclusive member perks", color: "from-yellow-500 to-amber-600" },
    { icon: "📱", label: "Facebook Page", sub: "Follow for promotions", color: "from-blue-500 to-blue-700" },
  ];

  const DOCS = [
    { label: "Terms & Conditions", icon: "📋" },
    { label: "Privacy Policy", icon: "🔒" },
    { label: "Responsible Gaming", icon: "🛡️" },
    { label: "AML Policy", icon: "⚖️" },
    { label: "Bonus Terms", icon: "🎁" },
    { label: "About BetoGo", icon: "ℹ️" },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-4" style={{ scrollbarWidth: "none" }}>

      {/* ── Avatar + ID — compact height ─────────────────── */}
      <div className="flex items-center gap-4 px-5 py-4 bg-card border-b border-border">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 overflow-hidden shadow-lg shadow-amber-500/30 flex-shrink-0">
          {TARSIER_SVG}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-foreground font-black text-sm leading-none mb-1">Player Account</p>
          <button
            onClick={copyId}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          >
            <span className="text-muted-foreground text-xs">ID: </span>
            <span className="text-primary font-bold text-xs">{USER_ID}</span>
            {copied
              ? <CheckCircle2 size={11} className="text-emerald-400" />
              : <Copy size={11} className="text-muted-foreground" />}
          </button>
          {copied && <p className="text-emerald-400 text-[10px] font-semibold mt-0.5">Copied!</p>}
        </div>
      </div>

      <div className="px-5 space-y-4 mt-4">

        {/* ── Personal Info ───────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              PERSONAL INFORMATION
            </h3>
            {personalSaved && (
              <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 size={11} /> Verified
              </span>
            )}
          </div>
          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            {/* First Name */}
            {[
              { label: "First Name", val: firstName, set: setFirstName, placeholder: "Enter first name", type: "text" },
              { label: "Last Name", val: lastName, set: setLastName, placeholder: "Enter last name", type: "text" },
            ].map((f) => (
              <div key={f.label} className="px-4 py-3 border-b border-border">
                <label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">{f.label}</label>
                <input
                  type={f.type}
                  value={f.val}
                  onChange={(e) => !personalSaved && f.set(e.target.value)}
                  placeholder={f.placeholder}
                  readOnly={personalSaved}
                  className="w-full bg-transparent text-foreground font-semibold text-sm focus:outline-none placeholder:text-muted-foreground/40"
                />
              </div>
            ))}
            {/* Date of Birth — custom English picker */}
            <div
              className="px-4 py-3 border-b border-border cursor-pointer"
              onClick={() => !personalSaved && setDobOpen((v) => !v)}
            >
              <label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1 cursor-pointer">
                Date of Birth
              </label>
              {personalSaved ? (
                <p className="text-foreground font-semibold text-sm">{dobDisplay || "—"}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${dobFilled ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {dobFilled ? dobDisplay : "Select date of birth"}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-muted-foreground transition-transform duration-200 ${dobOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                  {dobOpen && (
                    <div
                      className="mt-3 grid grid-cols-3 gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Month */}
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase">Month</span>
                        <select
                          value={dobMonth}
                          onChange={(e) => setDobMonth(e.target.value)}
                          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground text-xs font-semibold focus:outline-none focus:border-primary appearance-none"
                        >
                          <option value="">Month</option>
                          {MONTHS.map((m, i) => (
                            <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
                          ))}
                        </select>
                      </div>
                      {/* Day */}
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase">Day</span>
                        <select
                          value={dobDay}
                          onChange={(e) => setDobDay(e.target.value)}
                          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground text-xs font-semibold focus:outline-none focus:border-primary appearance-none"
                        >
                          <option value="">Day</option>
                          {days.map((d) => (
                            <option key={d} value={d}>{parseInt(d)}</option>
                          ))}
                        </select>
                      </div>
                      {/* Year */}
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase">Year</span>
                        <select
                          value={dobYear}
                          onChange={(e) => setDobYear(e.target.value)}
                          className="bg-secondary border border-border rounded-lg px-2 py-1.5 text-foreground text-xs font-semibold focus:outline-none focus:border-primary appearance-none"
                        >
                          <option value="">Year</option>
                          {years.map((y) => (
                            <option key={y} value={String(y)}>{y}</option>
                          ))}
                        </select>
                      </div>
                      {/* Confirm */}
                      {dobFilled && (
                        <button
                          className="col-span-3 mt-1 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-black hover:bg-primary/30 transition-colors"
                          onClick={() => setDobOpen(false)}
                        >
                          Confirm — {dobDisplay}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Gender */}
            <div className="px-4 py-3">
              <label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-2">Gender</label>
              <div className="flex gap-2">
                {["Male", "Female", "Other"].map((g) => (
                  <button
                    key={g}
                    disabled={personalSaved}
                    onClick={() => !personalSaved && setGender(g)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      gender === g ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                    } ${personalSaved ? "opacity-60 cursor-default" : "hover:text-foreground"}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {!personalSaved && (
            <button
              onClick={() => { if (firstName && lastName && dobFilled && gender) setPersonalSaved(true); }}
              className="w-full mt-2.5 py-3 rounded-2xl bg-primary text-primary-foreground font-black text-sm hover:bg-yellow-400 transition-colors shadow shadow-amber-500/20"
            >
              Save & Lock Information
            </button>
          )}
        </section>

        {/* ── Contact Info ────────────────────────────────── */}
        <section>
          <h3 className="text-foreground font-black text-sm mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            CONTACT INFORMATION
          </h3>
          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-lg">✈️</div>
                <div>
                  <p className="text-foreground font-bold text-sm">Telegram</p>
                  <p className="text-muted-foreground text-xs">{telegramLinked ? "@username" : "Not connected"}</p>
                </div>
              </div>
              <button className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${
                telegramLinked ? "bg-emerald-500/20 text-emerald-400" : "bg-primary text-primary-foreground hover:bg-yellow-400"
              }`}>
                {telegramLinked ? "✓ Linked" : "Connect"}
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">Phone Number</label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">🇵🇭 +63</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9XX XXX XXXX"
                  className="flex-1 bg-transparent text-foreground font-semibold text-sm focus:outline-none placeholder:text-muted-foreground/40" />
              </div>
            </div>
            <div className="px-4 py-3">
              <label className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold block mb-1">Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com"
                className="w-full bg-transparent text-foreground font-semibold text-sm focus:outline-none placeholder:text-muted-foreground/40" />
            </div>
          </div>
        </section>

        {/* ── Customer Support ────────────────────────────── */}
        <section>
          <h3 className="text-foreground font-black text-sm mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            CUSTOMER SUPPORT
          </h3>
          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            {[
              { icon: "💬", label: "Live Chat", sub: "Available 24/7", badge: "Online", badgeColor: "bg-emerald-500/20 text-emerald-400" },
              { icon: "📩", label: "Telegram Support", sub: "@BetoGo_Support", badge: null, badgeColor: "" },
              { icon: "📧", label: "Email Support", sub: "support@betogo.com", badge: null, badgeColor: "" },
            ].map((item, i, arr) => (
              <button key={item.label} className={`w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="text-xl">{item.icon}</span>
                  <div className="text-left">
                    <p className="text-foreground font-bold text-sm">{item.label}</p>
                    <p className="text-muted-foreground text-xs">{item.sub}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.badge && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.badgeColor}`}>{item.badge}</span>}
                  <ChevronRight size={14} className="text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Community & Media ───────────────────────────── */}
        <section>
          <h3 className="text-foreground font-black text-sm mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            COMMUNITY & MEDIA
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {LINKS.map((l) => (
              <button key={l.label} className={`relative rounded-2xl bg-gradient-to-br ${l.color} p-4 text-left hover:opacity-90 transition-opacity`}>
                <span className="text-2xl block mb-2">{l.icon}</span>
                <p className="text-white font-black text-xs leading-tight">{l.label}</p>
                <p className="text-white/60 text-[10px] mt-0.5">{l.sub}</p>
                <ChevronRight size={12} className="absolute top-3 right-3 text-white/50" />
              </button>
            ))}
          </div>
        </section>

        {/* ── Supported Currencies ────────────────────────── */}
        <section>
          <h3 className="text-foreground font-black text-sm mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            SUPPORTED CURRENCIES
          </h3>
          <div className="grid grid-cols-6 gap-2">
            {CURRENCIES.map((c) => (
              <div key={c.name} className="flex flex-col items-center gap-1">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow-md`}>
                  <span className="text-white font-black text-sm">{c.symbol}</span>
                </div>
                <span className="text-muted-foreground text-[10px] font-bold">{c.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Legal & Policies ────────────────────────────── */}
        <section>
          <h3 className="text-foreground font-black text-sm mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            LEGAL & POLICIES
          </h3>
          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            {DOCS.map((d, i) => (
              <button key={d.label} className={`w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors ${i < DOCS.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="text-base">{d.icon}</span>
                  <span className="text-foreground font-semibold text-sm">{d.label}</span>
                </div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="text-center py-4 space-y-1">
          <p className="text-muted-foreground text-xs">BetoGo · v1.0.0</p>
          <p className="text-muted-foreground text-xs">© 2025 BetoGo. All rights reserved.</p>
          <p className="text-muted-foreground text-[10px] mt-2 px-4 leading-relaxed">
            BetoGo operates under a valid gaming license. Please play responsibly. 18+
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Bonuses / Activities Page ────────────────────────────────────────────────

const PROMOS = [
  {
    id: "trial",
    tag: "NEW PLAYER",
    title: "Chief Trial Officer",
    tagline: "Register & Play for Free",
    reward: "₱ 88",
    rewardLabel: "Free Bonus",
    desc: "Brand-new players get ₱88 in free credits upon first registration — no deposit required. Start exploring all our games risk-free!",
    gradient: "from-[#1a0060] via-[#4a0e82] to-[#8B2FC9]",
    accentColor: "#c084fc",
    icon: "🎖️",
    steps: ["Register a new account", "Receive ₱88 bonus instantly"],
    badge: "No Deposit",
    badgeColor: "bg-purple-400/20 text-purple-300",
    cta: "Claim Now",
    ctaColor: "bg-purple-500 hover:bg-purple-400",
    expiry: "Ongoing",
    highlight: true,
  },
  {
    id: "referral",
    tag: "REFERRAL",
    title: "Invite & Earn Together",
    tagline: "Both You & Your Friend Win",
    reward: "₱50 / ₱30",
    rewardLabel: "Inviter / Invitee",
    desc: "Invite a friend to BetoGo. When they register and make their first deposit, you get ₱50 and your friend gets ₱30 — unlimited referrals!",
    gradient: "from-[#064e3b] via-[#065f46] to-[#047857]",
    accentColor: "#34d399",
    icon: "🤝",
    steps: ["Share your referral link", "Friend registers & deposits", "Both receive ₱500 bonus"],
    badge: "Unlimited",
    badgeColor: "bg-emerald-400/20 text-emerald-300",
    cta: "Share Link",
    ctaColor: "bg-emerald-500 hover:bg-emerald-400",
    expiry: "Ongoing",
    highlight: false,
  },
  {
    id: "firstdep",
    tag: "FIRST DEPOSIT",
    title: "First Deposit Fiesta",
    tagline: "100% Match Bonus",
    reward: "120%",
    rewardLabel: "Up to ₱1,000",
    desc: "Make your first deposit and we'll top it up by 120% — up to ₱1,000 bonus credited instantly. Minimum deposit ₱100 to qualify.",
    gradient: "from-[#7c2d12] via-[#c0392b] to-[#e85d04]",
    accentColor: "#fbbf24",
    icon: "💰",
    steps: ["Make your first deposit (min ₱100)", "Bonus credited within 5 minutes", "Wager 15x to withdraw"],
    badge: "120% Match",
    badgeColor: "bg-amber-400/20 text-amber-300",
    cta: "Deposit Now",
    ctaColor: "bg-amber-500 hover:bg-amber-400",
    expiry: "Limited Time",
    highlight: false,
  },
];

const BONUS_WINNERS = [
  { name: "J***n", promo: "Chief Trial Officer", amount: "₱88" },
  { name: "M***a", promo: "First Deposit Fiesta", amount: "₱1,000" },
  { name: "R***o", promo: "Invite & Earn", amount: "₱500" },
  { name: "C***e", promo: "First Deposit Fiesta", amount: "₱1,000" },
  { name: "A***y", promo: "Invite & Earn", amount: "₱1,500" },
];

const STATS = [
  { label: "Total Distributed", value: "₱4.2M+", icon: "💎" },
  { label: "Active Promos", value: "3", icon: "🎯" },
  { label: "Winners Today", value: "128", icon: "🏆" },
];

function BonusesPage({ openWallet, promoFilter }: { openWallet: () => void; promoFilter?: string | null }) {
  const [expanded, setExpanded] = useState<string | null>(promoFilter ?? null);

  useEffect(() => {
    if (promoFilter) {
      setExpanded(promoFilter);
      setTimeout(() => {
        const el = document.getElementById(`promo-${promoFilter}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [promoFilter]);

  return (
    <div className="flex-1 overflow-y-auto pb-20" style={{ scrollbarWidth: "none" }}>

      {/* ── Hero header ──────────────────────────────────── */}
      <div className="relative px-4 pt-3 pb-5 overflow-hidden" style={{ background: "linear-gradient(160deg,#1a0060 0%,#080B14 60%)" }}>
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-purple-600/10 -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-amber-500/10 translate-y-1/2 -translate-x-1/4" />
        <p className="text-muted-foreground text-[11px] uppercase tracking-widest font-bold mb-1">BetoGo Exclusive</p>
        <h1 className="text-white font-black leading-tight mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.8rem" }}>
          PROMOTIONS<br /><span className="text-primary">& BONUSES</span>
        </h1>
        <p className="text-white/50 text-xs max-w-[220px] leading-relaxed">
          Claim your rewards every step of the way — from your very first play to every referral.
        </p>
        {/* Stats row */}
        <div className="flex gap-3 mt-4">
          {STATS.map((s) => (
            <div key={s.label} className="flex-1 bg-white/5 rounded-xl px-2.5 py-2 text-center border border-white/8">
              <p className="text-base leading-none mb-0.5">{s.icon}</p>
              <p className="text-primary font-black text-sm leading-none">{s.value}</p>
              <p className="text-white/40 text-[9px] mt-0.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Winners ticker ───────────────────────────────── */}
      <div className="mx-4 mt-3 bg-secondary rounded-xl px-3 py-2 flex items-center gap-2 overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-1 text-primary">
          <Trophy size={12} />
          <span className="text-[10px] font-black uppercase whitespace-nowrap">Recent Claims</span>
        </div>
        <div className="w-px h-3 bg-border flex-shrink-0" />
        <div className="overflow-hidden flex-1">
          <div className="flex gap-5 animate-[marquee_14s_linear_infinite] whitespace-nowrap">
            {[...BONUS_WINNERS, ...BONUS_WINNERS].map((w, i) => (
              <span key={i} className="text-[11px] flex-shrink-0">
                <span className="text-primary font-bold">{w.name}</span>
                <span className="text-white/50"> claimed </span>
                <span className="text-emerald-400 font-bold">{w.amount}</span>
                <span className="text-white/30"> · {w.promo}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Promo cards ──────────────────────────────────── */}
      <div className="px-4 mt-4 space-y-3">
        {PROMOS.map((p) => (
          <div
            key={p.id}
            id={`promo-${p.id}`}
            className={`rounded-2xl overflow-hidden border ${p.highlight ? "border-purple-500/40" : "border-white/8"} ${promoFilter === p.id ? "ring-2 ring-primary/60" : ""}`}
          >
            {/* Card top — gradient banner */}
            <div className={`relative bg-gradient-to-br ${p.gradient} px-4 py-4`}>
              {p.highlight && (
                <div className="absolute top-3 right-3 bg-primary text-primary-foreground text-[10px] font-black px-2 py-0.5 rounded-full">
                  ⭐ FEATURED
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-12">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: p.accentColor }}>
                    {p.tag}
                  </span>
                  <h2 className="text-white font-black leading-tight mt-0.5" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.3rem" }}>
                    {p.title}
                  </h2>
                  <p className="text-white/60 text-xs mt-0.5">{p.tagline}</p>
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-3xl">{p.icon}</span>
                </div>
              </div>
              {/* Reward pill */}
              <div className="mt-3 flex items-center gap-2">
                <div className="bg-black/30 rounded-xl px-3 py-1.5 flex items-baseline gap-1.5">
                  <span className="text-white font-black text-xl leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {p.reward}
                  </span>
                  <span className="text-white/60 text-xs">{p.rewardLabel}</span>
                </div>
                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${p.badgeColor}`}>
                  {p.badge}
                </span>
                <span className="ml-auto text-[10px] text-white/40 font-semibold">
                  🕐 {p.expiry}
                </span>
              </div>
            </div>

            {/* Card body */}
            <div className="bg-card px-4 py-3">
              <p className="text-muted-foreground text-xs leading-relaxed">{p.desc}</p>

              {/* How it works — expandable */}
              <button
                className="w-full flex items-center justify-between mt-3 py-2 border-t border-border"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                <span className="text-foreground text-xs font-bold">How it works</span>
                <ChevronDown
                  size={14}
                  className={`text-muted-foreground transition-transform duration-200 ${expanded === p.id ? "rotate-180" : ""}`}
                />
              </button>
              {expanded === p.id && (
                <div className="pb-2 space-y-2">
                  {p.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[11px] text-black mt-0.5"
                        style={{ background: p.accentColor }}
                      >
                        {i + 1}
                      </div>
                      <span className="text-foreground/80 text-xs leading-relaxed">{step}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* CTA */}
              <button
                onClick={p.id === "firstdep" ? openWallet : undefined}
                className={`w-full mt-3 py-3 rounded-xl text-white font-black text-sm transition-colors ${p.ctaColor}`}
              >
                {p.cta}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Terms note ───────────────────────────────────── */}
      <div className="mx-4 mt-4 mb-2 bg-secondary/50 rounded-xl px-4 py-3 border border-border">
        <p className="text-muted-foreground text-[11px] leading-relaxed text-center">
          All bonuses are subject to BetoGo's Terms & Conditions. Wagering requirements apply.
          Bonuses are for entertainment purposes. Please gamble responsibly. 18+
        </p>
      </div>

    </div>
  );
}

// ─── Menu Page ────────────────────────────────────────────────────────────────

type MGame = { name: string; provider: string; icon: string; hot: boolean };
type MSubcat = { id: string; label: string; icon: string; count: number; hot?: boolean; isNew?: boolean; color: string; gradient: string; games: MGame[] };
type MSection = { id: string; label: string; dot: string; subcats: MSubcat[] };

const MENU_DATA: MSection[] = [
  {
    id: "casino", label: "Casino", dot: "#FFB800",
    subcats: [
      { id: "popular",   label: "Popular",         icon: "🔥", count: 88, hot: true,  color: "#f97316", gradient: "from-orange-600 to-red-700",
        games: [{ name: "Golden Fortune", provider: "PGSOFT", icon: "🎰", hot: true }, { name: "Lucky Fiesta", provider: "PRAGMATIC", icon: "🎊", hot: true }, { name: "Dragon Riches", provider: "HABANERO", icon: "🐉", hot: true }, { name: "Peso Jackpot", provider: "BGAMING", icon: "💎", hot: false }, { name: "Moneyfest", provider: "POPIPLAY", icon: "🐷", hot: true }, { name: "Wild Bounty", provider: "PGSOFT", icon: "🤠", hot: false }] },
      { id: "egames",    label: "E-Games",           icon: "👾", count: 95,             color: "#a78bfa", gradient: "from-violet-700 to-indigo-800",
        games: [{ name: "Tarsier Blast", provider: "PGSOFT", icon: "👾", hot: true }, { name: "Neon Fighter", provider: "NETENT", icon: "🕹️", hot: false }, { name: "Fortune Rush", provider: "HABANERO", icon: "⚡", hot: true }, { name: "Space Slots", provider: "NOLIMIT", icon: "🚀", hot: false }, { name: "Cyber Riches", provider: "BGAMING", icon: "💻", hot: true }, { name: "Pixel Race", provider: "POPIPLAY", icon: "🏁", hot: false }] },
      { id: "quick",     label: "Quick Games",       icon: "⚡", count: 42,             color: "#38bdf8", gradient: "from-cyan-700 to-blue-800",
        games: [{ name: "Aviator", provider: "SPRIBE", icon: "✈️", hot: true }, { name: "Crash PH", provider: "BGAMING", icon: "🚀", hot: true }, { name: "Plinko", provider: "BGAMING", icon: "🎯", hot: false }, { name: "Mines", provider: "BGAMING", icon: "💣", hot: false }, { name: "Dice Pro", provider: "BGAMING", icon: "🎲", hot: false }, { name: "Keno Fast", provider: "BGAMING", icon: "🔢", hot: false }] },
      { id: "new",       label: "New Games",         icon: "✨", count: 24, isNew: true, color: "#f472b6", gradient: "from-pink-700 to-fuchsia-800",
        games: [{ name: "Super Ace", provider: "JILI", icon: "♠️", hot: true }, { name: "Fortune Gem", provider: "JILI", icon: "💎", hot: false }, { name: "Candy Burst", provider: "PGSOFT", icon: "🍬", hot: false }, { name: "Mahjong Ways 2", provider: "PGSOFT", icon: "🀄", hot: true }, { name: "Dragon vs Tiger", provider: "JILI", icon: "🐯", hot: false }, { name: "Mega Fishing", provider: "JILI", icon: "🎣", hot: true }] },
      { id: "featured",  label: "Featured",          icon: "⭐", count: 16,             color: "#fbbf24", gradient: "from-amber-600 to-yellow-700",
        games: [{ name: "Gates of Olympus", provider: "PRAGMATIC", icon: "⚡", hot: true }, { name: "Sweet Bonanza", provider: "PRAGMATIC", icon: "🍭", hot: false }, { name: "Starlight Princess", provider: "PRAGMATIC", icon: "👸", hot: true }, { name: "Big Bass", provider: "PRAGMATIC", icon: "🐟", hot: false }, { name: "Aztec Gems", provider: "PRAGMATIC", icon: "💎", hot: false }, { name: "Wild West Gold", provider: "PRAGMATIC", icon: "🤠", hot: true }] },
      { id: "bonusbuy",  label: "Bonus Buy",        icon: "💰", count: 31,             color: "#34d399", gradient: "from-emerald-700 to-green-800",
        games: [{ name: "Book of Dead", provider: "PLAYNGO", icon: "📖", hot: true }, { name: "Razor Shark", provider: "PUSHGAMING", icon: "🦈", hot: false }, { name: "Deadwood", provider: "NOLIMIT", icon: "💀", hot: true }, { name: "Tombstone", provider: "NOLIMIT", icon: "🪦", hot: false }, { name: "Mental", provider: "NOLIMIT", icon: "🧠", hot: false }, { name: "San Quentin", provider: "NOLIMIT", icon: "⛓️", hot: true }] },
    ],
  },
  {
    id: "live", label: "Live Casino", dot: "#3ECF8E",
    subcats: [
      { id: "livegames", label: "Live Games",     icon: "🎴", count: 48, hot: true,  color: "#10b981", gradient: "from-emerald-800 to-teal-900",
        games: [{ name: "Baccarat PH", provider: "EVOLUTION", icon: "🎴", hot: true }, { name: "Dragon Tiger", provider: "PRAGMATIC", icon: "🐯", hot: true }, { name: "Sic Bo", provider: "EVOLUTION", icon: "🎲", hot: false }, { name: "Casino Hold'em", provider: "EVOLUTION", icon: "♠️", hot: false }, { name: "Dream Catcher", provider: "EVOLUTION", icon: "🎡", hot: true }, { name: "Monopoly Live", provider: "EVOLUTION", icon: "🎩", hot: true }] },
      { id: "roulette",  label: "Roulette",       icon: "🎡", count: 12,             color: "#f87171", gradient: "from-red-800 to-rose-900",
        games: [{ name: "Lightning Roulette", provider: "EVOLUTION", icon: "⚡", hot: true }, { name: "Speed Roulette", provider: "EVOLUTION", icon: "🎡", hot: false }, { name: "Immersive Roulette", provider: "EVOLUTION", icon: "🎡", hot: false }, { name: "Double Ball", provider: "EVOLUTION", icon: "🔴", hot: false }, { name: "Salon Privé", provider: "EVOLUTION", icon: "🌹", hot: false }, { name: "Auto Roulette", provider: "EVOLUTION", icon: "🎡", hot: true }] },
      { id: "blackjack", label: "Blackjack",      icon: "🃏", count: 10,             color: "#94a3b8", gradient: "from-slate-700 to-slate-900",
        games: [{ name: "Infinite Blackjack", provider: "EVOLUTION", icon: "♾️", hot: true }, { name: "Power Blackjack", provider: "EVOLUTION", icon: "⚡", hot: true }, { name: "Speed Blackjack", provider: "EVOLUTION", icon: "🃏", hot: false }, { name: "Blackjack VIP", provider: "EVOLUTION", icon: "🃏", hot: false }, { name: "Free Bet BJ", provider: "EVOLUTION", icon: "🃏", hot: false }, { name: "Salon Privé BJ", provider: "EVOLUTION", icon: "🌹", hot: false }] },
      { id: "baccarat",  label: "Baccarat",       icon: "🎴", count: 14,             color: "#818cf8", gradient: "from-indigo-800 to-purple-900",
        games: [{ name: "Speed Baccarat", provider: "EVOLUTION", icon: "🎴", hot: true }, { name: "Lightning Baccarat", provider: "EVOLUTION", icon: "⚡", hot: true }, { name: "Golden Wealth Bac.", provider: "EVOLUTION", icon: "💛", hot: false }, { name: "Baccarat Squeeze", provider: "EVOLUTION", icon: "🎴", hot: false }, { name: "Mini Baccarat", provider: "EVOLUTION", icon: "🎴", hot: false }, { name: "No Commission Bac.", provider: "EVOLUTION", icon: "🎴", hot: false }] },
      { id: "gameshows", label: "Game Shows",     icon: "🎪", count: 8,  isNew: true, color: "#e879f9", gradient: "from-fuchsia-800 to-pink-900",
        games: [{ name: "Crazy Time", provider: "EVOLUTION", icon: "🎪", hot: true }, { name: "Monopoly Live", provider: "EVOLUTION", icon: "🎩", hot: true }, { name: "Cash or Crash", provider: "EVOLUTION", icon: "🚀", hot: true }, { name: "Deal or No Deal", provider: "EVOLUTION", icon: "💼", hot: false }, { name: "Dream Catcher", provider: "EVOLUTION", icon: "🎡", hot: false }, { name: "Gonzo's Treasure", provider: "EVOLUTION", icon: "🗺️", hot: false }] },
    ],
  },
];

const LANGUAGES = [
  { code: "en",  label: "English",     flag: "🇺🇸" },
  { code: "fil", label: "Filipino",    flag: "🇵🇭" },
  { code: "id",  label: "Bahasa",      flag: "🇮🇩" },
  { code: "vi",  label: "Tiếng Việt", flag: "🇻🇳" },
];

// All games flat list for the search overlay (Casino subcats only for tabs)
const CASINO_SUBCATS = MENU_DATA.find((s) => s.id === "casino")!.subcats;
const ALL_GAMES = MENU_DATA.flatMap((s) => s.subcats.flatMap((c) => c.games.map((g) => ({ ...g, catId: c.id, gradient: c.gradient }))));

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const tabGames = tab === "all"
    ? ALL_GAMES
    : ALL_GAMES.filter((g) => g.catId === tab);

  const displayed = query.trim()
    ? tabGames.filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))
    : tabGames;

  const hasQuery = query.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-[430px] bg-card rounded-t-3xl flex flex-col"
        style={{ height: "86vh" }}
      >
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
        <div className="w-10 h-1 rounded-full bg-border" />
      </div>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 pb-3 border-b border-border flex-shrink-0">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games…"
            className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X size={13} /></button>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground font-bold text-sm flex-shrink-0 px-1">Cancel</button>
      </div>

      {/* Tabs — Casino subcats only */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: "none" }}>
        <button
          onClick={() => setTab("all")}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${tab === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
        >
          All Games
        </button>
        {CASINO_SUBCATS.map((c) => (
          <button
            key={c.id}
            onClick={() => setTab(c.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap ${tab === c.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
          >
            <span>{c.icon}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Section label */}
      <div className="px-4 pb-2 flex-shrink-0">
        <p className="text-muted-foreground text-[11px] font-bold">
          {hasQuery ? `Search results · ${displayed.length} games` : `All Games · ${displayed.length}`}
        </p>
      </div>

      {/* Game grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: "none" }}>
        {displayed.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {displayed.map((g, i) => (
              <button key={i} className="relative rounded-2xl overflow-hidden flex flex-col justify-end active:scale-95 transition-transform" style={{ aspectRatio: "3/4" }}>
                <div className={`absolute inset-0 bg-gradient-to-br ${g.gradient}`} />
                <div className="absolute inset-0 flex items-center justify-center"><span style={{ fontSize: 32 }}>{g.icon}</span></div>
                {g.hot && <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"><Flame size={8} className="text-white" /><span className="text-white text-[8px] font-black">HOT</span></div>}
                <div className="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-white font-black text-[10px] leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{g.name.toUpperCase()}</p>
                  <p className="text-white/40 text-[9px]">{g.provider}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-foreground font-bold text-sm">No results for "{query}"</p>
            <p className="text-muted-foreground text-xs mt-1">Try a different keyword</p>
          </div>
        )}
      </div>
      </div>
    </>
  );
}

function MenuPage({ onSearch }: { onSearch: () => void }) {
  const [active, setActive] = useState<{ sid: string; cid: string } | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [lang, setLang] = useState("en");

  const currentLang = LANGUAGES.find((l) => l.code === lang)!;
  const activeSection = active ? MENU_DATA.find((s) => s.id === active.sid) : null;
  const activeCat = active && activeSection ? activeSection.subcats.find((c) => c.id === active.cid) : null;

  return (
    <div className="flex-1 overflow-y-auto pb-24" style={{ scrollbarWidth: "none" }}>

      {/* ── Search trigger ───────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <button
          onClick={onSearch}
          className="w-full flex items-center gap-2.5 bg-secondary border border-border rounded-xl px-3.5 py-2.5 text-left"
        >
          <Search size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground/50 text-sm">Search any game…</span>
        </button>
      </div>

      {activeCat ? (
        /* ── Game grid ───────────────────────────────────── */
        <div className="px-4 pt-2">
          <button onClick={() => setActive(null)} className="flex items-center gap-1 mb-3 text-muted-foreground">
            <ChevronLeft size={13} />
            <span className="text-[11px] font-bold" style={{ color: activeSection?.dot }}>{activeSection?.label}</span>
            <span className="text-muted-foreground/40 text-[11px] mx-0.5">›</span>
            <span className="text-[11px] font-bold text-foreground">{activeCat.label}</span>
          </button>
          <div className={`relative rounded-2xl overflow-hidden mb-4 bg-gradient-to-br ${activeCat.gradient} px-4 py-3.5`}>
            <div className="absolute inset-0 bg-black/15" />
            <div className="relative flex items-center gap-3">
              <span style={{ fontSize: 30 }}>{activeCat.icon}</span>
              <div>
                <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest">{activeSection?.label}</p>
                <h2 className="text-white font-black text-lg leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{activeCat.label.toUpperCase()}</h2>
                <p className="text-white/50 text-[10px] mt-0.5">{activeCat.games.length} games</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {activeCat.games.map((game, i) => (
              <button key={i} className="relative rounded-2xl overflow-hidden flex flex-col justify-end active:scale-95 transition-transform" style={{ aspectRatio: "3/4" }}>
                <div className={`absolute inset-0 bg-gradient-to-br ${activeCat.gradient}`} />
                <div className="absolute inset-0 flex items-center justify-center"><span style={{ fontSize: 32 }}>{game.icon}</span></div>
                {game.hot && <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-red-500 rounded-full px-1.5 py-0.5"><Flame size={8} className="text-white" /><span className="text-white text-[8px] font-black">HOT</span></div>}
                <div className="relative p-2 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-white font-black text-[10px] leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{game.name.toUpperCase()}</p>
                  <p className="text-white/40 text-[9px]">{game.provider}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

      ) : (
        /* ── Two-section hierarchical list ──────────────── */
        <div className="pt-3 pb-2">
          {MENU_DATA.map((section) => (
            <div key={section.id} className="mb-5">

              {/* Section label — slim, inline, typographic */}
              <div className="flex items-center gap-2.5 px-5 mb-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: section.dot, boxShadow: `0 0 6px ${section.dot}` }} />
                <span className="text-foreground font-black text-base tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {section.label.toUpperCase()}
                </span>
                <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${section.dot}33, transparent)` }} />
              </div>

              {/* Subcategory tiles — slightly staggered horizontal padding for depth */}
              <div className="space-y-1.5 px-4">
                {section.subcats.map((cat, idx) => (
                  <button
                    key={cat.id}
                    onClick={() => setActive({ sid: section.id, cid: cat.id })}
                    className="w-full flex items-center gap-3 py-2.5 px-3.5 rounded-2xl active:scale-[0.97] transition-all text-left"
                    style={{
                      background: idx % 2 === 0 ? "rgba(255,255,255,0.04)" : "transparent",
                      marginLeft: idx % 2 !== 0 ? 6 : 0,
                      marginRight: idx % 2 !== 0 ? -6 : 0,
                    }}
                  >
                    {/* Coloured dot-icon stack */}
                    <div className="relative flex-shrink-0">
                      <div
                        className={`w-9 h-9 rounded-xl bg-gradient-to-br ${cat.gradient} flex items-center justify-center shadow-sm`}
                        style={{ boxShadow: `0 2px 10px ${cat.color}40` }}
                      >
                        <span style={{ fontSize: 17 }}>{cat.icon}</span>
                      </div>
                    </div>

                    {/* Name + count */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-foreground font-bold text-[13px] leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                          {cat.label}
                        </span>
                        {cat.hot && (
                          <span className="flex items-center gap-0.5 bg-red-500/15 text-red-400 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
                            <Flame size={7} />HOT
                          </span>
                        )}
                        {cat.isNew && (
                          <span className="bg-emerald-500/15 text-emerald-400 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">NEW</span>
                        )}
                      </div>
                      <span className="text-muted-foreground/60 text-[11px] mt-0.5 block">{cat.count} games</span>
                    </div>

                    {/* Right arrow */}
                    <ChevronRight size={14} className="text-muted-foreground/40 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* ── Language ─────────────────────────────────── */}
          <div className="px-4 mt-2">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" style={{ boxShadow: "0 0 6px #818cf8" }} />
              <span className="text-foreground font-black text-base tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>LANGUAGE</span>
              <span className="flex-1 h-px bg-gradient-to-r from-indigo-400/30 to-transparent" />
            </div>

            <button
              onClick={() => setLangOpen((v) => !v)}
              className="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl bg-white/4 text-left"
            >
              <span className="text-xl">{currentLang.flag}</span>
              <span className="flex-1 text-foreground font-bold text-sm">{currentLang.label}</span>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${langOpen ? "rotate-180" : ""}`} />
            </button>

            {langOpen && (
              <div className="mt-1.5 rounded-2xl overflow-hidden border border-border bg-card">
                {LANGUAGES.map((l, i) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary text-left ${i < LANGUAGES.length - 1 ? "border-b border-border" : ""} ${lang === l.code ? "bg-primary/8" : ""}`}
                  >
                    <span className="text-lg">{l.flag}</span>
                    <span className={`text-sm font-bold flex-1 ${lang === l.code ? "text-primary" : "text-foreground"}`}>{l.label}</span>
                    {lang === l.code && <CheckCircle2 size={13} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Customer Support ─────────────────────────── */}
          <div className="px-4 mt-4 mb-1">
            <button className="w-full flex items-center gap-3 py-3 px-3.5 rounded-2xl border border-emerald-900/30 bg-emerald-950/20 hover:border-emerald-800/50 transition-all">
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow shadow-amber-500/20">
                <Headphones size={16} className="text-primary-foreground" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-foreground font-bold text-sm leading-none">Customer Support</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-emerald-400 text-[11px] font-semibold">Live · 24/7</p>
                </div>
              </div>
              <ChevronRight size={14} className="text-muted-foreground/50" />
            </button>
          </div>

        </div>
      )}

    </div>
  );
}

// ─── Bingo Page ───────────────────────────────────────────────────────────────

// ─── Bingo / Perya Page data ──────────────────────────────────────────────────

const PERYA_MAIN = [
  {
    id: "bingo",       label: "BINGO",        sub: "75 & 90 Ball",      emoji: "🎱",
    players: 2841, prize: "₱500,000",
    bg: ["#4c0091","#7c3aed","#a855f7"],   glow: "#a855f7",
    tag: "JACKPOT",   tagBg: "#FFB800",   tagFg: "#000",
    stars: true,
  },
  {
    id: "colorgame",   label: "COLOR GAME",   sub: "Paborito sa Perya", emoji: "🎨",
    players: 1509, prize: "30×",
    bg: ["#b91c1c","#ea580c","#f59e0b"],   glow: "#f59e0b",
    tag: "PERYA HIT",  tagBg: "#f97316",   tagFg: "#fff",
    stars: false,
  },
  {
    id: "dropball",    label: "DROP BALL",    sub: "Plinko-Style",      emoji: "🔴",
    players: 876,  prize: "50×",
    bg: ["#065f46","#059669","#34d399"],   glow: "#34d399",
    tag: "TRENDING",  tagBg: "#10b981",   tagFg: "#000",
    stars: false,
  },
  {
    id: "perya",       label: "PERYA LIVE",   sub: "Carnival Live Table", emoji: "🎡",
    players: 2204, prize: "100×",
    bg: ["#6b21a8","#c026d3","#f97316"],   glow: "#f97316",
    tag: "FIESTA",    tagBg: "#ec4899",   tagFg: "#fff",
    stars: false,
  },
  {
    id: "pulaputi",    label: "PULA PUTI",    sub: "Red or White",      emoji: "🃏",
    players: 3102, prize: "2×",
    bg: ["#7f1d1d","#dc2626","#f87171"],   glow: "#f87171",
    tag: "MOST PLAYED",tagBg: "#ef4444",   tagFg: "#fff",
    stars: false,
  },
];

const PERYA_GRID = [
  { id: "swertres", label: "Swertres",    emoji: "3️⃣",  players: 654,  bg: ["#1e3a8a","#3b82f6"], tag: "Numbers" },
  { id: "stl",      label: "STL Pares",   emoji: "🎯",  players: 449,  bg: ["#134e4a","#0d9488"], tag: "Local" },
  { id: "lasttwo",  label: "Last Two",    emoji: "🎰",  players: 321,  bg: ["#78350f","#d97706"], tag: "Pick 2" },
  { id: "keno",     label: "Keno PH",     emoji: "🔢",  players: 512,  bg: ["#4c1d95","#8b5cf6"], tag: "Pick 10" },
  { id: "sabong",   label: "E-Sabong",    emoji: "🐓",  players: 1890, bg: ["#7f1d1d","#dc2626"], tag: "LIVE" },
  { id: "jaialai",  label: "Jai Alai",    emoji: "🏟️", players: 210,  bg: ["#1e293b","#475569"], tag: "Revival" },
];

const PERYA_WINNERS = [
  { name: "M***a", game: "Bingo 90",   amount: "₱91,000" },
  { name: "R***o", game: "Color Game", amount: "₱12,600" },
  { name: "J***n", game: "Pula Puti",  amount: "₱8,200"  },
  { name: "A***y", game: "Drop Ball",  amount: "₱25,500" },
  { name: "C***e", game: "Bingo 75",   amount: "₱48,000" },
  { name: "B***g", game: "STL Pares",  amount: "₱6,800"  },
];

// Tiny bunting flag SVG strip for carnival feel
function BuntingStrip({ colors }: { colors: string[] }) {
  const flags = [...colors, ...colors, ...colors];
  return (
    <div className="flex items-end justify-start gap-0 overflow-hidden" style={{ height: 18 }}>
      {flags.map((c, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
          <polygon points="0,0 18,0 9,18" fill={c} opacity="0.85" />
        </svg>
      ))}
    </div>
  );
}

function BingoPage({ openWallet }: { openWallet: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto pb-20" style={{ scrollbarWidth: "none" }}>

      {/* ── Carnival hero ─────────────────────────────────── */}
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(155deg,#12003a 0%,#4a0a80 22%,#8c1a00 58%,#1a0800 100%)", minHeight: 240 }}>

        {/* Ambient glow layers */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 85% 90%, rgba(255,150,0,0.32) 0%, transparent 50%), radial-gradient(ellipse at 10% 20%, rgba(168,85,247,0.22) 0%, transparent 48%)" }} />

        {/* ── Lanterns / balloons strip at top ── */}
        <svg className="absolute top-0 left-0 w-full" height="42" viewBox="0 0 430 42" preserveAspectRatio="none" style={{ opacity: 0.82 }}>
          <path d="M0 8 Q54 22 108 8 Q162 -6 216 8 Q270 22 324 8 Q378 -6 430 8" stroke="#FFB800" strokeWidth="0.8" fill="none" opacity="0.35" />
          {([32,76,124,172,220,268,316,362,406] as number[]).map((x, i) => {
            const clrs = ["#ec4899","#f97316","#FFB800","#34d399","#60a5fa","#a855f7","#ef4444","#ec4899","#34d399"];
            const cy = 22 + (i % 2 === 0 ? -4 : 4);
            return (
              <g key={i}>
                <ellipse cx={x} cy={cy} rx="8" ry="10" fill={clrs[i % clrs.length]} />
                <ellipse cx={x} cy={cy-3} rx="3.5" ry="4" fill="rgba(255,255,255,0.18)" />
                <rect x={x-1} y={cy-10} width="2" height="5" fill="#FFB800" opacity="0.55" />
              </g>
            );
          })}
        </svg>

        {/* ── RIGHT SIDE: Festive scene — float + two dancers + fireworks ── */}
        <svg className="absolute right-0 bottom-0" width="218" height="238" viewBox="0 0 218 238" fill="none">

          {/* Firework burst top-right */}
          {([0,30,60,90,120,150,180,210,240,270,300,330] as number[]).map((deg,i) => {
            const rad=deg*Math.PI/180, r1=8, r2=24+(i%3)*5;
            return <line key={i} x1={182+r1*Math.cos(rad)} y1={18+r1*Math.sin(rad)} x2={182+r2*Math.cos(rad)} y2={18+r2*Math.sin(rad)} stroke={["#FFB800","#ec4899","#f97316","#a855f7"][i%4]} strokeWidth="2" strokeLinecap="round" opacity="0.88"/>;
          })}
          <circle cx="182" cy="18" r="6" fill="#FFB800"/>

          {/* Small firework mid */}
          {([0,45,90,135,180,225,270,315] as number[]).map((deg,i) => {
            const rad=deg*Math.PI/180;
            return <line key={i} x1={202+5*Math.cos(rad)} y1={58+5*Math.sin(rad)} x2={202+15*Math.cos(rad)} y2={58+15*Math.sin(rad)} stroke={["#34d399","#60a5fa","#FFB800","#ec4899"][i%4]} strokeWidth="1.5" strokeLinecap="round" opacity="0.72"/>;
          })}
          <circle cx="202" cy="58" r="4" fill="#34d399"/>

          {/* Balloons cluster */}
          <circle cx="20" cy="52" r="12" fill="#ec4899" opacity="0.88"/>
          <ellipse cx="17" cy="46" rx="3.5" ry="4" fill="rgba(255,255,255,0.2)"/>
          <path d="M20 64 Q18 73 20 79" stroke="#ec4899" strokeWidth="1.2" fill="none" opacity="0.55"/>
          <circle cx="42" cy="40" r="11" fill="#FFB800" opacity="0.9"/>
          <ellipse cx="39" cy="34" rx="3" ry="3.5" fill="rgba(255,255,255,0.2)"/>
          <path d="M42 51 Q40 60 42 66" stroke="#FFB800" strokeWidth="1.2" fill="none" opacity="0.55"/>
          <circle cx="62" cy="48" r="10" fill="#a855f7" opacity="0.85"/>
          <ellipse cx="59" cy="43" rx="3" ry="3.5" fill="rgba(255,255,255,0.2)"/>
          <path d="M62 58 Q60 66 62 72" stroke="#a855f7" strokeWidth="1.2" fill="none" opacity="0.55"/>

          {/* ══ FLOAT CENTERPIECE STRUCTURE ══ */}

          {/* Sunburst crown at apex */}
          {([0,22.5,45,67.5,90,112.5,135,157.5,180,202.5,225,247.5,270,292.5,315,337.5] as number[]).map((deg,i) => {
            const rad=deg*Math.PI/180, r1=8, r2=i%2===0?22:15;
            return <line key={i} x1={109+r1*Math.cos(rad)} y1={26+r1*Math.sin(rad)} x2={109+r2*Math.cos(rad)} y2={26+r2*Math.sin(rad)} stroke={i%2===0?"#FFB800":"#f97316"} strokeWidth="2.5" opacity="0.92"/>;
          })}
          <circle cx="109" cy="26" r="9" fill="#FFB800"/>
          <circle cx="109" cy="26" r="5" fill="#fff" opacity="0.6"/>

          {/* Arch from col tops curving to crown */}
          <path d="M66 62 Q88 30 109 22 Q130 30 152 62" stroke="#ec4899" strokeWidth="4.5" fill="none" strokeLinecap="round"/>
          <path d="M66 62 Q88 30 109 22 Q130 30 152 62" stroke="#FFB800" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="5 4"/>
          {/* Crown teeth along arch */}
          {([{x:74,y:52},{x:91,y:38},{x:109,y:30},{x:127,y:38},{x:144,y:52}] as {x:number,y:number}[]).map((p,i) => (
            <polygon key={i} points={`${p.x-4},${p.y+10} ${p.x},${p.y} ${p.x+4},${p.y+10}`} fill={i%2===0?"#FFB800":"#ec4899"}/>
          ))}
          {/* Rose medallions at arch feet */}
          <circle cx="66" cy="62" r="9" fill="#ec4899"/><circle cx="66" cy="62" r="4.5" fill="#FFB800"/>
          <circle cx="152" cy="62" r="9" fill="#ec4899"/><circle cx="152" cy="62" r="4.5" fill="#FFB800"/>

          {/* Left column */}
          <rect x="62" y="62" width="10" height="100" rx="3" fill="#d4870a"/>
          <rect x="64" y="62" width="3" height="100" fill="rgba(255,228,80,0.28)"/>
          {([80,100,120,140] as number[]).map(y => <rect key={y} x="60" y={y} width="14" height="5" rx="2" fill="#FFB800"/>)}

          {/* Right column */}
          <rect x="146" y="62" width="10" height="100" rx="3" fill="#d4870a"/>
          <rect x="148" y="62" width="3" height="100" fill="rgba(255,228,80,0.28)"/>
          {([80,100,120,140] as number[]).map(y => <rect key={y} x="144" y={y} width="14" height="5" rx="2" fill="#FFB800"/>)}

          {/* Garland swags between columns (3 layers) */}
          <path d="M72 68 Q90 96 109 80 Q128 96 146 68" stroke="#ec4899" strokeWidth="2.5" fill="none" opacity="0.92"/>
          <circle cx="109" cy="80" r="5.5" fill="#ec4899"/><circle cx="109" cy="80" r="2.5" fill="#FFB800"/>
          <circle cx="90" cy="88" r="3" fill="#f97316" opacity="0.8"/>
          <circle cx="128" cy="88" r="3" fill="#f97316" opacity="0.8"/>

          <path d="M72 86 Q90 116 109 98 Q128 116 146 86" stroke="#34d399" strokeWidth="2" fill="none" opacity="0.82"/>
          <circle cx="109" cy="98" r="5" fill="#34d399"/><circle cx="109" cy="98" r="2.5" fill="#FFB800"/>

          <path d="M72 106 Q90 134 109 116 Q128 134 146 106" stroke="#60a5fa" strokeWidth="1.8" fill="none" opacity="0.72"/>
          <circle cx="109" cy="116" r="4" fill="#60a5fa"/><circle cx="109" cy="116" r="2" fill="#fff" opacity="0.7"/>

          {/* Mini pennants on columns */}
          <polygon points="72,68 86,74 72,80" fill="#ec4899" opacity="0.92"/>
          <polygon points="72,80 86,86 72,92" fill="#f97316" opacity="0.85"/>
          <polygon points="146,68 132,74 146,80" fill="#a855f7" opacity="0.92"/>
          <polygon points="146,80 132,86 146,92" fill="#FFB800" opacity="0.85"/>

          {/* ══ FLOAT BODY ══ */}
          {/* Scalloped canopy top edge */}
          <path d="M4 163 Q17 148 30 163 Q43 148 56 163 Q69 148 82 163 Q95 148 108 163 Q121 148 134 163 Q147 148 160 163 Q173 148 186 163 Q199 148 212 163" stroke="#ec4899" strokeWidth="4" fill="none"/>
          <path d="M4 163 Q17 148 30 163 Q43 148 56 163 Q69 148 82 163 Q95 148 108 163 Q121 148 134 163 Q147 148 160 163 Q173 148 186 163 Q199 148 212 163" fill="#ec4899" opacity="0.22"/>

          {/* Body */}
          <rect x="4" y="163" width="210" height="38" rx="8" fill="#FFB800"/>

          {/* Body panels */}
          <rect x="11" y="169" width="36" height="26" rx="4" fill="#ec4899" opacity="0.88"/>
          <rect x="54" y="169" width="36" height="26" rx="4" fill="#a855f7" opacity="0.88"/>
          <rect x="97" y="169" width="20" height="26" rx="4" fill="#f97316" opacity="0.8"/>
          <rect x="122" y="169" width="20" height="26" rx="4" fill="#f97316" opacity="0.8"/>
          <rect x="148" y="169" width="36" height="26" rx="4" fill="#a855f7" opacity="0.88"/>
          <rect x="190" y="169" width="20" height="26" rx="4" fill="#ec4899" opacity="0.88"/>
          <text x="15" y="187" fontSize="14" fill="#fff" opacity="0.95">★</text>
          <text x="60" y="187" fontSize="14" fill="#FFB800">★</text>
          <text x="153" y="187" fontSize="14" fill="#FFB800">★</text>
          <text x="194" y="187" fontSize="14" fill="#fff">★</text>

          {/* Tassels */}
          {([8,18,28,38,48,58,68,78,88,98,108,118,128,138,148,158,168,178,188,198,208] as number[]).map((x,i) => (
            <line key={i} x1={x} y1="163" x2={x} y2={169+i%3*3} stroke={["#FFB800","#ec4899","#fff"][i%3]} strokeWidth="2" opacity="0.72"/>
          ))}

          {/* Chassis bar */}
          <rect x="18" y="199" width="182" height="10" rx="3" fill="#c07000"/>

          {/* Wheels */}
          <circle cx="42" cy="215" r="19" fill="#1a0040" stroke="#FFB800" strokeWidth="3.5"/>
          <circle cx="42" cy="215" r="9" fill="#FFB800"/>
          <line x1="42" y1="196" x2="42" y2="234" stroke="#c07000" strokeWidth="2.5"/>
          <line x1="23" y1="215" x2="61" y2="215" stroke="#c07000" strokeWidth="2.5"/>
          <circle cx="176" cy="215" r="19" fill="#1a0040" stroke="#FFB800" strokeWidth="3.5"/>
          <circle cx="176" cy="215" r="9" fill="#FFB800"/>
          <line x1="176" y1="196" x2="176" y2="234" stroke="#c07000" strokeWidth="2.5"/>
          <line x1="157" y1="215" x2="195" y2="215" stroke="#c07000" strokeWidth="2.5"/>

          {/* ══ 4 SMALL CELEBRATORY FIGURES ══ */}
          {/* Each figure ~30px tall. Feet at y=198, head at y=158 */}

          {/* Figure L1 — pink, x=14 */}
          <ellipse cx="12" cy="150" rx="2" ry="6" fill="#ec4899" opacity="0.9" transform="rotate(-16 12 150)"/>
          <ellipse cx="14" cy="148" rx="2" ry="7" fill="#FFB800" opacity="0.95"/>
          <ellipse cx="16" cy="150" rx="2" ry="6" fill="#f97316" opacity="0.9" transform="rotate(16 16 150)"/>
          <circle cx="14" cy="158" r="6.5" fill="#f5c5a3"/>
          <path d="M8 164 Q14 160 20 164 L21 174 Q14 177 7 174Z" fill="#ec4899"/>
          <path d="M7 174 Q2 185 3 196 L25 196 Q26 185 21 174 Q14 176 7 174Z" fill="#f97316"/>
          <line x1="8" y1="167" x2="1" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="20" y1="167" x2="27" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>

          {/* Figure L2 — purple, x=44 */}
          <ellipse cx="42" cy="148" rx="2" ry="6" fill="#a855f7" opacity="0.9" transform="rotate(-12 42 148)"/>
          <ellipse cx="44" cy="146" rx="2" ry="7" fill="#FFB800" opacity="0.95"/>
          <ellipse cx="46" cy="148" rx="2" ry="6" fill="#ec4899" opacity="0.9" transform="rotate(12 46 148)"/>
          <circle cx="44" cy="157" r="6.5" fill="#f5c5a3"/>
          <path d="M38 163 Q44 159 50 163 L51 173 Q44 176 37 173Z" fill="#a855f7"/>
          <path d="M37 173 Q32 184 33 195 L55 195 Q56 184 51 173 Q44 175 37 173Z" fill="#ec4899"/>
          <line x1="38" y1="166" x2="30" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="50" y1="166" x2="58" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>

          {/* Figure R1 — green, x=174 */}
          <ellipse cx="172" cy="148" rx="2" ry="6" fill="#34d399" opacity="0.9" transform="rotate(-12 172 148)"/>
          <ellipse cx="174" cy="146" rx="2" ry="7" fill="#FFB800" opacity="0.95"/>
          <ellipse cx="176" cy="148" rx="2" ry="6" fill="#f97316" opacity="0.9" transform="rotate(12 176 148)"/>
          <circle cx="174" cy="157" r="6.5" fill="#f5c5a3"/>
          <path d="M168 163 Q174 159 180 163 L181 173 Q174 176 167 173Z" fill="#34d399"/>
          <path d="M167 173 Q162 184 163 195 L185 195 Q186 184 181 173 Q174 175 167 173Z" fill="#FFB800"/>
          <line x1="168" y1="166" x2="160" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="180" y1="166" x2="188" y2="154" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>

          {/* Figure R2 — blue, x=204 */}
          <ellipse cx="202" cy="150" rx="2" ry="6" fill="#60a5fa" opacity="0.9" transform="rotate(-16 202 150)"/>
          <ellipse cx="204" cy="148" rx="2" ry="7" fill="#FFB800" opacity="0.95"/>
          <ellipse cx="206" cy="150" rx="2" ry="6" fill="#a855f7" opacity="0.9" transform="rotate(16 206 150)"/>
          <circle cx="204" cy="158" r="6.5" fill="#f5c5a3"/>
          <path d="M198 164 Q204 160 210 164 L211 174 Q204 177 197 174Z" fill="#60a5fa"/>
          <path d="M197 174 Q192 185 193 196 L215 196 Q216 185 211 174 Q204 176 197 174Z" fill="#a855f7"/>
          <line x1="198" y1="167" x2="191" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="210" y1="167" x2="217" y2="155" stroke="#f5c5a3" strokeWidth="3.5" strokeLinecap="round"/>

          {/* Confetti bits */}
          <rect x="6"   y="138" width="5" height="3" rx="1" fill="#FFB800" opacity="0.72" transform="rotate(30 6 138)"/>
          <rect x="58"  y="130" width="4" height="4" rx="1" fill="#ec4899" opacity="0.65" transform="rotate(-20 58 130)"/>
          <rect x="153" y="128" width="5" height="3" rx="1" fill="#34d399" opacity="0.62" transform="rotate(48 153 128)"/>
          <rect x="158" y="146" width="4" height="4" rx="1" fill="#60a5fa" opacity="0.65" transform="rotate(15 158 146)"/>
          <rect x="96"  y="148" width="5" height="3" rx="1" fill="#f97316" opacity="0.6" transform="rotate(-35 96 148)"/>
        </svg>

        {/* Confetti left side */}
        {([
          { top: 48, left: 12, w: 6, h: 3, color: "#FFB800", rot: 25 },
          { top: 78, left: 28, w: 4, h: 4, color: "#ec4899", rot: -20 },
          { top: 60, left: 68, w: 5, h: 2, color: "#34d399", rot: 45 },
          { top: 110, left: 18, w: 3, h: 6, color: "#60a5fa", rot: 10 },
          { top: 140, left: 8,  w: 4, h: 4, color: "#f97316", rot: -35 },
          { top: 165, left: 22, w: 6, h: 3, color: "#a855f7", rot: 15 },
        ] as {top:number,left:number,w:number,h:number,color:string,rot:number}[]).map((s, i) => (
          <div key={i} className="absolute rounded-sm opacity-55 pointer-events-none"
            style={{ top: s.top, left: s.left, width: s.w, height: s.h, background: s.color, transform: `rotate(${s.rot}deg)` }} />
        ))}

        <div className="px-4 pt-12 pb-5 relative" style={{ maxWidth: "50%" }}>
          <p className="text-amber-300 text-[10px] font-black uppercase tracking-widest mb-1">🎪 Philippine Carnival</p>
          <h1 className="font-black leading-none mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "2.6rem", textShadow: "0 2px 20px rgba(168,85,247,0.6)" }}>
            <span className="text-white">PERYA</span>{" "}
            <span className="text-primary">&</span>{" "}
            <span style={{ color: "#ec4899" }}>BINGO</span>
          </h1>
          <p className="text-white/40 text-xs leading-relaxed">
            Laruin ang paboritong laro ng Pilipino — anytime, anywhere!
          </p>

          {/* Winners ticker */}
          <div className="flex items-center gap-2 mt-4 bg-black/35 rounded-xl px-3 py-2 overflow-hidden" style={{ border: "1px solid rgba(255,184,0,0.14)" }}>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Trophy size={11} className="text-primary" />
              <span className="text-primary text-[10px] font-black uppercase tracking-wide">Winners</span>
            </div>
            <div className="w-px h-3 bg-white/10 flex-shrink-0" />
            <div className="overflow-hidden flex-1">
              <div className="flex gap-5 animate-[marquee_16s_linear_infinite] whitespace-nowrap">
                {[...PERYA_WINNERS, ...PERYA_WINNERS].map((w, i) => (
                  <span key={i} className="text-[11px] flex-shrink-0">
                    <span className="text-primary font-bold">{w.name}</span>
                    <span className="text-white/40"> won </span>
                    <span className="text-emerald-400 font-bold">{w.amount}</span>
                    <span className="text-white/25"> · {w.game}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bunting only */}
        <div style={{ transform: "rotate(180deg)" }}>
          <BuntingStrip colors={["#ef4444","#a855f7","#FFB800","#34d399","#ec4899","#60a5fa","#f97316","#FFB800"]} />
        </div>
      </div>

      {/* ── Jackpot bar ───────────────────────────────────── */}
      <div
        className="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center gap-3"
        style={{ background: "linear-gradient(90deg,#2d1800,#1a0d40)", border: "1px solid rgba(255,184,0,0.25)", boxShadow: "0 4px 20px rgba(255,184,0,0.12)" }}
      >
        <span className="text-2xl">🏆</span>
        <div className="flex-1">
          <p className="text-primary text-[10px] font-black uppercase tracking-widest leading-none">Today's Jackpot</p>
          <p className="text-white font-black text-xl leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>₱ 1,200,000</p>
        </div>
        <button onClick={openWallet} className="bg-primary text-primary-foreground font-black text-xs px-4 py-2 rounded-xl shadow shadow-amber-500/25 flex-shrink-0">
          JOIN NOW
        </button>
      </div>

      {/* ── Main games — large feature cards ─────────────── */}
      <div className="px-4 mt-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎪</span>
          <h2 className="text-white font-black text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>SIGNATURE GAMES</h2>
        </div>

        {/* 2-col unequal grid — first card tall, rest 2×2 */}
        <div className="grid grid-cols-2 gap-3">
          {/* Hero card — spans full width */}
          {(() => {
            const g = PERYA_MAIN[0];
            return (
              <button key={g.id} className="col-span-2 relative rounded-3xl overflow-hidden h-40 text-left active:scale-[0.98] transition-transform" style={{ boxShadow: `0 6px 28px ${g.glow}33` }}>
                <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,${g.bg[0]},${g.bg[1]},${g.bg[2]})` }} />
                {/* star sprinkles */}
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="absolute rounded-full"
                    style={{ width: 3+i%3, height: 3+i%3, background: "#fff", opacity: 0.15+i*0.04,
                      top: `${10+i*14}%`, left: `${55+i*7}%` }} />
                ))}
                <div className="absolute inset-0 p-4 flex items-center gap-4">
                  <div>
                    {/* tag */}
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full mb-2 inline-block" style={{ background: g.tagBg, color: g.tagFg }}>{g.tag}</span>
                    <h3 className="text-white font-black leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.7rem" }}>{g.label}</h3>
                    <p className="text-white/60 text-xs font-semibold mt-0.5">{g.sub}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-white/60 text-[11px]">{g.players.toLocaleString()} playing</span>
                      </div>
                      <span className="font-black text-base" style={{ color: g.glow, fontFamily: "'Barlow Condensed', sans-serif" }}>{g.prize}</span>
                    </div>
                  </div>
                  <div className="ml-auto text-6xl opacity-90">{g.emoji}</div>
                </div>
              </button>
            );
          })()}

          {/* Remaining 3 games — in a 2-col grid, first one spans oddly */}
          {PERYA_MAIN.slice(1).map((g, idx) => (
            <button key={g.id} className="relative rounded-3xl overflow-hidden h-36 text-left active:scale-[0.98] transition-transform" style={{ boxShadow: `0 4px 20px ${g.glow}25` }}>
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,${g.bg[0]},${g.bg[1]},${g.bg[2]})` }} />
              {/* decorative orb */}
              <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-20" style={{ background: g.glow }} />
              <div className="absolute inset-0 p-3.5 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: g.tagBg, color: g.tagFg }}>{g.tag}</span>
                  <span className="text-3xl">{g.emoji}</span>
                </div>
                <div>
                  <h3 className="text-white font-black leading-none text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{g.label}</h3>
                  <p className="text-white/50 text-[10px] mt-0.5">{g.sub}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-white/50 text-[10px]">{g.players.toLocaleString()}</span>
                    </div>
                    <span className="font-black text-sm" style={{ color: g.glow, fontFamily: "'Barlow Condensed', sans-serif" }}>{g.prize}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── More Pinoy games — 3-col icon grid ───────────── */}
      <div className="px-4 mt-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎡</span>
          <h2 className="text-white font-black text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>MORE PINOY GAMES</h2>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {PERYA_GRID.map((g) => (
            <button key={g.id} className="relative rounded-2xl overflow-hidden h-24 text-left active:scale-95 transition-transform">
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,${g.bg[0]},${g.bg[1]})` }} />
              <div className="absolute inset-0 flex flex-col justify-between p-2.5">
                <div className="flex justify-between items-start">
                  <span className="text-[8px] font-black bg-black/30 text-white/70 px-1.5 py-0.5 rounded-full leading-none">{g.tag}</span>
                  <span style={{ fontSize: 22 }}>{g.emoji}</span>
                </div>
                <div>
                  <p className="text-white font-black text-xs leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{g.label}</p>
                  <p className="text-white/40 text-[9px] mt-0.5">{g.players.toLocaleString()} online</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Carnival-style promo strip ────────────────────── */}
      <div className="mx-4 mt-5 rounded-2xl overflow-hidden relative" style={{ background: "linear-gradient(135deg,#1a004a,#3b0020)", border: "1px solid rgba(236,72,153,0.2)" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 50%, rgba(236,72,153,0.12) 0%, transparent 65%)" }} />
        {/* mini bunting top */}
        <div className="absolute top-0 inset-x-0 overflow-hidden" style={{ height: 8 }}>
          {["#FFB800","#ec4899","#34d399","#60a5fa","#f97316","#a855f7","#FFB800","#ef4444","#FFB800","#ec4899","#34d399","#60a5fa","#f97316","#a855f7","#FFB800","#ef4444"].map((c, i) => (
            <span key={i} className="inline-block" style={{ width: 14, height: 8, background: c, clipPath: "polygon(0 0,100% 0,50% 100%)", opacity: 0.8 }} />
          ))}
        </div>
        <div className="relative px-4 pt-5 pb-4 flex items-center gap-3">
          <div className="text-4xl">🎉</div>
          <div className="flex-1">
            <p className="text-pink-300 text-[10px] font-black uppercase tracking-widest">Fiesta Special</p>
            <p className="text-white font-black text-lg leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>DAILY FREE BINGO<br /><span className="text-primary">Every 6PM</span></p>
          </div>
          <button onClick={openWallet} className="flex-shrink-0 bg-pink-500 hover:bg-pink-400 text-white font-black text-xs px-4 py-2.5 rounded-xl transition-colors shadow shadow-pink-500/30">
            LIBRE!
          </button>
        </div>
      </div>

      {/* ── Providers ─────────────────────────────────────── */}
      <div className="px-4 mt-5 mb-4">
        <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-black mb-3">Powered by</p>
        <div className="flex gap-2 flex-wrap">
          {["JILI","EVOLUTION","BGAMING","PRAGMATIC","SPRIBE","BINGO+"].map((p) => (
            <span key={p} className="text-[10px] font-black text-muted-foreground bg-secondary px-3 py-1.5 rounded-full border border-border">{p}</span>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Wallet Modal Data ────────────────────────────────────────────────────────

const FIAT_DEPOSIT = [
  { id: "gcash", name: "GCash", icon: "💙", color: "from-blue-500 to-blue-700", tag: "Instant" },
  { id: "maya", name: "Maya", icon: "💚", color: "from-green-500 to-emerald-600", tag: "Instant" },
  { id: "bdo", name: "BDO Bank", icon: "🏦", color: "from-blue-800 to-blue-900", tag: "1–3 hrs" },
  { id: "bpi", name: "BPI Bank", icon: "🏛️", color: "from-red-700 to-red-900", tag: "1–3 hrs" },
  { id: "711", name: "7-Eleven", icon: "🏪", color: "from-orange-500 to-red-600", tag: "OTC" },
  { id: "coins", name: "Coins.ph", icon: "🪙", color: "from-yellow-500 to-amber-600", tag: "Instant" },
];

const CRYPTO_DEPOSIT = [
  { id: "usdt-trc", name: "USDT", icon: "₮", color: "from-teal-500 to-emerald-600", tag: "TRC20" },
  { id: "usdt-erc", name: "USDT", icon: "₮", color: "from-indigo-500 to-blue-700", tag: "ERC20" },
  { id: "ton", name: "TON", icon: "💎", color: "from-sky-400 to-blue-600", tag: "TON" },
  { id: "btc", name: "Bitcoin", icon: "₿", color: "from-orange-400 to-amber-600", tag: "BTC" },
  { id: "eth", name: "Ethereum", icon: "Ξ", color: "from-purple-500 to-indigo-700", tag: "ETH" },
  { id: "bnb", name: "BNB", icon: "◈", color: "from-yellow-400 to-yellow-600", tag: "BEP20" },
];

const FIAT_WITHDRAW = [
  { id: "gcash-w", name: "GCash", icon: "💙", color: "from-blue-500 to-blue-700", tag: "Instant" },
  { id: "maya-w", name: "Maya", icon: "💚", color: "from-green-500 to-emerald-600", tag: "Instant" },
  { id: "bdo-w", name: "BDO Bank", icon: "🏦", color: "from-blue-800 to-blue-900", tag: "1–24 hrs" },
  { id: "bpi-w", name: "BPI Bank", icon: "🏛️", color: "from-red-700 to-red-900", tag: "1–24 hrs" },
];

const CRYPTO_WITHDRAW = [
  { id: "usdt-trc-w", name: "USDT", icon: "₮", color: "from-teal-500 to-emerald-600", tag: "TRC20" },
  { id: "usdt-erc-w", name: "USDT", icon: "₮", color: "from-indigo-500 to-blue-700", tag: "ERC20" },
  { id: "ton-w", name: "TON", icon: "💎", color: "from-sky-400 to-blue-600", tag: "TON" },
  { id: "btc-w", name: "Bitcoin", icon: "₿", color: "from-orange-400 to-amber-600", tag: "BTC" },
];

const TX_HISTORY = [
  { id: 1, type: "deposit", method: "GCash", amount: "+₱ 1,000.00", date: "2025-05-22 14:32", status: "success" },
  { id: 2, type: "withdraw", method: "BDO Bank", amount: "−₱ 500.00", date: "2025-05-21 09:15", status: "success" },
  { id: 3, type: "deposit", method: "USDT TRC20", amount: "+21.80 USDT", date: "2025-05-20 18:44", status: "success" },
  { id: 4, type: "withdraw", method: "GCash", amount: "−₱ 200.00", date: "2025-05-19 11:02", status: "pending" },
  { id: 5, type: "deposit", method: "Maya", amount: "+₱ 500.00", date: "2025-05-18 20:11", status: "success" },
  { id: 6, type: "deposit", method: "TON", amount: "+5.00 TON", date: "2025-05-17 16:30", status: "failed" },
];

// ─── Payment Method Grid ──────────────────────────────────────────────────────

function PayMethodGrid({ methods, onSelect, selected }: {
  methods: { id: string; name: string; icon: string; color: string; tag: string }[];
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {methods.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m.id)}
          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all ${
            selected === m.id
              ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
              : "border-border bg-secondary hover:border-white/20"
          }`}
        >
          {/* logo circle */}
          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${m.color} flex items-center justify-center shadow-md`}>
            <span className="text-white font-black" style={{ fontSize: m.icon.length > 1 ? 20 : 22 }}>
              {m.icon}
            </span>
          </div>
          <span className="text-foreground font-bold text-xs leading-tight">{m.name}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
            selected === m.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
          }`}>
            {m.tag}
          </span>
          {selected === m.id && (
            <span className="absolute top-1.5 right-1.5">
              <CheckCircle2 size={13} className="text-primary" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Wallet Modal ─────────────────────────────────────────────────────────────

function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // ALL hooks unconditionally at top — no early returns before this block
  const [tab, setTab] = useState<"deposit" | "withdraw" | "history">("deposit");
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "deposit" | "withdraw">("all");
  const [historyStatus, setHistoryStatus] = useState<"all" | "success" | "pending" | "failed">("all");
  const [bannerIdx, setBannerIdx] = useState(0);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTab("deposit");
      setSelectedMethod(null);
      setAmount("");
      setHistoryFilter("all");
      setHistoryStatus("all");
      setBannerIdx(0);
    }
  }, [open]);

  const isDeposit = tab === "deposit";
  const fiatList = isDeposit ? FIAT_DEPOSIT : FIAT_WITHDRAW;
  const cryptoList = isDeposit ? CRYPTO_DEPOSIT : CRYPTO_WITHDRAW;
  const QUICK = ["100", "500", "1000", "2000", "5000"];

  const BANNERS_WALLET = [
    { gradient: "from-[#1a0533] via-[#4a0e82] to-[#c0392b]", label: "FIRST DEPOSIT BONUS", text: "100% up to ₱50,000", icon: "🎁" },
    { gradient: "from-[#0a2444] via-[#1a4a8a] to-[#0d7b4f]", label: "ZERO FEE CRYPTO", text: "Deposit with 0% fees", icon: "💎" },
  ];

  const statusIcon = (s: string) =>
    s === "success" ? <CheckCircle2 size={14} className="text-emerald-400" /> :
    s === "pending" ? <Loader2 size={14} className="text-yellow-400 animate-spin" /> :
    <AlertCircle size={14} className="text-red-400" />;

  const filteredHistory = TX_HISTORY.filter((tx) => {
    const typeOk = historyFilter === "all" || tx.type === historyFilter;
    const statusOk = historyStatus === "all" || tx.status === historyStatus;
    return typeOk && statusOk;
  });

  // fixed scroll area height — same across all tabs
  const SCROLL_H = "calc(101vh - 260px)";

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Bottom sheet — +10% taller: 92 → ~101 capped at safe max */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-[430px] bg-card rounded-t-3xl flex flex-col"
        style={{ height: "86vh", maxHeight: "86vh" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-2">
            <Wallet size={18} className="text-primary" />
            <span className="text-foreground font-black text-base" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              MY WALLET
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="text-primary">₱ 1,250.00</span>
            <span className="text-white/20">|</span>
            <span className="text-emerald-400">21.80 USDT</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-muted transition-colors">
            <X size={15} className="text-muted-foreground" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex px-5 pt-3 gap-2 flex-shrink-0">
          {([
            { id: "deposit",  label: "Deposit",  icon: <ArrowDownToLine size={14} /> },
            { id: "withdraw", label: "Withdraw", icon: <ArrowUpFromLine size={14} /> },
            { id: "history",  label: "History",  icon: <History size={14} /> },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSelectedMethod(null); setAmount(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow shadow-amber-500/20"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ── Banner (deposit / withdraw only) ──────────────── */}
        {tab !== "history" && (
          <div className="px-5 pt-3 flex-shrink-0">
            <div
              className={`relative rounded-2xl overflow-hidden h-20 bg-gradient-to-br ${BANNERS_WALLET[bannerIdx].gradient} cursor-pointer`}
              onClick={() => setBannerIdx((v) => (v + 1) % BANNERS_WALLET.length)}
            >
              <div className="absolute inset-0 p-3.5 flex items-center justify-between">
                <div>
                  <span className="text-white/60 text-[10px] font-bold uppercase tracking-wider block leading-none mb-1">
                    {BANNERS_WALLET[bannerIdx].label}
                  </span>
                  <span className="text-white font-black text-base leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {BANNERS_WALLET[bannerIdx].text}
                  </span>
                </div>
                <span className="text-4xl">{BANNERS_WALLET[bannerIdx].icon}</span>
              </div>
              {/* dots */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {BANNERS_WALLET.map((_, i) => (
                  <span key={i} className={`h-1 rounded-full transition-all ${i === bannerIdx ? "w-4 bg-white" : "w-1 bg-white/40"}`} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── History filter bar ─────────────────────────────── */}
        {tab === "history" && (
          <div className="px-5 pt-3 space-y-2 flex-shrink-0">
            {/* Type filter */}
            <div className="flex gap-1.5">
              {(["all", "deposit", "withdraw"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-black capitalize transition-colors ${
                    historyFilter === f
                      ? f === "deposit" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : f === "withdraw" ? "bg-red-500/20 text-red-400 border border-red-500/40"
                        : "bg-primary/20 text-primary border border-primary/40"
                      : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
                  }`}
                >
                  {f === "deposit" ? "↓ Deposit" : f === "withdraw" ? "↑ Withdraw" : "All"}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex gap-1.5">
              {(["all", "success", "pending", "failed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setHistoryStatus(s)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors ${
                    historyStatus === s
                      ? s === "success" ? "bg-emerald-500 text-white"
                        : s === "pending" ? "bg-yellow-500 text-black"
                        : s === "failed" ? "bg-red-500 text-white"
                        : "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Scrollable content — fixed height, same across all tabs ── */}
        <div className="overflow-y-auto px-5 pb-8 pt-4 flex-1" style={{ scrollbarWidth: "none" }}>

          {/* Deposit / Withdraw */}
          {tab !== "history" && (
            <div className="space-y-5">
              <div>
                <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-3 h-px bg-border inline-block" />Fiat Currency<span className="flex-1 h-px bg-border inline-block" />
                </p>
                <PayMethodGrid methods={fiatList} onSelect={setSelectedMethod} selected={selectedMethod} />
              </div>
              <div>
                <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-3 h-px bg-border inline-block" />Cryptocurrency<span className="flex-1 h-px bg-border inline-block" />
                </p>
                <PayMethodGrid methods={cryptoList} onSelect={setSelectedMethod} selected={selectedMethod} />
              </div>

              {selectedMethod && (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-3 h-px bg-border inline-block" />
                    {isDeposit ? "Deposit Amount" : "Withdraw Amount"}
                    <span className="flex-1 h-px bg-border inline-block" />
                  </p>
                  {!selectedMethod.includes("usdt") && !selectedMethod.includes("ton") &&
                   !selectedMethod.includes("btc") && !selectedMethod.includes("eth") &&
                   !selectedMethod.includes("bnb") && (
                    <div className="flex gap-2 flex-wrap">
                      {QUICK.map((q) => (
                        <button key={q} onClick={() => setAmount(q)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            amount === q ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}>
                          ₱{q}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-sm">
                      {selectedMethod.includes("usdt") ? "≈ $" : selectedMethod.includes("ton") ? "TON" : selectedMethod.includes("btc") ? "₿" : selectedMethod.includes("eth") ? "Ξ" : selectedMethod.includes("bnb") ? "◈" : "₱"}
                    </span>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                      className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-foreground font-black text-lg focus:outline-none focus:border-primary transition-colors" />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground px-1">
                    <span>Min: {isDeposit ? "₱ 100" : "₱ 200"}</span>
                    <span>Max: {isDeposit ? "₱ 100,000" : "₱ 50,000"}</span>
                  </div>
                  <button className={`w-full py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-2 transition-colors shadow-lg ${
                    isDeposit ? "bg-primary text-primary-foreground hover:bg-yellow-400 shadow-amber-500/20"
                              : "bg-accent text-accent-foreground hover:bg-red-500 shadow-red-500/20"
                  }`}>
                    {isDeposit ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
                    {isDeposit ? "Proceed to Deposit" : "Proceed to Withdraw"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* History */}
          {tab === "history" && (
            <div className="space-y-2">
              {filteredHistory.length === 0 && (
                <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                  <History size={32} className="opacity-30" />
                  <span className="text-sm">No records found</span>
                </div>
              )}
              {filteredHistory.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 bg-secondary rounded-2xl px-4 py-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    tx.type === "deposit" ? "bg-emerald-500/15" : "bg-red-500/15"
                  }`}>
                    {tx.type === "deposit" ? <ArrowDownToLine size={16} className="text-emerald-400" /> : <ArrowUpFromLine size={16} className="text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground font-bold text-sm">{tx.method}</span>
                      <span className={`font-black text-sm ${tx.type === "deposit" ? "text-emerald-400" : "text-red-400"}`}>{tx.amount}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-muted-foreground text-xs">{tx.date}</span>
                      <span className="flex items-center gap-1">
                        {statusIcon(tx.status)}
                        <span className={`text-[11px] font-bold capitalize ${
                          tx.status === "success" ? "text-emerald-400" : tx.status === "pending" ? "text-yellow-400" : "text-red-400"
                        }`}>{tx.status}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {filteredHistory.length > 0 && (
                <button className="w-full py-3 rounded-xl bg-secondary text-muted-foreground text-xs font-bold hover:text-foreground transition-colors flex items-center justify-center gap-1.5 mt-2">
                  Load more <ChevronRightIcon size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Profile Avatar options ────────────────────────────────────────────────────

// Option A — Chibi kawaii tarsier: huge sparkly eyes, rosy cheeks, warm amber bg
function AvatarOptionA() {
  return (
    <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md" style={{ background: "linear-gradient(145deg,#d97706,#fbbf24)" }}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        {/* Ears */}
        <circle cx="7" cy="10" r="6.5" fill="#92400e"/>
        <circle cx="7" cy="10" r="3.8" fill="#c07022" opacity="0.85"/>
        <circle cx="33" cy="10" r="6.5" fill="#92400e"/>
        <circle cx="33" cy="10" r="3.8" fill="#c07022" opacity="0.85"/>
        {/* Head */}
        <circle cx="20" cy="22" r="16" fill="#a16207"/>
        {/* Face disc — lighter */}
        <ellipse cx="20" cy="23" rx="12" ry="11" fill="#ca8a04"/>
        {/* Left eye */}
        <circle cx="13" cy="20" r="6.5" fill="white"/>
        <circle cx="13" cy="20" r="5" fill="#1e1b4b"/>
        <circle cx="13" cy="20" r="3" fill="#0f172a"/>
        <circle cx="11" cy="18" r="2.2" fill="white"/>
        <circle cx="15.5" cy="22.5" r="1" fill="white" opacity="0.6"/>
        <circle cx="9.8" cy="21.5" r="0.7" fill="white" opacity="0.45"/>
        {/* Right eye */}
        <circle cx="27" cy="20" r="6.5" fill="white"/>
        <circle cx="27" cy="20" r="5" fill="#1e1b4b"/>
        <circle cx="27" cy="20" r="3" fill="#0f172a"/>
        <circle cx="25" cy="18" r="2.2" fill="white"/>
        <circle cx="29.5" cy="22.5" r="1" fill="white" opacity="0.6"/>
        <circle cx="23.8" cy="21.5" r="0.7" fill="white" opacity="0.45"/>
        {/* Nose */}
        <ellipse cx="20" cy="26" rx="2" ry="1.4" fill="#78350f"/>
        {/* Smile */}
        <path d="M17.5 28.5 Q20 30.5 22.5 28.5" stroke="#78350f" strokeWidth="1.1" fill="none" strokeLinecap="round"/>
        {/* Rosy cheeks */}
        <circle cx="8" cy="27" r="3.5" fill="#f97316" opacity="0.28"/>
        <circle cx="32" cy="27" r="3.5" fill="#f97316" opacity="0.28"/>
      </svg>
    </div>
  );
}

// Option B — Flat minimalist tarsier: clean geometric on deep navy, icon-app style
function AvatarOptionB() {
  return (
    <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md" style={{ background: "linear-gradient(145deg,#0f172a,#1e3a5f)" }}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        {/* Ears — pointed ovals */}
        <ellipse cx="8" cy="9" rx="5" ry="7" fill="#e2e8f0" opacity="0.92" transform="rotate(-18 8 9)"/>
        <ellipse cx="8" cy="9" rx="2.5" ry="4" fill="#94a3b8" opacity="0.7" transform="rotate(-18 8 9)"/>
        <ellipse cx="32" cy="9" rx="5" ry="7" fill="#e2e8f0" opacity="0.92" transform="rotate(18 32 9)"/>
        <ellipse cx="32" cy="9" rx="2.5" ry="4" fill="#94a3b8" opacity="0.7" transform="rotate(18 32 9)"/>
        {/* Head */}
        <circle cx="20" cy="22" r="15" fill="#e2e8f0" opacity="0.95"/>
        {/* Face disc */}
        <ellipse cx="20" cy="23" rx="11" ry="10" fill="#f8fafc"/>
        {/* Left eye — large flat */}
        <circle cx="13.5" cy="20" r="6.5" fill="#1e3a5f"/>
        <circle cx="13.5" cy="20" r="3.8" fill="#0f172a"/>
        <circle cx="11.5" cy="18" r="2" fill="white" opacity="0.88"/>
        <circle cx="15.5" cy="22" r="0.9" fill="white" opacity="0.55"/>
        {/* Right eye */}
        <circle cx="26.5" cy="20" r="6.5" fill="#1e3a5f"/>
        <circle cx="26.5" cy="20" r="3.8" fill="#0f172a"/>
        <circle cx="24.5" cy="18" r="2" fill="white" opacity="0.88"/>
        <circle cx="28.5" cy="22" r="0.9" fill="white" opacity="0.55"/>
        {/* Nose */}
        <circle cx="20" cy="25.5" r="1.6" fill="#94a3b8"/>
        {/* Body hint */}
        <ellipse cx="20" cy="36" rx="8" ry="5" fill="#e2e8f0" opacity="0.65"/>
      </svg>
    </div>
  );
}

// Option C — Golden emboss tarsier: all amber/gold on dark chocolate, coin-like depth
function AvatarOptionC() {
  return (
    <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md" style={{ background: "linear-gradient(145deg,#1c0a00,#3d1f00)" }}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        {/* Warm glow bg */}
        <circle cx="20" cy="21" r="17" fill="#FFB800" opacity="0.08"/>
        {/* Ears */}
        <circle cx="7" cy="9" r="6.5" fill="#FFB800" opacity="0.88"/>
        <circle cx="7" cy="9" r="3.5" fill="#c07000" opacity="0.75"/>
        <circle cx="33" cy="9" r="6.5" fill="#FFB800" opacity="0.88"/>
        <circle cx="33" cy="9" r="3.5" fill="#c07000" opacity="0.75"/>
        {/* Head */}
        <circle cx="20" cy="22" r="15.5" fill="#FFB800" opacity="0.92"/>
        {/* Face disc */}
        <ellipse cx="20" cy="23" rx="11.5" ry="10.5" fill="#f59e0b" opacity="0.95"/>
        {/* Left eye — ring style */}
        <circle cx="13" cy="20" r="6.5" fill="#1c0a00"/>
        <circle cx="13" cy="20" r="5.8" fill="none" stroke="#FFB800" strokeWidth="1.8"/>
        <circle cx="13" cy="20" r="3.2" fill="#FFB800" opacity="0.95"/>
        <circle cx="11.4" cy="18.4" r="1.3" fill="white" opacity="0.72"/>
        {/* Right eye */}
        <circle cx="27" cy="20" r="6.5" fill="#1c0a00"/>
        <circle cx="27" cy="20" r="5.8" fill="none" stroke="#FFB800" strokeWidth="1.8"/>
        <circle cx="27" cy="20" r="3.2" fill="#FFB800" opacity="0.95"/>
        <circle cx="25.4" cy="18.4" r="1.3" fill="white" opacity="0.72"/>
        {/* Nose */}
        <ellipse cx="20" cy="26.5" rx="2" ry="1.4" fill="#92400e"/>
        {/* Body */}
        <ellipse cx="20" cy="36.5" rx="9" ry="5" fill="#FFB800" opacity="0.68"/>
      </svg>
    </div>
  );
}

// Option D — Neon glow tarsier: dark purple bg, glowing amber eyes, purple outline
function AvatarOptionD() {
  return (
    <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md" style={{ background: "linear-gradient(145deg,#0a0018,#1a0035)" }}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        {/* Glow behind eyes */}
        <circle cx="13" cy="20" r="10" fill="#FFB800" opacity="0.1"/>
        <circle cx="27" cy="20" r="10" fill="#FFB800" opacity="0.1"/>
        {/* Ears — glowing outlines */}
        <circle cx="7" cy="9" r="6.5" fill="#0a0018" stroke="#a855f7" strokeWidth="1.5" opacity="0.9"/>
        <circle cx="7" cy="9" r="3.2" fill="#a855f7" opacity="0.3"/>
        <circle cx="33" cy="9" r="6.5" fill="#0a0018" stroke="#a855f7" strokeWidth="1.5" opacity="0.9"/>
        <circle cx="33" cy="9" r="3.2" fill="#a855f7" opacity="0.3"/>
        {/* Head */}
        <circle cx="20" cy="22" r="15.5" fill="#0d0025" stroke="#a855f7" strokeWidth="1.5" opacity="0.95"/>
        {/* Face disc */}
        <ellipse cx="20" cy="23" rx="11" ry="10" fill="#130030" opacity="0.85"/>
        {/* Left eye — neon glow */}
        <circle cx="13" cy="20" r="6.5" fill="#FFB800" opacity="0.15"/>
        <circle cx="13" cy="20" r="6.5" fill="none" stroke="#FFB800" strokeWidth="1.6"/>
        <circle cx="13" cy="20" r="4" fill="#FFB800" opacity="0.85"/>
        <circle cx="13" cy="20" r="2.2" fill="#fff7ed"/>
        <circle cx="11.4" cy="18.4" r="1.3" fill="white" opacity="0.92"/>
        {/* Right eye */}
        <circle cx="27" cy="20" r="6.5" fill="#FFB800" opacity="0.15"/>
        <circle cx="27" cy="20" r="6.5" fill="none" stroke="#FFB800" strokeWidth="1.6"/>
        <circle cx="27" cy="20" r="4" fill="#FFB800" opacity="0.85"/>
        <circle cx="27" cy="20" r="2.2" fill="#fff7ed"/>
        <circle cx="25.4" cy="18.4" r="1.3" fill="white" opacity="0.92"/>
        {/* Nose */}
        <ellipse cx="20" cy="26.5" rx="1.8" ry="1.2" fill="#a855f7" opacity="0.95"/>
        {/* Body outline */}
        <ellipse cx="20" cy="36.5" rx="9" ry="5" fill="none" stroke="#a855f7" strokeWidth="1.2" opacity="0.55"/>
      </svg>
    </div>
  );
}

// Picker — rendered temporarily so user can choose; swap ProfileAvatar to chosen option
const PROFILE_AVATAR_CHOICE = "A";
function ProfileAvatar() {
  if (PROFILE_AVATAR_CHOICE === "A") return <AvatarOptionA />;
  if (PROFILE_AVATAR_CHOICE === "B") return <AvatarOptionB />;
  if (PROFILE_AVATAR_CHOICE === "D") return <AvatarOptionD />;
  return <AvatarOptionC />;
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeBanner, setActiveBanner] = useState(0);
  const [activeTab, setActiveTab] = useState("all");
  const [activeNav, setActiveNav] = useState("casino");
  const [promoFilter, setPromoFilter] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const openWallet = () => { setWalletOpen(false); setWalletModalOpen(true); };

  const NAV_ITEMS: { id: string; label: string; icon: React.ReactNode; badge?: number; onClick?: () => void }[] = [
    { id: "cashier", label: "Cashier", icon: <Wallet size={20} />, onClick: openWallet },
    { id: "bingo", label: "Bingo", icon: <Dices size={20} /> },
    { id: "bonuses", label: "Bonuses", icon: <Gift size={20} />, badge: 3 },
    { id: "casino", label: "Casino", icon: <Spade size={20} /> },
    { id: "menu", label: "Menu", icon: <Menu size={20} /> },
  ];

  return (
    <div className="flex justify-center items-start min-h-screen bg-[#040609]">
      <div
        className="relative bg-background w-full max-w-[430px] min-h-screen flex flex-col overflow-hidden"
        style={{ fontFamily: "'Nunito', sans-serif" }}
      >

        {/* ── 1. HEADER ──────────────────────────────────────── */}
        <header className="relative flex-shrink-0">
          <div className="flex items-center px-4 pt-5 pb-4 gap-3">

            {/* Logo — always visible, click to go home */}
            <div className="flex-shrink-0 leading-none flex items-baseline cursor-pointer" onClick={() => { setActiveNav("casino"); setProfileOpen(false); setPromoFilter(null); }}>
              <span className="text-white font-black leading-none tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.25rem" }}>TARSIER</span>
              <span className="text-primary font-black leading-none tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.25rem" }}>WIN</span>
            </div>


            {/* Balance + TopUp — no background, just text + pill */}
            <div className="flex-1 flex items-center justify-center gap-3">
              {/* PHP balance — bare text, no container */}
              <button
                className="flex flex-col items-center gap-0.5"
                onClick={() => setWalletOpen((v) => !v)}
              >
                <span className="text-muted-foreground text-[11px] font-semibold flex items-center gap-1 leading-none">
                  PHP
                  <ChevronDown
                    size={11}
                    className={`transition-transform duration-200 ${walletOpen ? "rotate-180" : ""}`}
                  />
                </span>
                <span className="text-white font-black text-base leading-tight">
                  {balanceVisible ? "₱ 1,250.00" : "₱ ••••••"}
                </span>
              </button>

              {/* Top Up pill */}
              <button
                onClick={openWallet}
                className="flex items-center gap-1 bg-primary hover:bg-yellow-400 text-primary-foreground font-black text-sm px-5 py-2 rounded-full transition-colors shadow-lg shadow-amber-500/30 whitespace-nowrap"
              >
                Top up
              </button>
            </div>

            {/* Personal entry — profile avatar */}
            <button className="flex-shrink-0 relative" onClick={() => setProfileOpen(true)}>
              <ProfileAvatar />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-background" />
            </button>
          </div>

          {/* ── Wallet dropdown panel ───────────────────────── */}
          {walletOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setWalletOpen(false)}
              />
              {/* Panel */}
              <div className="absolute left-4 right-4 top-full -mt-1 z-50 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4">
                  <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-3">My Wallet</p>

                  {/* PHP row */}
                  <div className="flex items-center justify-between py-2.5 border-b border-border">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-primary font-black text-sm">₱</span>
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-sm">Philippine Peso</p>
                        <p className="text-muted-foreground text-xs">PHP</p>
                      </div>
                    </div>
                    <span className="text-primary font-black text-base">
                      {balanceVisible ? "1,250.00" : "••••••"}
                    </span>
                  </div>

                  {/* USDT row */}
                  <div className="flex items-center justify-between py-2.5 border-b border-border">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <span className="text-emerald-400 font-black text-sm">₮</span>
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-sm">Tether USD</p>
                        <p className="text-muted-foreground text-xs">USDT · TRC20</p>
                      </div>
                    </div>
                    <span className="text-emerald-400 font-black text-base">
                      {balanceVisible ? "21.80" : "••••"}
                    </span>
                  </div>

                  {/* Bonus row */}
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                        <span className="text-xl">🎁</span>
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-sm">Bonus Balance</p>
                        <p className="text-muted-foreground text-xs">Non-withdrawable</p>
                      </div>
                    </div>
                    <span className="text-violet-400 font-black text-base">
                      {balanceVisible ? "₱ 500.00" : "₱ ••••"}
                    </span>
                  </div>
                </div>

                {/* Toggle visibility + Wallet CTA */}
                <div className="flex gap-2 px-4 pb-4">
                  <button
                    className="flex-1 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-bold hover:text-foreground transition-colors"
                    onClick={() => setBalanceVisible((v) => !v)}
                  >
                    {balanceVisible ? "Hide Balances" : "Show Balances"}
                  </button>
                  <button
                    className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-yellow-400 transition-colors"
                    onClick={openWallet}
                  >
                    <Wallet size={13} />
                    Wallet
                  </button>
                </div>
              </div>
            </>
          )}
        </header>

        {/* ── Scrollable body ─────────────────────────────────── */}
        {profileOpen ? <ProfilePage /> : activeNav === "bonuses" ? <BonusesPage openWallet={openWallet} promoFilter={promoFilter} /> : activeNav === "bingo" ? <BingoPage openWallet={openWallet} /> : activeNav === "menu" ? <MenuPage onSearch={() => setSearchOpen(true)} /> : <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20" style={{ scrollbarWidth: "none" }}>

          {/* ── 2. CATEGORY MENU ──────────────────────────────── */}
          <div className="flex gap-3 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.label}
                className="flex-shrink-0 flex flex-col items-center gap-1.5"
                style={{ paddingTop: 10 }}
                onClick={() => {
                  if (c.nav === "bonuses") {
                    setPromoFilter(c.promo ?? null);
                    setActiveNav("bonuses");
                  }
                }}
              >
                <div
                  className={`relative rounded-2xl bg-gradient-to-br ${c.color} flex flex-col items-center justify-end`}
                  style={{ width: 110, height: 59, boxShadow: "0 4px 18px rgba(0,0,0,0.45)" }}
                >
                  {/* Icon centred */}
                  <div className="flex-1 flex items-center justify-center w-full">
                    <span style={{ fontSize: 36, lineHeight: 1 }}>{c.icon}</span>
                  </div>
                  {/* Flag ribbon — floats outside top-left corner */}
                  {c.badge ? (
                    <div
                      className="absolute flex items-center gap-0.5 bg-red-500 text-white font-black z-10"
                      style={{
                        top: -11,
                        left: 8,
                        fontSize: 11,
                        lineHeight: 1,
                        padding: "4px 7px 4px 5px",
                        borderRadius: "6px 6px 6px 0px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      🔥 {c.badge}
                      {/* downward notch / tail */}
                      <span
                        style={{
                          position: "absolute",
                          bottom: -6,
                          left: 0,
                          width: 0,
                          height: 0,
                          borderLeft: "6px solid #ef4444",
                          borderBottom: "6px solid transparent",
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <span className="text-[12px] text-white/80 font-bold">{c.label}</span>
              </button>
            ))}
          </div>

          {/* ── 3. BANNER ─────────────────────────────────────── */}
          <div className="px-4">
            <div className="relative rounded-2xl overflow-hidden h-56 select-none">
              <div className={`absolute inset-0 bg-gradient-to-br ${BANNERS[activeBanner].gradient}`} />
              <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full bg-white/5" />
              <div className="absolute -bottom-6 -left-6 w-20 h-20 rounded-full bg-white/5" />
              <div className="absolute inset-0 p-4 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BANNERS[activeBanner].badgeColor}`}>
                    {BANNERS[activeBanner].tag}
                  </span>
                  <span className="text-3xl">{BANNERS[activeBanner].badge}</span>
                </div>
                <div>
                  <h2
                    className="text-white font-black leading-tight mb-1 whitespace-pre-line"
                    style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.55rem" }}
                  >
                    {BANNERS[activeBanner].title}
                  </h2>
                  <p className="text-white/70 text-xs">{BANNERS[activeBanner].sub}</p>
                </div>
              </div>
              {/* Dots only — no arrows */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {BANNERS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveBanner(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === activeBanner ? "w-5 bg-white" : "w-1.5 bg-white/40"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ── 4. GAME TABS ──────────────────────────────────── */}
          <div className="flex items-center gap-2 px-4 mt-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <button onClick={() => setSearchOpen(true)} className="flex-shrink-0 w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
              <Search size={15} className="text-muted-foreground" />
            </button>
            {GAME_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                  activeTab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* ── 5. GAME HISTORY ───────────────────────────────── */}
          <section className="mt-5">
            <div className="flex items-center justify-between px-4 mb-3">
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-muted-foreground" />
                <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  GAME HISTORY
                </h3>
              </div>
              <div className="flex gap-1">
                <button className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
                  <ChevronLeft size={13} className="text-muted-foreground" />
                </button>
                <button className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
                  <ChevronRight size={13} className="text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex gap-3 px-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {HISTORY_GAMES.map((g) => (
                <HistoryCard key={g.id} game={g} />
              ))}
            </div>
          </section>

          {/* ── 6. RECENT WINS ────────────────────────────────── */}
          <div className="mx-4 mt-4 bg-secondary rounded-xl p-3 flex items-center gap-2 overflow-hidden">
            <div className="flex-shrink-0 flex items-center gap-1.5 text-primary">
              <Trophy size={13} />
              <span className="text-xs font-bold uppercase tracking-wide whitespace-nowrap">Recent Wins</span>
            </div>
            <div className="w-px h-4 bg-border flex-shrink-0" />
            <div className="overflow-hidden flex-1">
              <div className="flex gap-6 animate-[marquee_18s_linear_infinite] whitespace-nowrap">
                {[...WINNERS, ...WINNERS].map((w, i) => (
                  <span key={i} className="text-xs text-foreground/80 flex-shrink-0">
                    <span className="text-primary font-bold">{w.name}</span>
                    {" won "}
                    <span className="text-emerald-400 font-bold">{w.amount}</span>
                    {" · "}
                    <span className="text-muted-foreground">{w.game}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── 7. POPULAR GAMES ──────────────────────────────── */}
          <section className="mt-5 px-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-primary" />
                <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  POPULAR GAMES
                </h3>
              </div>
              <div className="flex items-center gap-1">
                <button className="bg-secondary/60 text-xs font-bold text-muted-foreground px-3 py-1 rounded-full">All</button>
                <button className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
                  <ChevronLeft size={13} className="text-muted-foreground" />
                </button>
                <button className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center">
                  <ChevronRight size={13} className="text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {POPULAR_GAMES.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          </section>

          {/* ── 8. E-GAMES ZONE ───────────────────────────────── */}
          <section className="mt-6">
            <div className="flex items-center justify-between px-4 mb-3">
              <div className="flex items-center gap-2">
                <Gamepad2 size={15} className="text-violet-400" />
                <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  E-GAMES ZONE
                </h3>
                <span className="bg-violet-500/20 text-violet-300 text-[10px] font-bold px-2 py-0.5 rounded-full">FEATURED</span>
              </div>
              <button className="text-primary text-xs font-bold flex items-center gap-0.5">
                See all <ChevronRight size={12} />
              </button>
            </div>
            <div className="flex gap-3 px-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {EGAMES.map((g) => (
                <EGameCard key={g.id} game={g} />
              ))}
            </div>
          </section>

          {/* ── 9. LIVE GAMES ─────────────────────────────────── */}
          <section className="mt-6">
            <div className="flex items-center justify-between px-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  LIVE GAMES
                </h3>
              </div>
              <button className="text-primary text-xs font-bold flex items-center gap-0.5">
                See all <ChevronRight size={12} />
              </button>
            </div>
            <div className="flex gap-3 px-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {LIVE_GAMES.map((g) => (
                <LiveCard key={g.id} game={g} />
              ))}
            </div>
          </section>

          {/* ── 10. PROVIDERS ─────────────────────────────────── */}
          <section className="mt-6 px-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                GAME PROVIDERS
              </h3>
              <button className="text-primary text-xs font-bold flex items-center gap-0.5">
                All <ChevronRight size={12} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.name}
                  className="rounded-xl bg-secondary border border-border hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-1 py-3"
                >
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center`}>
                    <span className="text-white font-black text-[10px]">{p.abbr}</span>
                  </div>
                  <span className="text-muted-foreground text-[10px] font-bold">{p.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ── 11. CUSTOMER SUPPORT ──────────────────────────── */}
          <div className="mx-4 mt-6 mb-4 bg-gradient-to-r from-secondary to-[#1a2540] rounded-2xl p-4 flex items-center justify-between border border-border">
            <div>
              <p className="text-foreground font-bold text-sm">24/7 Customer Support</p>
              <p className="text-muted-foreground text-xs mt-0.5">Always here for you · Laging handa</p>
            </div>
            <button className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow shadow-amber-500/20">
              <Headphones size={18} className="text-primary-foreground" />
            </button>
          </div>
        </div>}

        {/* ── BOTTOM NAV ────────────────────────────────────── */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card border-t border-border flex items-center justify-around px-2 pt-2 pb-3 z-50">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => { if (item.onClick) { item.onClick(); } else { setActiveNav(item.id); setProfileOpen(false); if (item.id !== "bonuses") setPromoFilter(null); } }}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors ${
                activeNav === item.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {activeNav === item.id && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-7 h-0.5 rounded-full bg-primary" />
              )}
              <div className={activeNav === item.id ? "p-1.5 bg-primary/10 rounded-xl" : "p-1.5"}>
                {item.icon}
              </div>
              {item.badge && (
                <span className="absolute top-0 right-1 min-w-[16px] h-4 rounded-full bg-accent text-white text-[9px] font-black flex items-center justify-center px-1">
                  {item.badge}
                </span>
              )}
              <span className="text-[10px] font-bold leading-none">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* ── Wallet Modal ─────────────────────────────────── */}
      <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}


      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
