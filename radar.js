const axios = require('axios');

// ==========================================
// 0. 策略引擎
// ==========================================
const MASTERS = {
    TALEB: (m, prices) => {
        const isTail = prices.some(p => Number(p) < 0.05 || Number(p) > 0.95);
        return (isTail && Number(m.liquidity) > 5000) ? 'TAIL_RISK' : null;
    },
    SOROS: (m) => {
        const change = Math.abs(Number(m.oneDayPriceChange || 0));
        const vol24 = Number(m.volume24hr || 0);
        return (vol24 > 10000 && change > 0.05) ? 'REFLEXIVITY_TREND' : null;
    },
    MUNGER: (m) => {
        const spread = Number(m.spread || 1);
        const vol = Number(m.volume || 0);
        return (vol > 50000 && spread < 0.01) ? 'HIGH_CERTAINTY' : null;
    },
    NAVAL: (m, category) => {
        const vol = Number(m.volume || 0);
        return (category.includes('TECH') && vol > 20000) ? 'TECH_LEVERAGE' : null;
    }
};

// ==========================================
// 1. 板块定向锁定 (URL Mapping)
// ==========================================
// 这里的 key (如 'politics') 直接对应 https://polymarket.com/politics
const SECTOR_CONFIG = {
    // 资金派：按成交量 (vol24h) 选拔
    "politics":        { sort: "vol24h", minVol: 10000, signals: ["election", "nominate", "war", "cabinet"], noise: ["poll", "approval"] },
    "crypto":          { sort: "vol24h", minVol: 10000, signals: ["bitcoin", "ethereum", "solana", "etf"], noise: ["nft", "meme"] },
    "economy":         { sort: "vol24h", minVol: 10000, signals: ["fed", "rate", "inflation", "gdp"], noise: ["ranking"] },
    "tech":            { sort: "vol24h", minVol: 5000,  signals: ["ai", "gpt", "nvidia", "apple"], noise: ["game"] },
    "geopolitics":     { sort: "vol24h", minVol: 5000,  signals: ["strike", "ceasefire", "invasion", "nuclear"], noise: ["local"] },
    
    // 深度派：按流动性 (liquidity) 选拔，确保抓到低成交量但高含金量的
    "finance":         { sort: "liquidity", minVol: 1000, signals: ["gold", "oil", "s&p", "nasdaq", "stock"], noise: ["dividend"] },
    "climate-science": { sort: "liquidity", minVol: 500,  signals: ["temperature", "spacex", "virus", "hurricane"], noise: ["weather"] }
};

// ==========================================
// 2. 黑名单同步
// ==========================================
async function generateSniperTargets() {
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank";
    if (!token) { console.log("⚠️ No Token for Central-Bank sync."); return []; }
    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;

    try {
        console.log("📡 [Radar] Syncing with Central-Bank for de-duplication...");
        const resp = await axios.get(issuesUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } });
        const now = new Date();
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const targetDates = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() + i);
            targetDates.push({ str: `${months[d.getMonth()]} ${d.getDate()}`, year: d.getFullYear() });
        }
        
        let specificTargets = [];
        const polyIssues = resp.data.filter(issue => issue.title.toLowerCase().includes('[poly]'));

        polyIssues.forEach(issue => {
            let t = issue.title.replace(/\[poly\]/gi, '').trim();
            if (t.includes("{date}")) {
                targetDates.forEach(dateObj => {
                    let q = t.replace(/{date}/g, dateObj.str).replace(/{year}/g, String(dateObj.year));
                    specificTargets.push(normalizeText(q));
                });
            } else {
                specificTargets.push(normalizeText(t));
            }
        });
        return specificTargets;
    } catch (e) { console.error("❌ Failed to fetch Central-Bank issues:", e.message); return []; }
}

function normalizeText(str) { return str.toLowerCase().replace(/[?!]/g, "").replace(/\s+/g, " ").trim(); }

