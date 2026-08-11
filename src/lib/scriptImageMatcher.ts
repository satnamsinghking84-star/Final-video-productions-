// Script Image Matcher: Automatically matches script text with high-definition thematic visual images
// and provides fallback custom SVG graphics tailored to finance, habits, productivity, and general topics.

export interface ScriptImageMatch {
  url: string;
  topic: string;
  label: string;
}

export function getSafeImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/api/proxy-image")) {
    return url;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// Curated collection of high-resolution Unsplash visual images tagged by topic and keywords
const THEMATIC_IMAGES: {
  id: string;
  topic: string;
  label: string;
  keywords: string[];
  url: string;
}[] = [
  {
    id: "payday",
    topic: "Payday & Rich Feeling",
    label: "Payday Cash & Salary",
    keywords: ["payday", "rich", "salary", "cash", "income", "money", "paid", "wealth", "dollars", "पैसे", "सैलरी"],
    url: "https://images.unsplash.com/photo-1553729459-efe14ef6055d?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "rent",
    topic: "Rent & Housing",
    label: "Home Rent & Mortgage",
    keywords: ["rent", "house", "mortgage", "apartment", "lease", "landlord", "किराया", "मकान"],
    url: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "bills",
    topic: "Bills & Invoices",
    label: "Monthly Bills & Expenses",
    keywords: ["bills", "invoice", "receipt", "expenses", "wipe out", "payment", "due", "बिल", "खर्चा"],
    url: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "groceries",
    topic: "Groceries & Supermarket",
    label: "Grocery Shopping",
    keywords: ["groceries", "grocery", "supermarket", "food", "shopping", "store", "राशन", "सामान"],
    url: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "subscriptions",
    topic: "Digital Subscriptions",
    label: "Apps & Monthly Subscriptions",
    keywords: ["subscriptions", "subscription", "apps", "recurring", "monthly fee", "subscribers", "सब्सक्रिप्शन"],
    url: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "bank_balance",
    topic: "Bank Balance & Cycle",
    label: "Bank Balance & Financial Buffer",
    keywords: ["bank balance", "paycheck to paycheck", "balance", "empty", "zero", "low income", "buffer", "साइकिल", "बैलेंस"],
    url: "https://images.unsplash.com/photo-1621416894569-0f39ed31d247?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day1_bleed",
    topic: "Day 1: Calculate Bleed Number",
    label: "Day 1 - Calculate Bleed Number",
    keywords: ["day one", "day 1", "calculate", "bleed number", "essential expenses", "minus", "calculator", "math", "बजट"],
    url: "https://images.unsplash.com/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day2_emergency",
    topic: "Day 2: Emergency Buffer",
    label: "Day 2 - Emergency Savings Jar ($25)",
    keywords: ["day two", "day 2", "emergency buffer", "emergency fund", "$25", "small buffer", "piggy bank", "savings jar", "बचत"],
    url: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day3_cancel",
    topic: "Day 3: Cancel Leaks",
    label: "Day 3 - Cancel Unused Subscriptions",
    keywords: ["day three", "day 3", "cancel", "unused subscriptions", "money leaks", "stop leaks", "cut expenses", "बंद करें"],
    url: "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day4_phone",
    topic: "Day 4: Call Providers",
    label: "Day 4 - Call Phone & Internet Provider",
    keywords: ["day four", "day 4", "call", "phone", "internet", "provider", "negotiate", "customer service", "फोन"],
    url: "https://images.unsplash.com/photo-1534536281715-e28d76689b4d?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day5_accounts",
    topic: "Day 5: Two Bank Accounts",
    label: "Day 5 - Two Accounts (Bills vs Spending)",
    keywords: ["day five", "day 5", "separate", "two accounts", "bills account", "spending account", "bank accounts", "दो अकाउंट"],
    url: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day6_credit",
    topic: "Day 6: Credit Cards Rules",
    label: "Day 6 - Credit Cards & Cash Rules",
    keywords: ["day six", "day 6", "credit cards", "extra income", "cash", "don't buy", "card debt", "क्रेडिट कार्ड"],
    url: "https://images.unsplash.com/photo-1556742049-0a67dd226d97?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "day7_automate",
    topic: "Day 7: Automate Everything",
    label: "Day 7 - Automate Payments & Weekly Check",
    keywords: ["day seven", "day 7", "automate", "bill payments", "savings", "weekly 10-minute", "money check", "ऑटोमेट"],
    url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "freedom",
    topic: "Financial Freedom & Growth",
    label: "Financial Freedom & Growth Habits",
    keywords: ["financial freedom", "salary", "system", "habits", "consistent", "growth", "wealth", "freedom", "सफलता", "आज़ादी"],
    url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "tech_ai",
    topic: "Technology & AI",
    label: "Technology & Software",
    keywords: ["code", "coding", "software", "ai", "computer", "laptop", "technology", "tech", "developer"],
    url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "music_studio",
    topic: "Music & Audio",
    label: "Music & Audio Studio",
    keywords: ["music", "singing", "song", "audio", "mic", "microphone", "sound", "studio", "headphones", "गाना"],
    url: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "mindset",
    topic: "Mindset & Goals",
    label: "Mindset & Life Goals",
    keywords: ["mindset", "goal", "thinking", "brain", "focus", "success", "study", "plan", "सोच"],
    url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "paper_leak",
    topic: "Paper Leak & Exams",
    label: "Paper Leak & Exam Action",
    keywords: ["paper leak", "paper", "leak", "paperleak", "पेपर लीक", "पेपर", "लीक", "परीक्षा", "exam", "exams", "test paper", "cheating"],
    url: "https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "pm_modi",
    topic: "Prime Minister & Speech",
    label: "Prime Minister & Video Speech",
    keywords: ["modi", "narendra modi", "prime minister", "pm", "मोदी", "नरेंद्र मोदी", "प्रधानमंत्री", "संदेश", "वीडियो संदेश", "speech", "statement", "address"],
    url: "https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "cabinet_government",
    topic: "Cabinet & Government Action",
    label: "Cabinet Meeting & Government Action",
    keywords: ["cabinet", "government", "कैबिनेट", "बैठक", "फैसले", "सरकार", "action", "meeting", "cabinet meeting", "दोषियों", "अपराध", "सख्त"],
    url: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "students_protest",
    topic: "Students & Protests",
    label: "Students & Exam System",
    keywords: ["छात्र", "छात्रों", "छात्र गुस्सा", "student", "students", "students protest", "anger", "व्यवस्था", "देशभर", "प्रोटेस्ट"],
    url: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "law_strict",
    topic: "Law & Legal Action",
    label: "New Laws & Strict Action",
    keywords: ["कानून", "सख्त कार्रवाई", "नियम", "रोक", "law", "strict action", "court", "reforms", "justice", "कार्रवाई"],
    url: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "public_opinion",
    topic: "Opinion & Discussion",
    label: "Public Opinion & Comments",
    keywords: ["आपकी क्या राय", "राय", "कमेंट", "comment", "opinion", "सवाल", "question", "पर्याप्त", "चर्चा"],
    url: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "news_channel",
    topic: "News Channel & Follow",
    label: "News Channel & Follow Updates",
    keywords: ["फॉलो", "चैनल", "लेटेस्ट अपडेट्स", "follow", "subscribe", "channel", "news update", "latest updates", "अपडेट्स"],
    url: "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: "nature",
    topic: "Nature & Adventure",
    label: "Nature & Mountain Peak",
    keywords: ["nature", "mountain", "sky", "view", "adventure", "travel", "peak", "landscape"],
    url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80"
  }
];

