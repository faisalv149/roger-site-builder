// the parts of Motion (motion.dev, MIT) a splash page uses, bundled by scripts/build-motion.ts into src/splash/vendor/motion.ts
import { animate } from 'motion/mini';
import { inView, scroll, stagger } from 'motion';
(window as unknown as { RogerMotion: unknown }).RogerMotion = { animate, inView, scroll, stagger };
