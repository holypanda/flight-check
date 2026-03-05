const cron = require('node-cron');
const ctrip = require('./ctrip');
const storage = require('./storage');
const weather = require('./weather');

// Schedule job to run every hour at 0 minutes past the hour
const SCHEDULE = '0 * * * *';

function startScheduler() {
    console.log(`Scheduler started with cron pattern: ${SCHEDULE}`);

    // Schedule the task
    cron.schedule(SCHEDULE, async () => {
        console.log('Running scheduled flight price search...');
        try {
            const config = await storage.readConfig();
            // Ctrip crawler doesn't require API key, always run
            if (config.enabled === false) {
                console.log('Crawler disabled, skipping scheduled search.');
                return;
            }

            const data = await ctrip.searchFlights();
            
            // 获取天气数据
            console.log('Fetching weather data for Yuzawa...');
            try {
                const weatherData = await weather.getWeatherForFlights(data.prices || []);
                data.weather = weatherData;
                console.log(`Weather data fetched for ${Object.keys(weatherData).length} dates`);
            } catch (weatherErr) {
                console.error('Error fetching weather:', weatherErr.message);
                data.weather = {};
            }
            
            await storage.writeData(data);
            console.log('Flight and weather data saved successfully');
        } catch (error) {
            console.error('Error in scheduled search:', error);
        }
    });

    // Run once immediately on startup if enabled
    console.log('Checking for initial search...');
    (async () => {
        try {
            const config = await storage.readConfig();
            // Check if crawler is enabled - default to running if not explicitly disabled
            if (config.enabled === false) {
                console.log('Crawler disabled, skipping initial search.');
                return;
            }

            console.log('Performing initial search...');
            const data = await ctrip.searchFlights();
            
            // 获取天气数据
            console.log('Fetching initial weather data...');
            try {
                const weatherData = await weather.getWeatherForFlights(data.prices || []);
                data.weather = weatherData;
                console.log(`Weather data fetched for ${Object.keys(weatherData).length} dates`);
            } catch (weatherErr) {
                console.error('Error fetching initial weather:', weatherErr.message);
                data.weather = {};
            }
            
            await storage.writeData(data);
            console.log('Initial search completed');
        } catch (error) {
            console.error('Error in initial search:', error);
        }
    })();
}

module.exports = {
    startScheduler
};
