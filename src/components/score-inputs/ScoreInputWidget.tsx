import React from 'react';
import NumericScoreInput from './NumericScoreInput';
import StarRatingScoreInput from './StarRatingScoreInput';
import SliderScoreInput from './SliderScoreInput';
import PickerScoreInput from './PickerScoreInput';
import EmotionScoreInput from './EmotionScoreInput';
import { ScoreWidgetType } from './scoreNormalization';

export type ScoreInputWidgetProps = {
    widgetType: ScoreWidgetType;
    value: number | null;
    onChange: (value: number | null) => void;
};

/**
 * Renders whichever score input widget is currently configured (see Dev Menu).
 * Every widget shares the same contract: `value`/`onChange` are always 0-100,
 * regardless of the widget's own internal representation (stars, slider, etc).
 */
const ScoreInputWidget: React.FC<ScoreInputWidgetProps> = ({ widgetType, value, onChange }) => {
    switch (widgetType) {
        case 'stars':
            return <StarRatingScoreInput value={value} onChange={onChange} />;
        case 'slider':
            return <SliderScoreInput value={value} onChange={onChange} />;
        case 'picker':
            return <PickerScoreInput value={value} onChange={onChange} />;
        case 'emotion':
            return <EmotionScoreInput value={value} onChange={onChange} />;
        case 'numeric':
        default:
            return <NumericScoreInput value={value} onChange={onChange} />;
    }
};

export default ScoreInputWidget;
