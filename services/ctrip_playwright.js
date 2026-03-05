/**
 * Ctrip Flight Crawler - Playwright Version
 * 使用 Playwright 重构的携程航班数据爬虫
 * 
 * Features:
 * - 自动浏览器管理（无需手动安装 ChromeDriver）
 * - 内置反检测机制
 * - 支持香港快运航空筛选
 * - 支持时间过滤（19:45+）
 * - 支持往返航班搜索
 * - 通过拦截 API 响应获取数据
 */

const { chromium } = require('playwright');

// User-Agent 轮换列表
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
];

// 默认允许的航空公司
const DEFAULT_ALLOWED_AIRLINES = ['香港快运航空', 'Hong Kong Express', 'UO', '香港快運航空'];

/**
 * 获取随机 User-Agent
 */
function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * 随机延迟
 */
async function randomDelay(min = 3000, max = 8000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`Waiting ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 解析时间为分钟数
 */
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    try {
        const cleanStr = timeStr.trim();
        const timePart = cleanStr.includes(' ') ? cleanStr.split(' ')[1] : cleanStr;
        const [hour, minute] = timePart.split(':').map(Number);
        return hour * 60 + minute;
    } catch {
        return 0;
    }
}

/**
 * 格式化时间为 HH:MM，去掉秒
 * @param {string} timeStr - 时间字符串 (如 "19:45:00" 或 "2026-03-06T19:45:00")
 * @returns {string} - 格式化后的时间 (如 "19:45")
 */
function formatTimeToMinute(timeStr) {
    if (!timeStr) return '';
    try {
        const cleanStr = timeStr.trim();
        // 如果有日期部分，先去掉
        const timePart = cleanStr.includes('T') ? cleanStr.split('T')[1] : 
                        cleanStr.includes(' ') ? cleanStr.split(' ')[1] : cleanStr;
        // 只取 HH:MM
        const parts = timePart.split(':');
        if (parts.length >= 2) {
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }
        return timePart;
    } catch {
        return timeStr;
    }
}

/**
 * 检查时间是否在指定时间之后
 */
function isAfterMinTime(departureTime, minTime, includeEarlyMorning = true) {
    if (!minTime) return true;
    if (!departureTime) return false;
    
    const departureMinutes = parseTimeToMinutes(departureTime);
    const minMinutes = parseTimeToMinutes(minTime);
    
    if (includeEarlyMorning) {
        const earlyMorningEnd = 6 * 60; // 06:00
        if (departureMinutes < earlyMorningEnd) return true;
    }
    
    return departureMinutes >= minMinutes;
}

/**
 * 检查航空公司是否在允许列表中
 */
function isAllowedAirline(airlineName, allowedAirlines) {
    if (!allowedAirlines || allowedAirlines.length === 0) return true;
    if (!airlineName) return false;
    
    const name = String(airlineName).trim();
    return allowedAirlines.some(allowed => 
        name.toLowerCase().includes(allowed.toLowerCase())
    );
}

class CtripPlaywrightCrawler {
    constructor(options = {}) {
        this.headless = options.headless !== false;
        this.maxWaitTime = options.maxWaitTime || 60000;
        this.minDepartureTime = options.minDepartureTime || '19:45';
        this.minReturnTime = options.minReturnTime || '19:45';
        this.allowedAirlines = options.hkExpressOnly ? DEFAULT_ALLOWED_AIRLINES : options.allowedAirlines;
        this.browser = null;
        this.context = null;
        this.capturedData = null;
    }

    /**
     * 初始化浏览器
     */
    async init() {
        const userAgent = getRandomUA();
        console.log(`Using User-Agent: ${userAgent.slice(0, 50)}...`);

        this.browser = await chromium.launch({
            headless: this.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--lang=zh-CN,zh,en-US,en',
            ]
        });

        this.context = await this.browser.newContext({
            userAgent,
            viewport: { width: 1920, height: 1080 },
            locale: 'zh-CN',
            timezoneId: 'Asia/Shanghai',
            permissions: ['notifications'],
        });

        // 注入反检测脚本
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ]
            });
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
            window.chrome = window.chrome || {};
            window.chrome.runtime = window.chrome.runtime || {};
            if (navigator.permissions) {
                const originalQuery = navigator.permissions.query;
                navigator.permissions.query = (parameters) => {
                    if (parameters.name === 'notifications') {
                        return Promise.resolve({ state: 'prompt' });
                    }
                    return originalQuery(parameters);
                };
            }
        });

        console.log('Browser initialized successfully');
    }

    /**
     * 关闭浏览器
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
        }
    }

    /**
     * 搜索单程航班
     */
    async searchFlights(fromCity, toCity, fromCode, toCode, date) {
        if (!this.browser) {
            await this.init();
        }

        const flights = [];
        const page = await this.context.newPage();
        this.capturedData = null;

        try {
            // 拦截 batchSearch API 响应
            page.on('response', async response => {
                const url = response.url();
                if (url.includes('/batchSearch') && url.includes('flights.ctrip.com')) {
                    try {
                        const responseData = await response.json();
                        // API 结构: { status, msg, data: { flightItineraryList: [...] } }
                        if (responseData && responseData.data && 
                            (responseData.data.flightItineraryList || responseData.data.flightList)) {
                            console.log('Captured flight data from API');
                            this.capturedData = responseData.data;
                        }
                    } catch (e) {
                        // 忽略非 JSON 响应
                    }
                }
            });

            // 构建搜索 URL
            const url = `https://flights.ctrip.com/online/list/oneway-${fromCode}-${toCode}?depdate=${date}`;
            console.log(`Accessing: ${url}`);

            // 随机延迟
            await randomDelay(3000, 8000);

            // 导航到页面
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: this.maxWaitTime
            });

            // 等待 API 响应
            console.log('Waiting for flight data API...');
            let attempts = 0;
            while (!this.capturedData && attempts < 30) {
                await page.waitForTimeout(1000);
                attempts++;
            }

            if (this.capturedData) {
                console.log('Got flight data from API after', attempts, 'seconds');
                const parsed = this._parseApiResponse(this.capturedData, fromCity, toCity, fromCode, toCode, date);
                flights.push(...parsed);
            } else {
                console.log('No API data captured, trying DOM parsing...');
                // 等待页面渲染
                await page.waitForTimeout(5000);
                const domFlights = await this._parseDomFlights(page, fromCity, toCity, fromCode, toCode, date);
                flights.push(...domFlights);
            }

            console.log(`Extracted ${flights.length} flights for ${date}`);

        } catch (error) {
            console.error(`Error searching flights for ${date}:`, error.message);
        } finally {
            await page.close();
        }

        return flights;
    }

    /**
     * 解析 API 响应数据
     */
    _parseApiResponse(data, fromCity, toCity, fromCode, toCode, date) {
        const flights = [];

        try {
            // 获取航班列表 - data 是 responseData.data
            const flightList = data.flightItineraryList || [];
            if (!flightList.length) {
                console.log('No flightItineraryList in API data');
                return flights;
            }
            console.log(`API returned ${flightList.length} flight items`);

            for (const item of flightList) {
                try {
                    // 获取航班段信息
                    const segments = item.flightSegments || [];
                    if (!segments.length) continue;

                    const segment = segments[0];
                    const flightList_detail = segment.flightList || [];
                    if (!flightList_detail.length) continue;

                    const flight = flightList_detail[0];

                    // 提取航空公司
                    const airline = flight.marketAirlineName || flight.airlineName || 'Unknown';

                    // 筛选航空公司
                    if (!isAllowedAirline(airline, this.allowedAirlines)) {
                        continue;
                    }

                    // 提取出发时间（格式化为 HH:MM）
                    const departureTime = formatTimeToMinute(flight.departureDateTime || '');

                    // 提取价格
                    let price = 0;
                    if (item.priceList && item.priceList.length > 0) {
                        // 找到最低价
                        const prices = item.priceList
                            .filter(p => p.adultPrice && p.adultPrice > 0)
                            .map(p => p.adultPrice);
                        if (prices.length > 0) {
                            price = Math.min(...prices);
                        }
                    }

                    // 提取航班号
                    const flightNo = flight.flightNo || flight.flightNumber || 'Unknown';

                    // 生成购票链接
                    const bookingUrl = `https://flights.ctrip.com/online/list/oneway-${fromCode}-${toCode}?depdate=${date}`;

                    flights.push({
                        route: `${fromCode}-${toCode}`,
                        from: fromCode,
                        to: toCode,
                        price,
                        currency: 'CNY',
                        date,
                        returnDate: null,
                        airline,
                        flightNumber: flightNo,
                        departureTime,
                        arrivalTime: formatTimeToMinute(flight.arrivalDateTime || ''),
                        duration: flight.duration || segment.duration || '',
                        fromCity,
                        toCity,
                        fromAirport: flight.departureAirportName || segment.departureAirportName || '',
                        toAirport: flight.arrivalAirportName || segment.arrivalAirportName || '',
                        stopCount: flight.stopCount || segment.stopCount || 0,
                        aircraft: flight.aircraftName || '',
                        bookingUrl,
                    });

                } catch (e) {
                    console.error('Error parsing flight item:', e.message);
                }
            }

        } catch (e) {
            console.error('Error in _parseApiResponse:', e.message);
        }

        return flights;
    }

    /**
     * 通过 DOM 解析航班数据（备用方案）
     */
    async _parseDomFlights(page, fromCity, toCity, fromCode, toCode, date) {
        const flights = [];

        try {
            // 尝试多种选择器
            const selectors = [
                '.flight-item',
                '.flight-list-item',
                '[class*="flightItem"]',
                '[class*="FlightItem"]',
                '[data-testid*="flight"]',
            ];

            let flightElements = [];
            for (const selector of selectors) {
                flightElements = await page.locator(selector).all();
                if (flightElements.length > 0) {
                    console.log(`Found ${flightElements.length} elements with selector: ${selector}`);
                    break;
                }
            }

            if (flightElements.length === 0) {
                console.log('No flight elements found in DOM');
                return flights;
            }

            for (const elem of flightElements) {
                try {
                    const text = await elem.textContent() || '';
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l);

                    if (lines.length < 3) continue;

                    // 解析航空公司（通常是第一行）
                    const airline = lines[0] || 'Unknown';

                    // 解析航班号
                    let flightNo = 'Unknown';
                    for (const line of lines) {
                        const match = line.match(/\b([A-Z]{2,3}\d{2,4})\b/);
                        if (match) {
                            flightNo = match[1];
                            break;
                        }
                    }

                    // 解析时间
                    const times = [];
                    for (const line of lines) {
                        const matches = line.match(/(\d{2}:\d{2})/g);
                        if (matches) times.push(...matches);
                    }
                    const departureTime = times[0] || '';
                    const arrivalTime = times[1] || '';

                    // 解析价格（找最大的数字，通常是价格）
                    let price = 0;
                    for (const line of lines) {
                        const cleanLine = line.replace(/,/g, '');
                        const matches = cleanLine.match(/¥?(\d{3,5})/g);
                        if (matches) {
                            const nums = matches.map(m => parseInt(m.replace('¥', '')));
                            const maxNum = Math.max(...nums);
                            if (maxNum > price && maxNum < 100000) {
                                price = maxNum;
                            }
                        }
                    }

                    // 解析时长
                    let duration = '';
                    for (const line of lines) {
                        const match = line.match(/(\d+小时\d+分|\d+h\s*\d+m|\d+小时|\d+h)/);
                        if (match) {
                            duration = match[1];
                            break;
                        }
                    }

                    const bookingUrl = `https://flights.ctrip.com/online/list/oneway-${fromCode}-${toCode}?depdate=${date}`;

                    flights.push({
                        route: `${fromCode}-${toCode}`,
                        from: fromCode,
                        to: toCode,
                        price,
                        currency: 'CNY',
                        date,
                        returnDate: null,
                        airline,
                        flightNumber: flightNo,
                        departureTime,
                        arrivalTime,
                        duration,
                        fromCity,
                        toCity,
                        fromAirport: '',
                        toAirport: '',
                        bookingUrl,
                    });

                } catch (e) {
                    console.error('Error parsing flight element:', e.message);
                }
            }

        } catch (e) {
            console.error('Error in _parseDomFlights:', e.message);
        }

        return flights;
    }

    /**
     * 搜索往返航班
     */
    async searchRoundTrip(fromCity, toCity, fromCode, toCode, departDate, returnDate, returnFromCode = null) {
        const returnFrom = returnFromCode || toCode;

        console.log(`Searching ${departDate} ~ ${returnDate} - ${fromCode}->${toCode}, return from ${returnFrom}`);

        // 搜索去程
        const outboundFlights = await this.searchFlights(fromCity, toCity, fromCode, toCode, departDate);

        // 搜索返程
        const returnFlights = await this.searchFlights(toCity, fromCity, returnFrom, fromCode, returnDate);

        console.log(`Found ${outboundFlights.length} outbound flights, ${returnFlights.length} return flights`);

        // 筛选允许的航空公司
        let filteredOutbound = outboundFlights.filter(f => isAllowedAirline(f.airline, this.allowedAirlines));
        let filteredReturn = returnFlights.filter(f => isAllowedAirline(f.airline, this.allowedAirlines));

        // 应用时间过滤
        if (this.minDepartureTime) {
            filteredOutbound = filteredOutbound.filter(f => 
                isAfterMinTime(f.departureTime, this.minDepartureTime)
            );
        }
        if (this.minReturnTime) {
            filteredReturn = filteredReturn.filter(f => 
                isAfterMinTime(f.departureTime, this.minReturnTime)
            );
        }

        console.log(`After filtering: ${filteredOutbound.length} outbound, ${filteredReturn.length} return flights`);

        if (filteredOutbound.length === 0 || filteredReturn.length === 0) {
            console.log(`No valid flights found after filtering`);
            return null;
        }

        // 计算最低往返价格
        const minOutbound = Math.min(...filteredOutbound.filter(f => f.price > 0).map(f => f.price));
        const minReturn = Math.min(...filteredReturn.filter(f => f.price > 0).map(f => f.price));
        const totalPrice = minOutbound + minReturn;

        // 选择最低价航班组合
        const bestOutbound = filteredOutbound.find(f => f.price === minOutbound);
        const bestReturn = filteredReturn.find(f => f.price === minReturn);

        if (bestOutbound) {
            const result = {
                ...bestOutbound,
                returnDate,
                returnPrice: minReturn,
                returnFlightNumber: bestReturn?.flightNumber,
                returnAirline: bestReturn?.airline,
                returnDepartureTime: bestReturn?.departureTime,
                returnArrivalTime: bestReturn?.arrivalTime,
                returnDuration: bestReturn?.duration,
                returnBookingUrl: bestReturn?.bookingUrl,
                returnFromAirport: returnFrom,
                returnToAirport: fromCode,
                mixedAirports: returnFrom !== toCode,
                route: returnFrom !== toCode ? `${fromCode}-${toCode}+${returnFrom}-${fromCode}` : `${fromCode}-${toCode}`,
                totalPrice,
                price: totalPrice,
            };

            // 生成往返购票链接
            const outboundFlight = bestOutbound.flightNumber !== 'Unknown' ? bestOutbound.flightNumber : '';
            const returnFlight = bestReturn?.flightNumber !== 'Unknown' ? bestReturn?.flightNumber : '';
            
            if (outboundFlight && returnFlight) {
                result.bookingUrl = `https://flights.ctrip.com/online/list/roundtrip-${fromCity}-${toCity}?depdate=${departDate}_${returnDate}&flightnos=${outboundFlight},${returnFlight}`;
            } else {
                result.bookingUrl = `https://flights.ctrip.com/online/list/roundtrip-${fromCity}-${toCity}?depdate=${departDate}_${returnDate}`;
            }

            const airportInfo = returnFrom !== toCode ? `(${returnFrom}→${fromCode})` : '';
            console.log(`Selected: ${result.flightNumber} + ${result.returnFlightNumber}${airportInfo} = CNY ${totalPrice}`);

            return result;
        }

        return null;
    }
}

