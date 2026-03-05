/**
 * Ctrip Flight Service - Playwright Version
 * 使用 Playwright 重构的携程航班服务层
 */

const { CtripPlaywrightCrawler, getTargetDates, DEFAULT_ALLOWED_AIRLINES } = require('./ctrip_playwright');

const ORIGIN_CITY = '香港';
const DESTINATION_CITY = '东京';
const ORIGIN_CODE = 'HKG';
const DESTINATION_CODES = ['HND', 'NRT'];
const DESTINATION_CODE = 'HND';

// 保持价格精度
function keepCny(cny) {
    return Math.round(cny * 100) / 100;
}

/**
 * 搜索指定机场组合的航班
 */
async function searchAirportCombo(combo, options = {}) {
    const {
        days = 30,
        minDepartureTime = '19:45',
        minReturnTime = '19:45',
        hkExpressOnly = true,
    } = options;

    console.log(`\n[${combo.name}] Starting search...`);

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
                console.log(`  Searching ${pair.depart} ~ ${pair.return}...`);

                const result = await crawler.searchRoundTrip(
                    ORIGIN_CITY,
                    DESTINATION_CITY,
                    ORIGIN_CODE,
                    combo.outbound,
                    pair.depart,
                    pair.return,
                    combo.returnFrom
                );

                if (result) {
                    results.push({
                        ...result,
                        outboundAirport: combo.outbound,
                        returnAirport: combo.returnFrom,
                        comboName: combo.name,
                        mixedAirports: combo.outbound !== combo.returnFrom,
                    });
                }

                // 添加延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (err) {
                console.error(`  Error for ${pair.depart}:`, err.message);
            }
        }

        console.log(`[${combo.name}] Found ${results.length} results`);
        return { combo, results };

    } finally {
        await crawler.close();
    }
}

/**
 * 搜索所有机场组合的航班
 */
async function searchFlights(apiKey) {
    try {
        console.log('Searching all airport combinations for best mixed-airport deals...');

        const combinations = [
            { outbound: 'HND', returnFrom: 'HND', name: 'HND往返' },
            { outbound: 'HND', returnFrom: 'NRT', name: 'HND去-NRT回' },
            { outbound: 'NRT', returnFrom: 'NRT', name: 'NRT往返' },
            { outbound: 'NRT', returnFrom: 'HND', name: 'NRT去-HND回' }
        ];

        // 串行搜索所有组合（避免并发触发反爬）
        const allResults = [];
        for (const combo of combinations) {
            try {
                const { results } = await searchAirportCombo(combo, {
                    days: 30,
                    minDepartureTime: '19:45',
                    minReturnTime: '19:45',
                    hkExpressOnly: true,
                });
                allResults.push({ combo, results });
                // 组合间延迟
                await new Promise(resolve => setTimeout(resolve, 5000));
            } catch (err) {
                console.error(`Search failed for ${combo.name}:`, err.message);
                allResults.push({ combo, results: [] });
            }
        }

        // 合并所有结果
        let allPrices = [];
        allResults.forEach(({ combo, results }) => {
            if (results && results.length > 0) {
                console.log(`Found ${results.length} results for ${combo.name}`);
                const flightsWithCombo = results.map(flight => ({
                    ...flight,
                    outboundAirport: combo.outbound,
                    returnAirport: combo.returnFrom,
                    comboName: combo.name,
                    mixedAirports: combo.outbound !== combo.returnFrom,
                    toAirport: combo.outbound,
                    fromAirport: ORIGIN_CODE
                }));
                allPrices = allPrices.concat(flightsWithCombo);
            }
        });

        // 按日期分组，为每个日期选择最便宜的组合
        const dateGroups = {};
        allPrices.forEach(flight => {
            const date = flight.date;
            if (!dateGroups[date]) {
                dateGroups[date] = [];
            }
            dateGroups[date].push(flight);
        });

        // 为每个日期选择最便宜的选项
        let bestPrices = [];
        Object.keys(dateGroups).forEach(date => {
            const flights = dateGroups[date];
            flights.sort((a, b) => a.price - b.price);
            const cheapest = flights[0];
            console.log(`Date ${date}: Best option is ${cheapest.comboName} at CNY ${cheapest.price}`);
            bestPrices.push(cheapest);
        });

        // 按日期排序
        bestPrices.sort((a, b) => new Date(a.date) - new Date(b.date));

        // 如果没有结果，返回错误
        if (bestPrices.length === 0) {
            throw new Error('No flight results from any airport combination. The website may be blocking automated access.');
        }

        // 转换数据格式
        const transformedPrices = bestPrices.map(flight => ({
            route: flight.route || `${ORIGIN_CODE}-${flight.toAirport || DESTINATION_CODE}`,
            from: ORIGIN_CODE,
            to: flight.toAirport || DESTINATION_CODE,
            price: flight.price,
            currency: 'CNY',
            date: flight.date,
            returnDate: flight.returnDate,
            airline: flight.airline,
            flightNumber: flight.flightNumber,
            returnFlightNumber: flight.returnFlightNumber,
            departureTime: flight.departureTime,
            arrivalTime: flight.arrivalTime,
            duration: flight.duration,
            returnDepartureTime: flight.returnDepartureTime,
            returnArrivalTime: flight.returnArrivalTime,
            returnDuration: flight.returnDuration,
            toAirport: flight.toAirport || DESTINATION_CODE,
            outboundAirport: flight.outboundAirport || flight.toAirport || DESTINATION_CODE,
            returnAirport: flight.returnAirport || flight.returnFromAirport || flight.toAirport || DESTINATION_CODE,
            mixedAirports: flight.mixedAirports || (flight.returnFromAirport && flight.returnFromAirport !== flight.toAirport),
            comboName: flight.comboName,
            bookingUrl: flight.bookingUrl,
            outboundBookingUrl: flight.outboundBookingUrl,
            returnBookingUrl: flight.returnBookingUrl,
            source: 'ctrip-playwright'
        }));

        return {
            timestamp: new Date().toISOString(),
            prices: transformedPrices,
            source: 'ctrip-playwright',
            mixedAirportSupport: true
        };

    } catch (error) {
        console.error('Ctrip Playwright crawler failed:', error);
        throw error;
    }
}

/**
 * 测试单个机场组合的搜索
 */
async function testSearch() {
    const combo = { outbound: 'HND', returnFrom: 'HND', name: 'HND往返' };
    const result = await searchAirportCombo(combo, { days: 14 });
    console.log('Test result:', JSON.stringify(result, null, 2));
}

module.exports = {
    searchFlights,
    searchAirportCombo,
    testSearch,
    getTargetDates
};
