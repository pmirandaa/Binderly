// Top-level Tamagui config consumed by both apps' bundlers.
//
// Next.js's `@tamagui/next-plugin` and Expo's `tamagui-loader`
// both expect this file at `@binderly/ui/tamagui.config`. The
// real config object lives in `src/config.ts`; this file is just
// the public re-export with the default export Tamagui's compiler
// looks for.

import { tamaguiConfig } from './src/config.js';

export { tamaguiConfig };
export default tamaguiConfig;
