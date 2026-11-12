import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, ScrollView, Pressable } from 'react-native';
import { Button, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import BackButton from '../components/BackButton';
import { useTraining } from '../contexts/TrainingContext';
import { toast } from '../utils/toast';

const TrainingQuizScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const route = useRoute();
    const reviewMode = route.params?.reviewMode ?? false;
    const { quiz, loadQuiz, submitQuiz, skipTraining } = useTraining();
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [answers, setAnswers] = useState({});
    const [result, setResult] = useState(null);

    useEffect(() => {
        (async () => {
            setIsLoading(true);
            try {
                await loadQuiz();
            } catch (err) {
                console.warn('[TrainingQuizScreen] Failed to load quiz:', err);
                if (reviewMode) {
                    toast.error('Unable to load the quiz. Please try again.');
                } else {
                    // At the mandatory gate, training that cannot be loaded is skipped: the root navigator swaps to the driver app once hasPassedTraining flips to true.
                    skipTraining();
                }
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    const allAnswered = useMemo(() => quiz.length > 0 && quiz.every((question) => answers[question.id] !== undefined), [quiz, answers]);

    const handleSelect = (questionId, choiceIndex) => {
        setAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            const response = await submitQuiz(answers);
            setResult(response);
            if (response.passed) {
                toast.success(`You passed! (${response.score}/${response.total})`);
                if (reviewMode) {
                    navigation.goBack();
                }
                // If this was the mandatory gate, the root navigator swaps to the
                // driver app automatically once hasPassedTraining flips to true.
            } else {
                toast.error(`You scored ${response.score}/${response.total}. Please review the material and try again.`);
            }
        } catch (err) {
            console.warn('[TrainingQuizScreen] Quiz submission failed:', err);
            toast.error(err.message || 'Failed to submit the quiz. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRetry = () => {
        setAnswers({});
        setResult(null);
    };

    if (isLoading) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val, alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size='large' color='$textPrimary' />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <YStack flex={1} px='$4' pt='$3'>
                <XStack alignItems='center' mb='$3'>
                    <BackButton onPress={() => navigation.goBack()} />
                    <Text color='$textPrimary' fontSize='$7' fontWeight='bold' ml='$2'>
                        Training Quiz
                    </Text>
                </XStack>
                <ScrollView showsVerticalScrollIndicator={false}>
                    {quiz.map((question, index) => (
                        <YStack key={question.id} mb='$6'>
                            <Text color='$textPrimary' fontSize='$6' fontWeight='bold' mb='$3'>
                                {index + 1}. {question.prompt}
                            </Text>
                            {question.choices.map((choice, choiceIndex) => {
                                const selected = answers[question.id] === choiceIndex;
                                return (
                                    <Pressable
                                        key={choiceIndex}
                                        onPress={() => handleSelect(question.id, choiceIndex)}
                                        style={{
                                            padding: 14,
                                            borderRadius: 10,
                                            borderWidth: 1,
                                            borderColor: selected ? theme.primary.val : theme.borderColorWithShadow.val,
                                            backgroundColor: selected ? theme.secondary.val : 'transparent',
                                            marginBottom: 8,
                                        }}
                                    >
                                        <Text color={selected ? '$primary' : '$textSecondary'} fontWeight={selected ? 'bold' : 'normal'}>
                                            {choice}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </YStack>
                    ))}
                </ScrollView>
                <YStack pb='$4' space='$2'>
                    {result && !result.passed ? (
                        <Button size='$5' onPress={handleRetry} rounded>
                            <Button.Text>Try Again</Button.Text>
                        </Button>
                    ) : (
                        <Button size='$5' bg='$primary' rounded disabled={!allAnswered || isSubmitting} opacity={!allAnswered || isSubmitting ? 0.5 : 1} onPress={handleSubmit}>
                            <Button.Icon>{isSubmitting ? <Spinner color='$white' /> : <YStack />}</Button.Icon>
                            <Button.Text color='$white' fontWeight='bold'>
                                Submit Quiz
                            </Button.Text>
                        </Button>
                    )}
                </YStack>
            </YStack>
        </SafeAreaView>
    );
};

export default TrainingQuizScreen;
