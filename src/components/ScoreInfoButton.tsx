import React, { useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { Button, Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCircleInfo, faXmark } from '@fortawesome/free-solid-svg-icons';

type ScoreInfoButtonProps = {
    title: string;
    description: string;
    iconSize?: number;
};

/**
 * Small tappable (i) icon meant to sit next to a score label/value. Opens a modal
 * explaining what the score means.
 */
const ScoreInfoButton: React.FC<ScoreInfoButtonProps> = ({ title, description, iconSize = 15 }) => {
    const theme = useTheme();
    const [visible, setVisible] = useState(false);

    return (
        <>
            <Pressable onPress={() => setVisible(true)} hitSlop={10} accessibilityLabel={`What does ${title} mean?`} accessibilityRole='button'>
                <FontAwesomeIcon icon={faCircleInfo} size={iconSize} color={theme.textSecondary?.val || '#888'} />
            </Pressable>

            <Modal visible={visible} transparent animationType='fade' onRequestClose={() => setVisible(false)}>
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
                    onPress={() => setVisible(false)}
                >
                    <Pressable onPress={() => {}}>
                        <YStack bg='$background' borderRadius='$5' p='$4' width={300} space='$3' borderWidth={1} borderColor='$borderColorWithShadow'>
                            <XStack ai='center' jc='space-between'>
                                <Text fontSize={17} fontWeight='bold' color='$textPrimary'>
                                    {title}
                                </Text>
                                <Pressable onPress={() => setVisible(false)} hitSlop={10}>
                                    <FontAwesomeIcon icon={faXmark} size={16} color={theme.textSecondary?.val || '#888'} />
                                </Pressable>
                            </XStack>
                            <Text fontSize={14} color='$textSecondary' lineHeight={20}>
                                {description}
                            </Text>
                            <Button size='$3' bg='$info' onPress={() => setVisible(false)}>
                                <Button.Text color='white' fontWeight='600'>
                                    Got it
                                </Button.Text>
                            </Button>
                        </YStack>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
};

export default ScoreInfoButton;