// ==========================================
// 3. 雷达主任务 (核心升级：7通道并行)
// ==========================================
async function runRadarTask() {
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    let REPO_NAME = process.env.REPO_NAME;
    if (!REPO_NAME && process.env.GITHUB_REPOSITORY) REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    if (!TOKEN) return console.log("❌ Missing Secrets! (MY_PAT required)");

    const sniperBlacklist = await generateSniperTargets();

    console.log("📡 [Radar] Launching 7-Sector Precision Scan...");
    
    let allCandidates = [];

    // 🔥 关键修改：针对7个板块，分别发送API请求，确保 1:1 锁定网页内容
    const sectorKeys = Object.keys(SECTOR_CONFIG);
    const fetchPromises = sectorKeys.map(async (sector) => {
        const config = SECTOR_CONFIG[sector];
        // 针对该板块抓取前 20 名
        // 注意：tag_slug 参数直接对应 polymarket.com/CATEGORY
        const url = `https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&order=${config.sort}&ascending=false&tag_slug=${sector}`;
        
        try {
            const resp = await axios.get(url);
            const events = resp.data;
            let items = [];

            events.forEach(event => {
                if (!event.markets) return;
                
                // 噪声过滤
                const eventTitleClean = normalizeText(event.title);
                if (sniperBlacklist.some(target => eventTitleClean.includes(target) || target.includes(eventTitleClean))) return;
                if (config.noise.some(kw => eventTitleClean.includes(kw))) return;
                const isLoose = ["politics", "geopolitics"].includes(sector);
                if (!isLoose && !config.signals.some(kw => eventTitleClean.includes(kw))) return;

                event.markets.forEach(m => {
                    if (!m.active || m.closed) return;
                    const vol24h = Number(m.volume24hr || 0);
                    if (vol24h < config.minVol) return;

                    let prices = [], outcomes = [];
                    try { prices = JSON.parse(m.outcomePrices); outcomes = JSON.parse(m.outcomes); } catch (e) { return; }
                    let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                    const masterTags = [];
                    const categoryUpper = sector.toUpperCase();
                    for (const [name, logic] of Object.entries(MASTERS)) {
                        const tag = logic(m, prices, categoryUpper);
                        if (tag) masterTags.push(tag);
                    }
                    if (masterTags.length === 0) masterTags.push("RAW_MARKET");

                    items.push({
                        slug: event.slug,
                        ticker: m.slug,
                        question: m.groupItemTitle || m.question,
                        eventTitle: event.title,
                        prices: priceStr,
                        volume: Math.round(Number(m.volume || 0)),
                        liquidity: Math.round(Number(m.liquidity || 0)),
                        endDate: m.endDate ? m.endDate.split("T")[0] : "N/A", 
                        dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                        vol24h: Math.round(vol24h),
                        updatedAt: m.updatedAt,
                        category: categoryUpper, // 强制标记为当前抓取的板块
                        strategy_tags: masterTags,
                        originSector: sector // 内部标记，用于后续去重优先权
                    });
                });
            });
            return items;
        } catch (e) {
            console.error(`❌ Error fetching sector [${sector}]:`, e.message);
            return [];
        }
    });

    // 等待所有板块抓取完成
    const results = await Promise.all(fetchPromises);
    results.forEach(items => allCandidates.push(...items));

    console.log(`📊 Collected ${allCandidates.length} raw candidates from 7 sectors.`);

    // ==========================================
    // 🔥 核心逻辑：30+N 混合编队
    // ==========================================

    // 1. 去重 (同一个事件可能在 'politics' 和 'geopolitics' 都被抓到)
    const uniqueMap = new Map();
    allCandidates.forEach(item => {
        // 如果重复，保留成交量大的那个，或者合并 category
        if (uniqueMap.has(item.slug)) {
            const existing = uniqueMap.get(item.slug);
            if (!existing.category.includes(item.category)) {
                existing.category += ` | ${item.category}`; // 合并标签
            }
        } else {
            uniqueMap.set(item.slug, item);
        }
    });
    let uniqueItems = Array.from(uniqueMap.values());

    // 2. 选出 Top 30 全网基准 (按资金量)
    uniqueItems.sort((a, b) => b.vol24h - a.vol24h);
    const finalList = [];
    const seenSlugs = new Set();

    // 先填入全网最热的 30 个
    for (const item of uniqueItems) {
        if (finalList.length >= 30) break;
        finalList.push(item);
        seenSlugs.add(item.slug);
    }

    // 3. 增补各板块遗珠 (Sector Gems)
    // 再次遍历配置，确保每个板块的前 3 名都在榜单里
    sectorKeys.forEach(sector => {
        const config = SECTOR_CONFIG[sector];
        const sectorUpper = sector.toUpperCase();
        
        // 从原始抓取池里找该板块的兵
        let sectorCandidates = uniqueItems.filter(i => i.category.includes(sectorUpper));
        
        // 按该板块的规则排序 (金融科学按流动性，其他按成交量)
        if (config.sort === "liquidity") {
            sectorCandidates.sort((a, b) => b.liquidity - a.liquidity);
        } else {
            sectorCandidates.sort((a, b) => b.vol24h - a.vol24h);
        }

        // 取前 3
        let count = 0;
        for (const item of sectorCandidates) {
            if (count >= 3) break;
            if (!seenSlugs.has(item.slug)) {
                console.log(`   + Adding [${sectorUpper}] gem: ${item.slug.substring(0, 20)}...`);
                finalList.push(item);
                seenSlugs.add(item.slug);
            }
            count++;
        }
    });

    // 4. 最终排序
    finalList.sort((a, b) => b.vol24h - a.vol24h);

    if (finalList.length > 0) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
        const fileName = `radar-${year}-${month}-${day}-${timePart}.json`;
        const datePart = now.toISOString().split('T')[0];
        const path = `data/trends/${datePart}/${fileName}`;
        
        await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
            message: `Radar Update: ${fileName} (Count: ${finalList.length})`,
            content: Buffer.from(JSON.stringify(finalList, null, 2)).toString('base64')
        }, { headers: { Authorization: `Bearer ${TOKEN}` } });
        console.log(`✅ Radar Success: Uploaded ${finalList.length} signals.`);
    } else { console.log("⚠️ No high-value signals found."); }
}

(async () => {
    try { await runRadarTask(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
})();
