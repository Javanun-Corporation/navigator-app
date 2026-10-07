import React from 'react';
import { Pressable } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faFaceFrown, faFaceLaughBeam, faFaceMeh, faFaceSadTear, faFaceSmile } from '@fortawesome/free-solid-svg-icons';
import { emotionIndexToScore, scoreToEmotionIndex } from './scoreNormalization';

export type EmotionScoreInputProps = {
    value: number | null;
    onChange: (value: number) => void;
};

const EMOTION_ICONS = [faFaceSadTear, faFaceFrown, faFaceMeh, faFaceSmile, faFaceLaughBeam];
const EMOTION_LABELS = ['Very Poor', 'Poor', 'Neutral', 'Good', 'Excellent'];
const ACTIVE_COLOR = '#f5a623';
const INACTIVE_COLOR = '#9ca3af';

/** 5-stage emotion scale (sad face to happy face) mapped to 0/25/50/75/100. */
const EmotionScoreInput: React.FC<EmotionScoreInputProps> = ({ value, onChange }) => {
    const activeIndex = value === null || value === undefined ? null : scoreToEmotionIndex(value);

    return (
        <XStack jc='space-between' ai='flex-end'>
            {EMOTION_ICONS.map((icon, index) => {
                const isActive = activeIndex === index;

                return (
                    <Pressable key={index} onPress={() => onChange(emotionIndexToScore(index))} hitSlop={8} accessibilityLabel={EMOTION_LABELS[index]}>
                        <YStack ai='center' space='$1' opacity={isActive ? 1 : 0.5} scale={isActive ? 1.15 : 1}>
                            <FontAwesomeIcon icon={icon} size={30} color={isActive ? ACTIVE_COLOR : INACTIVE_COLOR} />
                            <Text fontSize={10} color={isActive ? '$textPrimary' : '$textSecondary'}>
                                {EMOTION_LABELS[index]}
                            </Text>
                        </YStack>
                    </Pressable>
                );
            })}
        </XStack>
    );
};

export default EmotionScoreInput;
