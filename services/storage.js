const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/prices.json');
const CONFIG_FILE = path.join(__dirname, '../data/config.json');

// Ensure data directory exists
async function ensureDirectory() {
    try {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

// Read data from JSON file
async function readData() {
    try {
        await ensureDirectory();
        // Check if file exists
        try {
            await fs.access(DATA_FILE);
        } catch {
            // Return empty array if file doesn't exist
            return [];
        }

        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data:', error);
        return [];
    }
}

// Read config from JSON file
async function readConfig() {
    try {
        await ensureDirectory();
        try {
            await fs.access(CONFIG_FILE);
        } catch {
            return {};
        }
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading config:', error);
        return {};
    }
}

// Write config to JSON file
async function saveConfig(newConfig) {
    try {
        await ensureDirectory();
        const currentConfig = await readConfig();
        const updatedConfig = { ...currentConfig, ...newConfig };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing config:', error);
        return false;
    }
}

// Write data to JSON file
async function writeData(newData) {
    try {
        await ensureDirectory();

        // Append new data to existing data
        const currentData = await readData();

        // Add timestamp if not present
        if (!newData.timestamp) {
            newData.timestamp = new Date().toISOString();
        }

        // Add unique ID
        newData.id = Date.now().toString(36) + Math.random().toString(36).substr(2);

        currentData.push(newData);

        // Keep only last 100 entries to prevent file from growing too large for this demo
        const trimmedData = currentData.slice(-100);

        await fs.writeFile(DATA_FILE, JSON.stringify(trimmedData, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing data:', error);
        return false;
    }
}

// Delete data by ID
async function deleteData(id) {
    try {
        await ensureDirectory();
        const currentData = await readData();
        const initialLength = currentData.length;

        const newData = currentData.filter(item => item.id !== id);

        if (newData.length === initialLength) {
            return false; // ID not found
        }

        await fs.writeFile(DATA_FILE, JSON.stringify(newData, null, 2));
        return true;
    } catch (error) {
        console.error('Error deleting data:', error);
        return false;
    }
}

module.exports = {
    readData,
    writeData,
    deleteData,
    readConfig,
    saveConfig
};
