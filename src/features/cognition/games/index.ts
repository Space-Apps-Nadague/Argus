import type React from 'react';
import type { CognitionGameId } from '../types';
import type { GameProps } from './common';
import { Pvt } from './Pvt';
import { MotorPraxis } from './MotorPraxis';
import { FractalNBack } from './FractalNBack';
import { Volt } from './Volt';
import { Dsst } from './Dsst';
import { Bart } from './Bart';
import { LineOrientation } from './LineOrientation';
import { AbstractMatching } from './AbstractMatching';
import { MatrixReasoning } from './MatrixReasoning';

export const GAME_COMPONENTS: Record<CognitionGameId, React.FC<GameProps>> = {
  pvt: Pvt,
  motor_praxis: MotorPraxis,
  fractal_2back: FractalNBack,
  volt: Volt,
  dsst: Dsst,
  bart: Bart,
  line_orientation: LineOrientation,
  abstract_matching: AbstractMatching,
  matrix_reasoning: MatrixReasoning,
};
