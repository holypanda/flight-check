const express = require('express');
const cors = require('cors');
const path = require('path');
const storage = require('./services/storage');
const scheduler = require('./services/scheduler');
const ctrip = require('./services/ctrip');
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

// Get current config status (check if crawler is enabled)
app.get('/api/config', async (req, res) => {
    try {
        const config = await storage.readConfig();
        const hasApiKey = !!config.enabled;  // Use 'enabled' instead of 'apiKey'

        res.json({ 
            hasApiKey, 
            maskedKey: config.enabled ? 'Ctrip Crawler Enabled' : null,
            source: 'ctrip'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve config status' });
    }
});

// Remove configuration (Disable crawler)
app.delete('/api/config', async (req, res) => {
    try {
        await storage.saveConfig({ enabled: false });
        res.json({ message: 'Crawler disabled' });
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

// Save configuration (API Key)
app.post('/api/config', async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }
        await storage.saveConfig({ apiKey });

        // Trigger a search immediately
        try {
            const data = await ctrip.searchFlights(apiKey);
            
            // 获取天气数据
            try {
                const weatherData = await weather.getWeatherForFlights(data.prices || []);
                data.weather = weatherData;
            } catch (weatherErr) {
                console.error('Error fetching weather on config save:', weatherErr.message);
                data.weather = {};
            }
            
            await storage.writeData(data);
            res.json({ message: 'Configuration saved and search completed', data });
        } catch (err) {
            console.error('Error in search:', err);
            res.json({ message: 'Configuration saved but search failed', error: err.message });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// Manual refresh trigger
app.post('/api/refresh', async (req, res) => {
    try {
        const config = await storage.readConfig();
        if (!config.apiKey) {
            return res.status(400).json({ error: 'API key not configured' });
        }

        const data = await ctrip.searchFlights();
        
        // 获取天气数据
        try {
            const weatherData = await weather.getWeatherForFlights(data.prices || []);
            data.weather = weatherData;
        } catch (weatherErr) {
            console.error('Error fetching weather on refresh:', weatherErr.message);
            data.weather = {};
        }
        
        await storage.writeData(data);
        res.json({ message: 'Prices refreshed successfully', data });
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
        console.log('Restarting crawler...');
        
        // Enable crawler if not already enabled
        await storage.saveConfig({ enabled: true });
        
        // Trigger search immediately
        const data = await ctrip.searchFlights();
        
        // 获取天气数据
        try {
            const weatherData = await weather.getWeatherForFlights(data.prices || []);
            data.weather = weatherData;
        } catch (weatherErr) {
            console.error('Error fetching weather on restart:', weatherErr.message);
            data.weather = {};
        }
        
        await storage.writeData(data);
        
        res.json({ message: 'Crawler restarted and prices updated', data });
    } catch (error) {
        console.error('Error restarting crawler:', error);
        res.status(500).json({ error: error.message || 'Failed to restart crawler' });
    }
});

// Start scheduler
scheduler.startScheduler();

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
