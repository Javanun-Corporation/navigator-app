import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Config from 'react-native-config';
import { useAuth } from './AuthContext';
import useStorage from '../hooks/use-storage';
import { APP_WALKTHROUGH_MODULE } from '../constants/AppWalkthroughGuide';

const TrainingContext = createContext();

const TRAINING_MODULES_API_URL = Config.TRAINING_MODULES_API_URL;
const TRAINING_QUIZ_API_URL = Config.TRAINING_QUIZ_API_URL;
const TRAINING_STATUS_API_URL = Config.TRAINING_STATUS_API_URL;
const TRAINING_QUIZ_SUBMIT_API_URL = Config.TRAINING_QUIZ_SUBMIT_API_URL;

// DEV BYPASS: the /training routes aren't deployed on the dev API yet, so a debug build with the
// training URLs left blank treats every driver as already trained. Remove once the routes exist.
const DEV_SKIP_TRAINING = __DEV__ && !TRAINING_STATUS_API_URL;

export const TrainingProvider = ({ children }) => {
    const { driver, isAuthenticated } = useAuth();
    // Cached in MMKV so the gate has an instant answer on boot instead of waiting on a network
    // round trip; refreshStatus() below keeps it in sync with the backend in the background.
    const [hasPassedTraining, setHasPassedTraining] = useStorage('training_passed', false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const [modules, setModules] = useState([]);
    const [quiz, setQuiz] = useState([]);

    const refreshStatus = useCallback(async () => {
        if (!driver?.id || DEV_SKIP_TRAINING) return;

        setIsCheckingStatus(true);
        try {
            const url = `${TRAINING_STATUS_API_URL}?fleetbaseDriverId=${encodeURIComponent(driver.id)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch training status');
            const { passed } = await response.json();
            setHasPassedTraining(!!passed);
        } catch (err) {
            console.warn('[TrainingContext] Failed to refresh training status:', err);
        } finally {
            setIsCheckingStatus(false);
        }
    }, [driver?.id, setHasPassedTraining]);

    useEffect(() => {
        if (isAuthenticated) {
            refreshStatus();
        }
    }, [isAuthenticated, driver?.id]);

    const loadModules = useCallback(async () => {
        // The app walkthrough is bundled locally (screenshots can't come from the
        // CMS-driven modules API), so it's kept available even if that fetch fails,
        // and always shown last, right before the quiz.
        let remoteModules = [];
        try {
            const response = await fetch(TRAINING_MODULES_API_URL);
            if (!response.ok) throw new Error('Failed to fetch training modules');
            remoteModules = await response.json();
        } catch (err) {
            console.warn('[TrainingContext] Failed to fetch remote training modules:', err);
        }

        const withWalkthrough = [...remoteModules, APP_WALKTHROUGH_MODULE];
        setModules(withWalkthrough);
        return withWalkthrough;
    }, []);

    const loadQuiz = useCallback(async () => {
        const response = await fetch(TRAINING_QUIZ_API_URL);
        if (!response.ok) throw new Error('Failed to fetch training quiz');
        const data = await response.json();
        setQuiz(data);
        return data;
    }, []);

    const submitQuiz = useCallback(
        async (answers) => {
            if (!driver?.id) {
                throw new Error('No authenticated driver');
            }

            const response = await fetch(TRAINING_QUIZ_SUBMIT_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fleetbaseDriverId: driver.id, answers }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result?.error || 'Failed to submit quiz');
            }

            if (result.passed) {
                setHasPassedTraining(true);
            }

            return result;
        },
        [driver?.id, setHasPassedTraining]
    );

    const value = useMemo(
        () => ({
            hasPassedTraining: DEV_SKIP_TRAINING || !!hasPassedTraining,
            isCheckingStatus,
            modules,
            quiz,
            refreshStatus,
            loadModules,
            loadQuiz,
            submitQuiz,
        }),
        [hasPassedTraining, isCheckingStatus, modules, quiz, refreshStatus, loadModules, loadQuiz, submitQuiz]
    );

    return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
};

export const useTraining = () => {
    const context = useContext(TrainingContext);
    if (!context) {
        throw new Error('useTraining must be used within a TrainingProvider');
    }
    return context;
};

export const useNeedsTraining = () => {
    const { isAuthenticated } = useAuth();
    const { hasPassedTraining } = useTraining();
    return isAuthenticated && !hasPassedTraining;
};

export const useIsAuthenticatedAndTrained = () => {
    const { isAuthenticated } = useAuth();
    const { hasPassedTraining } = useTraining();
    return isAuthenticated && hasPassedTraining;
};
