const { spawn } = require('child_process');
const path = require('path');

const ORIGIN_CITY = '香港';
const DESTINATION_CITY = '东京';
const ORIGIN_CODE = 'HKG';
const DESTINATION_CODES = ['HND', 'NRT']; // 羽田机场和成田机场
const DESTINATION_CODE = 'HND'; // 默认机场代码

// Helper: Get next 30 days Fri-Sun pairs
function getTargetDates() {
    const dates = [];
    const today = new Date();
    const limit = new Date();
    limit.setDate(today.getDate() + 30);

    let current = new Date(today);

    // Find next Friday
    while (current.getDay() !== 5) {
        current.setDate(current.getDate() + 1);
    }

    while (current <= limit) {
        const departureDate = new Date(current);
        const returnDate = new Date(current);
        returnDate.setDate(departureDate.getDate() + 2); // Sunday is 2 days after Friday

        dates.push({
            depart: departureDate.toISOString().split('T')[0],
            return: returnDate.toISOString().split('T')[0]
        });

        // Next Friday
        current.setDate(current.getDate() + 7);
    }

    return dates;
}

// Keep prices in CNY (original currency from crawler)
function keepCny(cny) {
    return Math.round(cny * 100) / 100;
}

// Call Python crawler
// mode: 'roundtrip' | 'outbound' | 'return'
function callPythonCrawler(toCode = DESTINATION_CODE, fromCode = ORIGIN_CODE, mode = 'roundtrip', returnFromCode = null) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'ctrip_crawler.py');
        const args = [
            scriptPath,
            '--from-city', ORIGIN_CITY,
            '--to-city', DESTINATION_CITY,
            '--from-code', fromCode,
            '--to-code', toCode,
            '--days', '30',
            '--min-departure-time', '20:00',
            '--min-return-time', '20:00'
        ];
        
        if (mode === 'outbound') {
            args.push('--search-one-way');
        } else if (mode === 'return') {
            args.push('--search-one-way');
            if (returnFromCode) {
                args.push('--return-from-code', returnFromCode);
            }
        } else if (returnFromCode) {
            args.push('--return-from-code', returnFromCode);
        }

        console.log(`Starting Ctrip crawler (mode=${mode}, ${fromCode}->${toCode}${returnFromCode ? ', return from ' + returnFromCode : ''})...`);
        
        // Use virtual environment Python if available
        const venvPython = path.join(__dirname, '..', 'venv', 'bin', 'python3');
        const pythonCmd = require('fs').existsSync(venvPython) ? venvPython : 'python3';
        
        const pythonProcess = spawn(pythonCmd, args, {
            cwd: __dirname,
            timeout: 300000 // 5 minute timeout
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
                console.log(`[Crawler] ${msg}`);
                stderr += msg + '\n';
            }
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`Crawler process exited with code ${code}`);
            }

            try {
                // Find JSON output in stdout
                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    resolve(result);
                } else {
                    reject(new Error('No valid JSON output from crawler'));
                }
            } catch (error) {
                console.error('Failed to parse crawler output:', error);
                console.error('Raw output:', stdout);
                reject(new Error(`Failed to parse crawler output: ${error.message}`));
            }
        });

        pythonProcess.on('error', (error) => {
            console.error('Failed to start crawler:', error);
            reject(new Error(`Failed to start crawler: ${error.message}. Make sure Python3 is installed.`));
        });
    });
}

async function searchFlights(apiKey) {
    try {
        // 搜索所有组合
        console.log('Searching all airport combinations for best mixed-airport deals...');
        
        const combinations = [
            { outbound: 'HND', returnFrom: 'HND', name: 'HND往返' },
            { outbound: 'HND', returnFrom: 'NRT', name: 'HND去-NRT回' },
            { outbound: 'NRT', returnFrom: 'NRT', name: 'NRT往返' },
            { outbound: 'NRT', returnFrom: 'HND', name: 'NRT去-HND回' }
        ];
        
        // 并行搜索所有组合
        const results = await Promise.all(
            combinations.map(async (combo) => {
                try {
                    const result = await callPythonCrawler(combo.outbound, ORIGIN_CODE, 'roundtrip', combo.returnFrom);
                    return { combo, result };
                } catch (err) {
                    console.log(`Search failed for ${combo.name}:`, err.message);
                    return { combo, result: { prices: [], error: err.message } };
                }
            })
        );
        
        // 合并所有结果
        let allPrices = [];
        results.forEach(({ combo, result }) => {
            if (result.prices && result.prices.length > 0) {
                console.log(`Found ${result.prices.length} results for ${combo.name}`);
                const flightsWithCombo = result.prices.map(flight => ({
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
        
        let result = {
            timestamp: new Date().toISOString(),
            prices: bestPrices,
            source: 'ctrip',
            mixedAirportSupport: true
        };
        
        // Transform data to match expected format
        const transformedPrices = result.prices.map(flight => ({
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
            source: result.source || 'ctrip'
        }));

        return {
            timestamp: result.timestamp || new Date().toISOString(),
            prices: transformedPrices
        };
        
    } catch (error) {
        console.error('Ctrip crawler failed:', error);
        throw error;
    }
}

module.exports = {
    searchFlights
};
