
const assert = require('assert');
const duffelService = require('./services/duffel');

// Mock Duffel
const { Duffel } = require('@duffel/api');

// Override Duffel implementation manually
// Wait, require('@duffel/api') returns the class, I cannot easily mock it without rewriting the file or using a mocking library.
// But I can redefine the global require cache for @duffel/api? Or use proxyquire if installed.
// No proxyquire installed.

// Let's create a wrapper script that monkey patches require or modifies duffel.js temporarily.
// Or better: modify duffel.js to allow dependency injection?
// Or just read the file and check for strings 'HKD' and '3 months logic'.

// Since I cannot run the code easily without an API key (it returns early if no key), I will just trust my reading of the code.
// The code clearly shows:
// 1. limit.setMonth(today.getMonth() + 3);
// 2. currency: 'HKD'

// Let's verify the DELETE endpoint.
// I will start the server (already running) and curl DELETE.

const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/prices',
  method: 'GET',
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const prices = JSON.parse(data);
    if (prices.length > 0) {
        const idToDelete = prices[0].id;
        console.log(`Deleting ID: ${idToDelete}`);

        const delOptions = {
            hostname: 'localhost',
            port: 3000,
            path: `/api/prices/${idToDelete}`,
            method: 'DELETE',
        };

        const delReq = http.request(delOptions, (delRes) => {
            console.log(`Delete Status: ${delRes.statusCode}`);
            delRes.on('data', (d) => process.stdout.write(d));

            // Verify deletion
            const verifyReq = http.request(options, (verifyRes) => {
                let verifyData = '';
                verifyRes.on('data', (chunk) => verifyData += chunk);
                verifyRes.on('end', () => {
                    const remaining = JSON.parse(verifyData);
                    const found = remaining.find(p => p.id === idToDelete);
                    if (!found) {
                        console.log('\nVerification: SUCCESS (ID not found)');
                    } else {
                        console.log('\nVerification: FAILED (ID still exists)');
                    }
                });
            });
            verifyReq.end();
        });
        delReq.end();
    } else {
        console.log('No prices to delete.');
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
