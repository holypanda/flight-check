const express = require('express');
const cors = require('cors');
const path = require('path');
const storage = require('./services/storage');
const scheduler = require('./services/scheduler');
const flightSearch = require('./services/flightSearch');
const weather = require('./services/weather');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get all stored price data
app.get('/api/prices', async (req, res) => {
    try {
        const data = await storage.readData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve price data' });
    }
});

// Get current config status
app.get('/api/config', async (req, res) => {
    try {
        const config = await storage.readConfig();
        const hasApiKey = !!config.flightApiKey;

        res.json({ 
            hasApiKey, 
            maskedKey: hasApiKey ? `${config.flightApiKey.slice(0, 4)}...${config.flightApiKey.slice(-4)}` : null,
            source: 'flightapi'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve config status' });
    }
});

// Remove configuration
app.delete('/api/config', async (req, res) => {
    try {
        await storage.saveConfig({ flightApiKey: null });
        res.json({ message: 'FlightAPI configuration removed' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove configuration' });
    }
});

// Delete price snapshot
app.delete('/api/prices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const success = await storage.deleteData(id);

        if (success) {
            res.json({ message: 'Snapshot deleted successfully' });
        } else {
            res.status(404).json({ error: 'Snapshot not found' });
        }
    } catch (error) {
        console.error('Error deleting snapshot:', error);
        res.status(500).json({ error: 'Failed to delete snapshot' });
    }
});

// Save configuration (FlightAPI Key) - 仅保存配置，不触发搜索
app.post('/api/config', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }
        
        // 测试 API Key 是否有效（只测试，不搜索）
        const testResult = await flightSearch.testConnection(apiKey);
        if (!testResult.success) {
            return res.status(400).json({ error: `Invalid API key: ${testResult.message}` });
        }
        
        await storage.saveConfig({ flightApiKey: apiKey });

        res.json({ 
            message: 'API key saved. Click "🔄 更新价格" button to search flights.', 
            testMessage: testResult.message
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Manual refresh trigger
app.post('/api/refresh', async (req, res) => {
    try {
        const config = await storage.readConfig();
        if (!config.flightApiKey) {
            return res.status(400).json({ error: 'FlightAPI key not configured' });
        }

        // 从请求体读取月份数，默认1个月，限制1-12
        const months = Math.min(12, Math.max(1, parseInt(req.body.months, 10) || 1));
        const days = months * 30;
        const routeId = req.body.route || 'hkg-tokyo';
        // airline override: undefined = use preset default, null = any, string = specific code
        const airlineOverride = req.body.airline;
        console.log(`[Refresh] Searching route "${routeId}", next ${months} month(s) (${days} days), airline: ${airlineOverride === undefined ? 'preset default' : (airlineOverride || 'any')}`);

        const flights = await flightSearch.searchWeekendFlights(
            { apiKey: config.flightApiKey },
            days,
            routeId,
            airlineOverride
        );
        
        // 验证航班数据完整性，过滤掉无效数据
        const validFlights = flights.filter(f => {
            const hasPrice = f.price && f.price > 0;
            const hasRoute = f.route && f.flightNumber;
            const hasReturn = f.returnFlightNumber;
            return hasPrice && hasRoute && hasReturn;
        });
        
        console.log(`[Refresh] Found ${flights.length} flights, ${validFlights.length} valid after filtering`);
        
        // 如果没有有效数据，不保存
        if (validFlights.length === 0) {
            return res.status(404).json({ 
                error: '未找到符合条件的航班',
                message: '请尝试其他日期或调整筛选条件（如放宽时间限制）'
            });
        }
        
        const data = {
            prices: validFlights,
            timestamp: new Date().toISOString()
        };
        
        // 获取天气数据
        try {
            const weatherData = await weather.getWeatherForFlights(validFlights);
            data.weather = weatherData;
        } catch (weatherErr) {
            console.error('Error fetching weather on refresh:', weatherErr.message);
            data.weather = {};
        }
        
        await storage.writeData(data);
        
        // 计算统计信息
        const count = validFlights.length;
        const minPrice = count > 0 ? Math.min(...validFlights.map(f => f.price)) : null;
        
        res.json({ 
            message: 'Prices refreshed successfully',
            count: count,
            minPrice: minPrice,
            data 
        });
    } catch (error) {
        console.error('Error refreshing prices:', error);
        res.status(500).json({ error: 'Failed to refresh prices' });
    }
});

// Get weather data for specific dates
app.get('/api/weather', async (req, res) => {
    try {
        const { dates } = req.query;
        if (!dates) {
            // Return all available weather from latest price data
            const priceData = await storage.readData();
            const latest = priceData[priceData.length - 1];
            res.json({ weather: latest?.weather || {} });
            return;
        }
        
        const dateArray = dates.split(',');
        const weatherData = await weather.getWeatherForDates(dateArray);
        res.json({ weather: weatherData });
    } catch (error) {
        console.error('Error fetching weather:', error);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

// Restart crawler and update prices
app.post('/api/restart-crawler', async (req, res) => {
    try {
        console.log('Restarting flight search...');
        
        const config = await storage.readConfig();
        if (!config.flightApiKey) {
            return res.status(400).json({ error: 'FlightAPI key not configured. Please set API key first.' });
        }
        
        // Trigger search immediately
        const flights = await flightSearch.searchWeekendFlights(
            { apiKey: config.flightApiKey },
            30
        );
        
        const data = {
            prices: flights,
            timestamp: new Date().toISOString()
        };
        
        // 获取天气数据
        try {
            const weatherData = await weather.getWeatherForFlights(flights);
            data.weather = weatherData;
        } catch (weatherErr) {
            console.error('Error fetching weather on restart:', weatherErr.message);
            data.weather = {};
        }
        
        await storage.writeData(data);
        
        res.json({ message: 'Flight search completed and prices updated', data });
    } catch (error) {
        console.error('Error restarting crawler:', error);
        res.status(500).json({ error: error.message || 'Failed to restart flight search' });
    }
});

// Test FlightAPI connection
app.post('/api/test-connection', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }
        
        const result = await flightSearch.testConnection(apiKey);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start scheduler
scheduler.startScheduler();

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Using FlightAPI.io for flight data`);
});
