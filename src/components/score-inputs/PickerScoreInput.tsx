import React, { useState } from 'react';
import { Modal, Pressable } from 'react-native';
import { Text, XStack, YStack, useTheme } from 'tamagui';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { PICKER_SCORE_STEPS, nearestPickerStep } from './scoreNormalization';

export type PickerScoreInputProps = {
    value: number | null;
    onChange: (value: number) => void;
};

/** Dropdown picker over a fixed set of 0-100 steps (0,10,20,...,100). */
const PickerScoreInput: React.FC<PickerScoreInputProps> = ({ value, onChange }) => {
    const theme = useTheme();
    const [open, setOpen] = useState(false);
    const current = value === null || value === undefined ? null : nearestPickerStep(value);

    const handleSelect = (step: number) => {
        onChange(step);
        setOpen(false);
    };

    return (
        <>
            <Pressable onPress={() => setOpen(true)}>
                <XStack
                    ai='center'
                    jc='space-between'
                    bg='$surface'
                    borderWidth={1}
                    borderColor='$borderColor'
                    borderRadius='$4'
                    height={50}
                    px='$3'
                >
                    <Text color={current === null ? '$textSecondary' : '$textPrimary'} fontSize={15}>
                        {current === null ? 'Select a score' : `${current} / 100`}
                    </Text>
                    <FontAwesomeIcon icon={faChevronDown} size={14} color={theme.textSecondary?.val || '#888'} />
                </XStack>
            </Pressable>

            <Modal visible={open} transparent animationType='fade' onRequestClose={() => setOpen(false)}>
                <Pressable
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
                    onPress={() => setOpen(false)}
                >
                    <Pressable onPress={() => {}}>
                        <YStack bg='$background' borderRadius='$5' p='$2' width={260} maxHeight={380} borderWidth={1} borderColor='$borderColorWithShadow'>
                            {PICKER_SCORE_STEPS.map((step) => (
                                <Pressable key={step} onPress={() => handleSelect(step)}>
                                    <XStack ai='center' jc='space-between' py='$2' px='$3'>
                                        <Text color='$textPrimary' fontSize={15}>
                                            {step} / 100
                                        </Text>
                                        {current === step && <FontAwesomeIcon icon={faCheck} size={14} color={theme.primary?.val || '#2563eb'} />}
                                    </XStack>
                                </Pressable>
                            ))}
                        </YStack>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
};

export default PickerScoreInput;
