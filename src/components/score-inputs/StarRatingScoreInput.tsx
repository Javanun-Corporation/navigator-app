import React from 'react';
import { Pressable, View } from 'react-native';
import { XStack } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faStar, faStarHalfStroke } from '@fortawesome/free-solid-svg-icons';
import { scoreToStars, starsToScore } from './scoreNormalization';

export type StarRatingScoreInputProps = {
    value: number | null;
    onChange: (value: number) => void;
    size?: number;
};

const MAX_STARS = 5;
const FILLED_COLOR = '#f5a623';
const EMPTY_COLOR = '#d1d5db';

/** 1-5 star rating that allows half-star precision; reports/accepts a 0-100 score. */
const StarRatingScoreInput: React.FC<StarRatingScoreInputProps> = ({ value, onChange, size = 34 }) => {
    const stars = scoreToStars(value);

    const handlePress = (starNumber: number, half: 'left' | 'right') => {
        const newStars = half === 'left' ? starNumber - 0.5 : starNumber;
        onChange(starsToScore(newStars));
    };

    return (
        <XStack space='$2' ai='center'>
            {Array.from({ length: MAX_STARS }, (_, i) => {
                const starNumber = i + 1;
                const filled = stars >= starNumber;
                const half = !filled && stars >= starNumber - 0.5;
                const icon = half ? faStarHalfStroke : faStar;
                const color = filled || half ? FILLED_COLOR : EMPTY_COLOR;

                return (
                    <View key={starNumber} style={{ width: size, height: size }}>
                        <FontAwesomeIcon icon={icon} size={size} color={color} />
                        <View style={{ flexDirection: 'row', width: size, height: size, position: 'absolute', top: 0, left: 0 }}>
                            <Pressable
                                style={{ width: size / 2, height: size }}
                                onPress={() => handlePress(starNumber, 'left')}
                                accessibilityLabel={`Rate ${starNumber - 0.5} out of 5 stars`}
                            />
                            <Pressable
                                style={{ width: size / 2, height: size }}
                                onPress={() => handlePress(starNumber, 'right')}
                                accessibilityLabel={`Rate ${starNumber} out of 5 stars`}
                            />
                        </View>
                    </View>
                );
            })}
        </XStack>
    );
};

export default StarRatingScoreInput;
