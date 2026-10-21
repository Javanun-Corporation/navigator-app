import React, { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { useTheme } from 'tamagui';

export type NumericScoreInputProps = {
    value: number | null;
    onChange: (value: number | null) => void;
};

/** Plain 0-100 numeric text entry - the original score input, extracted as a widget. */
const NumericScoreInput: React.FC<NumericScoreInputProps> = ({ value, onChange }) => {
    const theme = useTheme();
    const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

    useEffect(() => {
        setText(value === null || value === undefined ? '' : String(value));
    }, [value]);

    const handleChangeText = (raw: string) => {
        const numeric = raw.replace(/[^0-9]/g, '');
        setText(numeric);

        if (numeric === '') {
            onChange(null);
            return;
        }

        const parsed = Math.min(100, Math.max(0, parseInt(numeric, 10)));
        onChange(parsed);
    };

    return (
        <TextInput
            style={{
                height: 50,
                borderColor: theme.gray8?.val || '#ccc',
                borderWidth: 1,
                borderRadius: 8,
                padding: 12,
                color: theme.textPrimary?.val || 'black',
                backgroundColor: theme.background?.val,
            }}
            keyboardType='numeric'
            placeholder='0 - 100'
            placeholderTextColor='#999'
            value={text}
            onChangeText={handleChangeText}
        />
    );
};

export default NumericScoreInput;
