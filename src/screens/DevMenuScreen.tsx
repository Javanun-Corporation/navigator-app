import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Pressable, SafeAreaView, ScrollView } from 'react-native';
import { Separator, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCircle, faCircleDot } from '@fortawesome/free-solid-svg-icons';
import BackButton from '../components/BackButton';
import { ScoreInputWidget } from '../components/score-inputs';
import {
    DEFAULT_SCORE_WIDGET_TYPE,
    SCORE_WIDGET_LABELS,
    SCORE_WIDGET_TYPE_STORAGE_KEY,
    SCORE_WIDGET_TYPES,
    ScoreWidgetType,
} from '../components/score-inputs/scoreNormalization';
import useStorage from '../hooks/use-storage';

/**
 * Developer-only settings screen. Currently exposes a toggle for which score input
 * widget the Validation Wizard should render (numeric, stars, slider, picker, emotion).
 * The selection is persisted via MMKV so it survives app restarts.
 */
const DevMenuScreen = () => {
    const theme = useTheme();
    const navigation = useNavigation();
    const [widgetType, setWidgetType] = useStorage<ScoreWidgetType>(SCORE_WIDGET_TYPE_STORAGE_KEY, DEFAULT_SCORE_WIDGET_TYPE);
    const [previewValue, setPreviewValue] = useState<number | null>(50);

    const activeWidgetType = widgetType || DEFAULT_SCORE_WIDGET_TYPE;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background.val }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                <YStack flex={1} px='$4' pt='$3' space='$5'>
                    <XStack alignItems='center' gap='$3'>
                        <BackButton onPress={() => navigation.goBack()} />
                        <Text color='$textPrimary' fontSize='$8' fontWeight='bold'>
                            Dev Menu
                        </Text>
                    </XStack>

                    <YStack space='$2'>
                        <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                            Score Input Widget
                        </Text>
                        <Text color='$textSecondary' fontSize={14}>
                            Choose which widget the Validation Wizard uses to collect the 0-100 scores. All widgets normalize to the same 0-100 scale.
                        </Text>

                        <YStack borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$4' overflow='hidden' mt='$2'>
                            {SCORE_WIDGET_TYPES.map((type, index) => {
                                const isActive = activeWidgetType === type;
                                return (
                                    <React.Fragment key={type}>
                                        <Pressable onPress={() => setWidgetType(type)}>
                                            <XStack ai='center' jc='space-between' px='$4' py='$3' bg={isActive ? '$surface' : '$background'}>
                                                <Text color='$textPrimary' fontSize={15} fontWeight={isActive ? '700' : '400'}>
                                                    {SCORE_WIDGET_LABELS[type]}
                                                </Text>
                                                <FontAwesomeIcon icon={isActive ? faCircleDot : faCircle} size={18} color={isActive ? theme.primary?.val || '#2563eb' : theme.textSecondary?.val || '#888'} />
                                            </XStack>
                                        </Pressable>
                                        {index < SCORE_WIDGET_TYPES.length - 1 && <Separator borderBottomWidth={1} borderColor='$borderColorWithShadow' />}
                                    </React.Fragment>
                                );
                            })}
                        </YStack>
                    </YStack>

                    <YStack space='$2'>
                        <Text color='$textPrimary' fontSize='$6' fontWeight='bold'>
                            Live Preview
                        </Text>
                        <YStack bg='$surface' borderWidth={1} borderColor='$borderColorWithShadow' borderRadius='$4' p='$4' space='$3'>
                            <ScoreInputWidget widgetType={activeWidgetType} value={previewValue} onChange={setPreviewValue} />
                            <Text color='$textSecondary' fontSize={13}>
                                Normalized value: {previewValue === null ? '—' : previewValue} / 100
                            </Text>
                        </YStack>
                    </YStack>
                </YStack>
            </ScrollView>
        </SafeAreaView>
    );
};

export default DevMenuScreen;
