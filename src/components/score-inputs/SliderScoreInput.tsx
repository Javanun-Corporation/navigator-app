import React from 'react';
import { Slider, Text, XStack, YStack } from 'tamagui';

export type SliderScoreInputProps = {
    value: number | null;
    onChange: (value: number) => void;
};

/** Direct 0-100 slider - no conversion needed since the slider's native range already matches. */
const SliderScoreInput: React.FC<SliderScoreInputProps> = ({ value, onChange }) => {
    const current = value ?? 50;

    return (
        <YStack space='$2'>
            <Slider size='$4' min={0} max={100} step={1} value={[current]} onValueChange={(vals) => onChange(vals[0])}>
                <Slider.Track>
                    <Slider.TrackActive />
                </Slider.Track>
                <Slider.Thumb index={0} circular size='$1.5' />
            </Slider>
            <XStack jc='space-between'>
                <Text fontSize={12} color='$textSecondary'>
                    0
                </Text>
                <Text fontSize={14} fontWeight='700' color='$textPrimary'>
                    {current}
                </Text>
                <Text fontSize={12} color='$textSecondary'>
                    100
                </Text>
            </XStack>
        </YStack>
    );
};

export default SliderScoreInput;
