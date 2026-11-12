import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import TrainingQuizScreen from '../src/screens/TrainingQuizScreen';
import { toast } from '../src/utils/toast';

const mockTraining = { quiz: [], loadQuiz: jest.fn(), submitQuiz: jest.fn(), skipTraining: jest.fn() };
const mockRoute = { params: undefined };

jest.mock('../src/contexts/TrainingContext', () => ({ useTraining: () => mockTraining }));
jest.mock('../src/utils/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../src/components/BackButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }), useRoute: () => mockRoute }));

jest.mock('react-native', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    return { SafeAreaView: host('SafeAreaView'), ScrollView: host('ScrollView'), Pressable: host('Pressable') };
});

jest.mock('tamagui', () => {
    const mockReact = require('react');
    const host = (name) => (props) => mockReact.createElement(name, props, props.children);
    const Button = host('Button');
    Button.Text = host('ButtonText');
    Button.Icon = host('ButtonIcon');
    const colour = { val: '#000' };
    return {
        Button,
        Spinner: host('Spinner'),
        Text: host('Text'),
        XStack: host('XStack'),
        YStack: host('YStack'),
        useTheme: () => ({ background: colour, primary: colour, secondary: colour, borderColorWithShadow: colour }),
    };
});

const mount = async () => {
    await act(async () => {
        TestRenderer.create(React.createElement(TrainingQuizScreen));
    });
};

describe('TrainingQuizScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockRoute.params = undefined;
    });

    afterEach(() => {
        console.warn.mockRestore();
    });

    // The mandatory gate: an LVA who cannot be shown the quiz is let into the app instead of being left on a dead screen.
    it('skips training when the quiz fails to load at the training gate', async () => {
        mockTraining.loadQuiz.mockRejectedValue(new Error('Failed to fetch training quiz'));

        await mount();

        expect(mockTraining.skipTraining).toHaveBeenCalledTimes(1);
        expect(toast.error).not.toHaveBeenCalled();
    });

    // Review mode is opened from inside the app by an LVA who is already in, so there is nothing to skip.
    it('shows the error and skips nothing when the quiz fails to load in review mode', async () => {
        mockRoute.params = { reviewMode: true };
        mockTraining.loadQuiz.mockRejectedValue(new Error('Failed to fetch training quiz'));

        await mount();

        expect(toast.error).toHaveBeenCalledWith('Unable to load the quiz. Please try again.');
        expect(mockTraining.skipTraining).not.toHaveBeenCalled();
    });

    it('skips nothing when the quiz loads', async () => {
        mockTraining.loadQuiz.mockResolvedValue([]);

        await mount();

        expect(mockTraining.skipTraining).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });
});