// Helper to generate a styled high-resolution SVG graphic Data URI as fallback or for specific days
export function generateThematicSVG(title: string, subtitle: string, stepNumber?: string): string {
  const bgGradStart = stepNumber ? "#1e1b4b" : "#0f172a";
  const bgGradEnd = stepNumber ? "#312e81" : "#1e293b";
  const accentColor = "#f59e0b"; // Gold / Amber accent

  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSubtitle = subtitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bgGradStart}"/>
          <stop offset="100%" stop-color="${bgGradEnd}"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#fbbf24"/>
          <stop offset="100%" stop-color="#f59e0b"/>
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#bgGrad)"/>
      <circle cx="700" cy="80" r="180" fill="#ffffff" fill-opacity="0.03"/>
      <circle cx="100" cy="380" r="220" fill="#ffffff" fill-opacity="0.02"/>
      
      ${stepNumber ? `
        <rect x="60" y="50" width="160" height="40" rx="20" fill="url(#goldGrad)"/>
        <text x="140" y="76" font-family="sans-serif" font-weight="900" font-size="18" fill="#0f172a" text-anchor="middle" letter-spacing="1.5">${stepNumber.toUpperCase()}</text>
      ` : ''}

      <text x="60" y="${stepNumber ? '160' : '180'}" font-family="sans-serif" font-weight="800" font-size="36" fill="#ffffff" width="680">
        ${safeTitle}
      </text>

      <rect x="60" y="${stepNumber ? '200' : '220'}" width="120" height="4" fill="url(#goldGrad)" rx="2"/>

      <text x="60" y="${stepNumber ? '260' : '280'}" font-family="sans-serif" font-weight="500" font-size="22" fill="#94a3b8">
        ${safeSubtitle}
      </text>

      <g transform="translate(680, 350)">
        <circle cx="0" cy="0" r="30" fill="#f59e0b" fill-opacity="0.2"/>
        <text x="0" y="8" font-family="sans-serif" font-weight="bold" font-size="24" fill="#f59e0b" text-anchor="middle">★</text>
      </g>
    </svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
}

