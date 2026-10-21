import React, { useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faFlask, faXmark } from '@fortawesome/free-solid-svg-icons';
import useStorage from '../hooks/use-storage';
import { DEFAULT_SCORE_WIDGET_TYPE, SCORE_WIDGET_LABELS, SCORE_WIDGET_TYPE_STORAGE_KEY, SCORE_WIDGET_TYPES, ScoreWidgetType } from './score-inputs/scoreNormalization';

/**
 * Dev-only pill that opens a quick picker for which score input widget is active - lets you
 * flip between Numeric/Stars/Slider/Picker/Emotion right from the Validation Wizard without
 * leaving the flow (navigating to Account > Dev Menu would otherwise lose wizard progress).
 * Reads/writes the same MMKV-backed storage key as the full Dev Menu screen, so both stay in sync.
 */
const ScoreWidgetDevToggle: React.FC = () => {
    const theme = useTheme();
    const [widgetType, setWidgetType] = useStorage<ScoreWidgetType>(SCORE_WIDGET_TYPE_STORAGE_KEY, DEFAULT_SCORE_WIDGET_TYPE);
    const [open, setOpen] = useState(false);

    if (!__DEV__) return null;

    const activeWidgetType = widgetType || DEFAULT_SCORE_WIDGET_TYPE;

    return (
        <>
            <Pressable onPress={() => setOpen(true)} accessibilityLabel='Toggle score input widget (dev only)'>
                <XStack ai='center' space='$2' bg='$warning' borderWidth={1} borderColor='$warningBorder' px='$3' py='$2' borderRadius={999} alignSelf='flex-start'>
                    <FontAwesomeIcon icon={faFlask} size={12} color={theme.warningText?.val || '#000'} />
                    <Text fontSize={12} fontWeight='700' color='$warningText'>
                        Dev: {SCORE_WIDGET_LABELS[activeWidgetType]}
                    </Text>
                </XStack>
            </Pressable>

            <Modal visible={open} transparent animationType='fade' onRequestClose={() => setOpen(false)}>
                <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
                    <Pressable onPress={() => {}}>
                        <YStack bg='$background' borderTopLeftRadius='$7' borderTopRightRadius='$7' p='$4' pb='$8' space='$1' borderWidth={1} borderColor='$borderColorWithShadow'>
                            <XStack ai='center' jc='space-between' mb='$3'>
                                <Text fontSize={17} fontWeight='bold' color='$textPrimary'>
                                    Score Input Widget
                                </Text>
                                <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                                    <FontAwesomeIcon icon={faXmark} size={16} color={theme.textSecondary?.val || '#888'} />
                                </Pressable>
                            </XStack>

                            {SCORE_WIDGET_TYPES.map((type) => {
                                const isActive = activeWidgetType === type;
                                return (
                                    <Pressable key={type} onPress={() => { setWidgetType(type); setOpen(false); }}>
                                        <XStack ai='center' jc='space-between' py='$3' px='$3' bg={isActive ? '$surface' : 'transparent'} borderRadius='$4'>
                                            <Text color='$textPrimary' fontSize={15} fontWeight={isActive ? '700' : '400'}>
                                                {SCORE_WIDGET_LABELS[type]}
                                            </Text>
                                            {isActive && <FontAwesomeIcon icon={faCheck} size={14} color={theme.primary?.val || '#2563eb'} />}
                                        </XStack>
                                    </Pressable>
                                );
                            })}
                        </YStack>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
};

export default ScoreWidgetDevToggle;