/**
 * 获取未来指定天数的周五-周日日期对
 */
function getTargetDates(days = 30) {
    const dates = [];
    const today = new Date();
    const limit = new Date();
    limit.setDate(today.getDate() + days);

    let current = new Date(today);

    // 找到下一个周五
    while (current.getDay() !== 5) {
        current.setDate(current.getDate() + 1);
    }

    while (current <= limit) {
        const departure = current.toISOString().split('T')[0];
        const returnDate = new Date(current);
        returnDate.setDate(current.getDate() + 2);

        dates.push({
            depart: departure,
            return: returnDate.toISOString().split('T')[0]
        });

        current.setDate(current.getDate() + 7);
    }

    return dates;
}

/**
 * 搜索航班（主入口函数）
 */
async function searchCtripFlights(options = {}) {
    const {
        fromCity = '香港',
        toCity = '东京',
        fromCode = 'HKG',
        toCode = 'HND',
        returnFromCode = null,
        days = 30,
        hkExpressOnly = true,
        minDepartureTime = '19:45',
        minReturnTime = '19:45',
    } = options;

    const crawler = new CtripPlaywrightCrawler({
        hkExpressOnly,
        minDepartureTime,
        minReturnTime,
        allowedAirlines: hkExpressOnly ? DEFAULT_ALLOWED_AIRLINES : null,
    });

    const datePairs = getTargetDates(days);
    const results = [];

    try {
        for (const pair of datePairs) {
            try {
                console.log(`\nSearching ${pair.depart} to ${pair.return}...`);

                const result = await crawler.searchRoundTrip(
                    fromCity,
                    toCity,
                    fromCode,
                    toCode,
                    pair.depart,
                    pair.return,
                    returnFromCode || toCode
                );

                if (result) {
                    results.push(result);
                    console.log(`Found flight: ${result.airline} ${result.flightNumber} - CNY ${result.price}`);
                }

                // 适当延迟，避免被封
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (e) {
                console.error(`Error processing date pair ${pair.depart}:`, e.message);
            }
        }

        return {
            timestamp: new Date().toISOString(),
            source: 'ctrip-playwright',
            prices: results
        };

    } finally {
        await crawler.close();
    }
}

module.exports = {
    CtripPlaywrightCrawler,
    searchCtripFlights,
    getTargetDates,
    DEFAULT_ALLOWED_AIRLINES
};
