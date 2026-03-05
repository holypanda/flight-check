
const { searchFlights } = require('./services/duffel');
const { Duffel } = require('@duffel/api');

// Mock Duffel
const mockCreate = jest.fn().mockResolvedValue({
    data: {
        offers: []
    }
});

jest.mock('@duffel/api', () => {
    return {
        Duffel: jest.fn(() => ({
            offerRequests: {
                create: mockCreate
            }
        }))
    };
});

describe('Duffel Service', () => {
    it('should initialize Duffel with the provided API key', async () => {
        const apiKey = 'test_api_key';
        await searchFlights(apiKey);
        expect(Duffel).toHaveBeenCalledWith({ token: apiKey });
    });

    it('should request HKD currency', async () => {
        const apiKey = 'test_api_key';
        await searchFlights(apiKey);

        expect(mockCreate).toHaveBeenCalled();
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.currency).toBe('HKD');
    });

    it('should search for dates within 3 months', async () => {
        const apiKey = 'test_api_key';
        await searchFlights(apiKey);

        const calls = mockCreate.mock.calls;
        expect(calls.length).toBeGreaterThan(0);

        const firstCallDate = new Date(calls[0][0].departure_date);
        const lastCallDate = new Date(calls[calls.length - 1][0].departure_date);

        const today = new Date();
        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(today.getMonth() + 3);

        // Allow some buffer for execution time
        expect(firstCallDate.getTime()).toBeGreaterThanOrEqual(today.setHours(0,0,0,0));
        expect(lastCallDate.getTime()).toBeLessThanOrEqual(threeMonthsFromNow.getTime() + 86400000); // +1 day buffer
    });
});
