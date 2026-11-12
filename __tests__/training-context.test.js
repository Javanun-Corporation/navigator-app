const mockSetStored = jest.fn();

jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ driver: { id: 'driver_1' }, isAuthenticated: true }) }));
jest.mock('../src/hooks/use-storage', () => ({ __esModule: true, default: () => [false, mockSetStored] }));
jest.mock('../src/constants/AppWalkthroughGuide', () => ({ APP_WALKTHROUGH_MODULE: { id: 'walkthrough' } }));

const URLS = {
    TRAINING_MODULES_API_URL: 'https://training.test/modules',
    TRAINING_QUIZ_API_URL: 'https://training.test/quiz',
    TRAINING_STATUS_API_URL: 'https://training.test/status',
    TRAINING_QUIZ_SUBMIT_API_URL: 'https://training.test/submit',
};

// The training addresses and __DEV__ are read once when the module loads, so each test loads React and the context fresh with the build it describes.
const mountTraining = async ({ config, dev }) => {
    jest.resetModules();
    global.__DEV__ = dev;
    jest.doMock('react-native-config', () => ({ __esModule: true, default: config }));
    const React = require('react');
    const TestRenderer = require('react-test-renderer');
    const { TrainingProvider, useTraining } = require('../src/contexts/TrainingContext');
    const seen = {};
    const Probe = () => {
        seen.training = useTraining();
        return null;
    };
    await TestRenderer.act(async () => {
        TestRenderer.create(React.createElement(TrainingProvider, null, React.createElement(Probe)));
    });
    return { seen, act: TestRenderer.act };
};

describe('TrainingContext', () => {
    const savedDev = global.__DEV__;

    beforeEach(() => {
        mockSetStored.mockReset();
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ passed: false }) }));
    });

    afterEach(() => {
        global.__DEV__ = savedDev;
        delete global.fetch;
    });

    // A standalone build has __DEV__ false. With no training address there is nothing to load, so the LVA goes straight to the app.
    it('skips training in a standalone build that has no training address', async () => {
        const { seen } = await mountTraining({ config: {}, dev: false });

        expect(seen.training.hasPassedTraining).toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps the training gate when the addresses are set and the LVA has not passed', async () => {
        const { seen } = await mountTraining({ config: URLS, dev: false });

        expect(global.fetch).toHaveBeenCalledWith('https://training.test/status?fleetbaseDriverId=driver_1');
        expect(seen.training.hasPassedTraining).toBe(false);
    });

    // Skipping is for this run of the app only: nothing is stored, so the next launch asks the training service again.
    it('skipTraining opens the app for this run without storing a pass', async () => {
        const { seen, act } = await mountTraining({ config: URLS, dev: false });
        mockSetStored.mockClear();

        await act(async () => {
            seen.training.skipTraining();
        });

        expect(seen.training.hasPassedTraining).toBe(true);
        expect(mockSetStored).not.toHaveBeenCalledWith(true);
    });
});