// Function to match script segment text to the most accurate visual image
export function matchImageForScript(text: string, index?: number): ScriptImageMatch {
  if (!text || text.trim().length === 0) {
    return {
      url: THEMATIC_IMAGES[0].url,
      topic: "General Finance",
      label: "Finance & Money"
    };
  }

  const lowerText = text.toLowerCase();

  // 1. Check for specific Day steps first (Day 1 to Day 7)
  if (lowerText.includes("day one") || lowerText.includes("day 1") || lowerText.includes("bleed number")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day1_bleed")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day two") || lowerText.includes("day 2") || lowerText.includes("$25") || lowerText.includes("emergency buffer")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day2_emergency")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day three") || lowerText.includes("day 3") || lowerText.includes("cancel") || lowerText.includes("money leaks")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day3_cancel")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day four") || lowerText.includes("day 4") || (lowerText.includes("call") && lowerText.includes("phone"))) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day4_phone")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day five") || lowerText.includes("day 5") || lowerText.includes("two accounts") || lowerText.includes("bills") && lowerText.includes("spending")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day5_accounts")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day six") || lowerText.includes("day 6") || lowerText.includes("credit card") || lowerText.includes("credit cards")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day6_credit")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }
  if (lowerText.includes("day seven") || lowerText.includes("day 7") || lowerText.includes("automate") || lowerText.includes("10-minute") || lowerText.includes("10 minute")) {
    const item = THEMATIC_IMAGES.find(i => i.id === "day7_automate")!;
    return { url: item.url, topic: item.topic, label: item.label };
  }

  // 2. Keyword scoring across all thematic images
  let bestScore = 0;
  let bestItem = THEMATIC_IMAGES[0];

  for (const item of THEMATIC_IMAGES) {
    let score = 0;
    for (const kw of item.keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        score += kw.length > 5 ? 3 : 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestScore > 0) {
    return {
      url: bestItem.url,
      topic: bestItem.topic,
      label: bestItem.label
    };
  }

  // 3. Fallback: cycle through curated thematic images using index or generate SVG if index is provided
  if (typeof index === "number") {
    const defaultItem = THEMATIC_IMAGES[index % THEMATIC_IMAGES.length];
    return {
      url: defaultItem.url,
      topic: defaultItem.topic,
      label: defaultItem.label
    };
  }

  return {
    url: THEMATIC_IMAGES[0].url,
    topic: THEMATIC_IMAGES[0].topic,
    label: THEMATIC_IMAGES[0].label
  };
}
